// P61: the resolver and the runner of the local Open actions (`@hub/contract/local` declares them). A key becomes an
// absolute path here, inside that key's own root, and only `/usr/bin/open` is run, with an argv array and no shell.
// Used by the server (`POST /api/local/:action`), `hub open` and `hub up`. Node only.
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, sep } from "node:path";
import type { HubPaths } from "@hub/config/paths";
import { APP_KINDS, appsDto, hrefOf, LOCAL_ACTIONS, NO_APPS, urlRefusal, type AppKind, type AppsDto, type HrefActionId, type LocalActionId, type LocalArgs, type ServerActionId } from "@hub/contract/local";
import type { Repos } from "@hub/db";

/** The only program an Open runs. Absolute, so PATH cannot swap it. */
export const OPEN_BIN = "/usr/bin/open";

/** Runs the opener with its argv (no shell). Injected like `OsaRun`: tests and `HUB_OPENER=fake` never reach the real `open`. */
export type OpenRun = (file: string, args: string[]) => Promise<void>;

export type Target = { kind: "path"; verb: "open" | "reveal"; path: string; label: string } | { kind: "url"; url: string; label: string } | { kind: "app"; app: OpenableApp; label: string };

/** P87: the one application an Open may start by name, Apple Mail (`mail.openApp`, the owner's click). */
export const OPENABLE_APPS = ["Mail"] as const;
export type OpenableApp = (typeof OPENABLE_APPS)[number];
/** Why an action is refused, in words that hold no path; `status` is what the route answers. */
export type Refusal = { refused: string; status: 400 | 404 | 501 };
export type Resolved = Target | Refusal;

export const isRefusal = (r: Resolved): r is Refusal => "refused" in r;

export interface ResolveDeps {
  /** `hubPaths().projects` (may sit outside the instance, `HUB_PROJECTS`). */
  projectsRoot: string;
  /** `hubPaths().log`: `<log>/<slug>/<day>.jsonl`. */
  logRoot: string;
  /** The slug is a project of the registry. */
  isProject(slug: string): Promise<boolean>;
  /** The knowledge index of that project holds this path (relative to the project folder). */
  knowledgeHas(slug: string, entry: string): Promise<boolean>;
}

/** The deps over the instance's database and folders. */
export function localOpenDeps(repos: Repos, paths: Pick<HubPaths, "projects" | "log">): ResolveDeps {
  return {
    projectsRoot: paths.projects,
    logRoot: paths.log,
    isProject: async (slug) => (await repos.projects.get(slug)) !== null,
    knowledgeHas: async (slug, entry) => {
      try {
        return (await repos.knowledge.hashes(slug)).has(entry);
      } catch {
        return false; // an unregistered project has no index
      }
    },
  };
}

/** Files `file.open` hands to their default app: text only. Anything else (`.command`, `.app`, `.sh`, `.scpt`, `.webloc`, ...) is refused. */
export const OPENABLE_FILES: readonly string[] = [".md", ".txt", ".csv", ".json", ".jsonl"];
/** Folders macOS `open` would launch instead of showing. */
const BUNDLES: readonly string[] = [".app", ".bundle", ".pkg", ".workflow"];

const refuse = (refused: string, status: Refusal["status"] = 400): Refusal => ({ refused, status });
const real = (p: string): string | null => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};
const inside = (root: string, p: string) => p.startsWith(root + sep);

/** The absolute path of a key and the root it must stay in; a refusal for a key that names nothing it may reach. */
async function locate(slug: string, key: string, d: ResolveDeps): Promise<{ path: string; root: string } | Refusal> {
  const projects = real(d.projectsRoot);
  const folder = join(d.projectsRoot, slug);
  const projectReal = real(folder);
  if (!projects || !projectReal || !inside(projects, projectReal) || lstatSync(folder).isSymbolicLink()) return refuse("the project folder is missing or is a link", 404);
  if (key === "project") return { path: folder, root: projects };
  if (key === "project.md" || key === "knowledge" || key === "workflows") return { path: join(folder, key), root: projectReal };
  if (key.startsWith("knowledge:")) {
    const entry = key.slice("knowledge:".length);
    if (!(await d.knowledgeHas(slug, entry))) return refuse("that entry is not in the project's knowledge index", 404);
    const root = real(join(folder, "knowledge"));
    if (!root || !inside(projectReal, root)) return refuse("the knowledge folder is missing or is a link", 404);
    return { path: join(folder, entry), root };
  }
  if (key.startsWith("log:")) {
    const root = real(join(d.logRoot, slug));
    if (!root) return refuse("the project has no agent log yet", 404);
    return { path: join(d.logRoot, slug, `${key.slice(4)}.jsonl`), root };
  }
  return refuse("unknown key");
}

/** Checks the target itself: it exists, it is not a link, its real path is inside the root, and it fits the verb (exported for its test: no key names a bundle today). */
export function targetRefusal(action: ServerActionId, path: string, root: string): Refusal | null {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return refuse("it does not exist", 404);
  }
  if (st.isSymbolicLink()) return refuse("a link is never opened");
  const r = real(path);
  if (!r || !(inside(root, r) || r === root)) return refuse("it is outside its folder");
  const ext = extname(path).toLowerCase();
  if (action === "finder.open") {
    if (!st.isDirectory()) return refuse("it is not a folder");
    if (BUNDLES.includes(ext)) return refuse(`a ${ext} folder would run, not open`);
  }
  if (action === "file.open") {
    if (!st.isFile()) return refuse("it is not a file");
    if (!OPENABLE_FILES.includes(ext)) return refuse(`${ext || "a file without an extension"} is not a file the hub opens (only ${OPENABLE_FILES.join(" ")})`);
  }
  return null;
}

/**
 * Resolves one action with its arguments, as received (the schema runs here again: the route and the CLI pass what they got).
 * `href` actions become their URL; `server` actions their path; a declared but not offered action is refused (501).
 */
export async function resolveTarget(action: LocalActionId, args: unknown, d: ResolveDeps): Promise<Resolved> {
  const def = LOCAL_ACTIONS[action];
  const parsed = def.args.safeParse(args);
  if (!parsed.success) return refuse(parsed.error.issues[0]?.message ?? "the arguments were refused");
  if (def.transport === "href") {
    const url = hrefOf(action as HrefActionId, parsed.data as LocalArgs<HrefActionId>);
    return url ? { kind: "url", url, label: def.label } : refuse("no link can be built from that");
  }
  if ("offered" in def && def.offered === false) return refuse(def.refusal, 501);
  if (action === "mail.openApp") return { kind: "app", app: "Mail", label: def.label };
  const a = parsed.data as { project: string; key: string };
  if (!(await d.isProject(a.project))) return refuse("not a project of this instance", 404);
  const at = await locate(a.project, a.key, d);
  if ("refused" in at) return at;
  const bad = targetRefusal(action as ServerActionId, at.path, at.root);
  if (bad) return bad;
  return { kind: "path", verb: action === "finder.reveal" ? "reveal" : "open", path: at.path, label: def.label };
}

/** The argv for `open`, after the last checks: an absolute path (never one starting with `-`) or an allowed URL. */
export function argvOf(t: Target, o: { adminPort?: number } = {}): string[] {
  if (t.kind === "app") {
    if (!(OPENABLE_APPS as readonly string[]).includes(t.app)) throw new Error("refused: not an application the hub opens");
    return ["-a", t.app];
  }
  if (t.kind === "url") {
    const why = urlRefusal(t.url, o);
    if (why) throw new Error(`refused: ${why}`);
    return [t.url];
  }
  if (!isAbsolute(t.path)) throw new Error("refused: not an absolute path");
  return t.verb === "reveal" ? ["-R", t.path] : [t.path];
}

/** Opens a resolved target. */
export async function openTarget(t: Target, run: OpenRun, o: { adminPort?: number } = {}): Promise<void> {
  await run(OPEN_BIN, argvOf(t, o));
}

/** The real opener: `/usr/bin/open` with a 5 s timeout, its output ignored. */
export const execFileOpen: OpenRun = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 5000 }, (err, _out, stderr) => (err ? reject(new Error(String(stderr || err.message).trim())) : resolve()));
  });

/** The fake opener (`HUB_OPENER=fake`): appends each argv as one JSON line to `file`; opens nothing. */
export function fakeOpener(file: string): OpenRun {
  return async (bin, args) => {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify({ argv: [bin, ...args] })}\n`);
  };
}

/** Where the fake opener writes: `state/opener.jsonl` of the instance. */
export const openerLog = (paths: Pick<HubPaths, "state">): string => join(paths.state, "opener.jsonl");

export type OpenerKind = "open" | "fake";

/**
 * `HUB_OPENER`: unset is the real `open`, `fake` the recorder, refused unless the database is a throw-away one (`throwaway`:
 * the caller's `throwawayDbNamed` of `@hub/send`, as for `HUB_MAILER=fake`); anything else throws.
 */
export function chooseOpener(env: { HUB_OPENER?: string | undefined }, paths: Pick<HubPaths, "state">, throwaway: boolean): { kind: OpenerKind; run: OpenRun; probe: AppProbe } {
  const v = env.HUB_OPENER;
  if (v === undefined || v === "") return { kind: "open", run: execFileOpen, probe: bundleProbe() };
  if (v !== "fake") throw new Error(`HUB_OPENER must be "fake" or unset, not "${v}"`);
  if (!throwaway) throw new Error("HUB_OPENER=fake needs HUB_DB (a throw-away database): it is for tests and demos only");
  return { kind: "fake", run: fakeOpener(openerLog(paths)), probe: fakeAppProbe(fakeAppsFile(paths)) };
}

/** The server can run `server` actions: macOS with `/usr/bin/open`, or the fake opener. */
export function localOpenAvailable(kind: OpenerKind = "open", o: { platform?: NodeJS.Platform; exists?: (p: string) => boolean } = {}): boolean {
  if (kind === "fake") return true;
  return (o.platform ?? process.platform) === "darwin" && (o.exists ?? existsSync)(OPEN_BIN);
}

/** The reason when Open is unavailable: one line for the route (501), `hub open` (exit 2) and the doctor. */
export const LOCAL_OPEN_UNAVAILABLE = "Open needs macOS (open(1)): the Open buttons are hidden";

// ---- P131 O2: which destination apps this Mac has. The probe opens, launches and reveals nothing: it looks for the app
// bundle in the folders macOS installs apps into. (`open -Ra <App>` was the plan's first idea; `-R` reveals the app in a
// Finder window, which a probe every 10 minutes must never do.)

/** The bundle names each kind may be installed as (Telegram's macOS app, or Telegram Desktop; both take `tg:`). */
export const APP_BUNDLES: Record<AppKind, readonly string[]> = { notion: ["Notion"], telegram: ["Telegram", "Telegram Desktop"], whatsapp: ["WhatsApp"] };

/** Asks whether the apps are installed; never throws (an unreadable answer is "not installed", so the web link is used). */
export type AppProbe = () => AppsDto;

/** The real probe: `<name>.app` under `/Applications`, `~/Applications` or `/System/Applications`. */
export function bundleProbe(o: { exists?: (p: string) => boolean; home?: string } = {}): AppProbe {
  const exists = o.exists ?? existsSync;
  const roots = ["/Applications", join(o.home ?? homedir(), "Applications"), "/System/Applications"];
  return () => Object.fromEntries(APP_KINDS.map((k) => [k, APP_BUNDLES[k].some((name) => roots.some((r) => exists(join(r, `${name}.app`))))])) as AppsDto;
}

/** Where the fake probe reads its answer (`HUB_OPENER=fake`, e2e): `state/opener-apps.json`, `{"notion": true, ...}`. */
export const fakeAppsFile = (paths: Pick<HubPaths, "state">): string => join(paths.state, "opener-apps.json");

/** The fake probe: the file's answer, read at every probe so a test switches apps on and off; none without the file. */
export function fakeAppProbe(file: string): AppProbe {
  return () => {
    try {
      const parsed = appsDto.partial().safeParse(JSON.parse(readFileSync(file, "utf8")));
      return parsed.success ? { ...NO_APPS, ...parsed.data } : NO_APPS;
    } catch {
      return NO_APPS;
    }
  };
}

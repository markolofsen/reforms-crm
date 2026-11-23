import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { CORE_ROOT, hubPaths } from "@hub/config/paths";
import type { RunResult } from "./context";
import { VERSION_TAG } from "@hub/config/core-version";
import { pinMark } from "./core-update";
import { syncInstanceSkills } from "./instance-skills";
import { KINDS } from "@hub/projects/kinds";
import { scaffoldProject } from "./new-project";
import { MIN_FREE_GB } from "./steps/tools";

/** Where the files of a new instance live: plain files in the core, copied with `{{NAME}}` filled in. */
export const INSTANCE_TEMPLATE = path.join("app", "apps", "installer", "templates", "instance");

export interface InitOptions {
  dir: string;
  /** Core repository to add as the `core/` submodule. Default: the origin of the core in use. */
  coreUrl?: string;
  /** A tag (`v0.4.0`) or `main`. Default: the newest tag, else `main`. `main` writes `# follows: main`. */
  pin?: string;
  /** Instance name for the README. Default: the folder name. */
  name?: string;
  dryRun?: boolean;
  /** P89: the first project, from this kind (`hub project kinds`). */
  kind?: string;
  /** Slug of that project. Default: the instance name without its `hub-` prefix. */
  project?: string;
  /** False: no `pnpm install`, no install steps, no doctor (`--no-install`). Default true. */
  install?: boolean;
}


export interface InitDeps {
  /** Runs a command; never throws. Tests replace it to avoid starting the real core. */
  run: (cmd: string, args: string[], opts?: { cwd?: string; env?: Record<string, string> }) => Promise<RunResult>;
  log: (msg: string) => void;
  /** The checkout whose templates are copied. Default: the core in use. */
  coreRoot?: string;
  /** Free space in GB on the volume of `dir` (undefined: unknown, not checked). Default: `df -k`. */
  freeGb?: (dir: string) => Promise<number | undefined>;
  /** Today as YYYY-MM-DD, for the project's Settings rows. */
  today?: () => string;
}

/** `df -k <dir>`: available kilobytes of the volume, as GB. */
export async function dfFreeGb(run: InitDeps["run"], dir: string): Promise<number | undefined> {
  const r = await run("df", ["-k", dir]);
  const cols = r.stdout.trim().split("\n").pop()?.trim().split(/\s+/) ?? [];
  const kb = Number(cols[3]);
  return r.code === 0 && Number.isFinite(kb) ? kb / 1024 / 1024 : undefined;
}

/**
 * P89: `hub new-instance <name>`: a bare name becomes the folder `hub-<name>`; a path is used as given. Run inside a git checkout (the
 * core, or an instance), the folder goes NEXT TO that checkout (`toplevel`'s parent), never inside it: an instance inside the public
 * core, or one instance inside another, is one `git add -A` from a leak.
 */
export function instanceDir(name: string, cwd: string, toplevel?: string): string {
  if (name.includes("/") || name.startsWith(".")) return path.resolve(cwd, name);
  const base = toplevel ? path.dirname(toplevel) : cwd;
  return path.join(base, name.startsWith("hub-") ? name : `hub-${name}`);
}

/** The top folder of the git checkout `cwd` is in, or undefined outside one. */
export function gitToplevel(cwd: string): string | undefined {
  const r = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : undefined;
}

/** The GitHub owner of the core's origin (`https://github.com/<owner>/...` or `git@github.com:<owner>/...`), else undefined. */
export function githubOwner(url: string): string | undefined {
  return /github\.com[/:]([^/]+)\//.exec(url)?.[1];
}

/** The one line that makes the instance's PRIVATE repository and pushes it. Printed, never run (P89 verdict 4). */
export function ghCreateLine(coreUrl: string, dir: string, visibility: "private" | "public" = "private"): string {
  const owner = githubOwner(coreUrl) ?? "<your-github-user>";
  return `gh repo create ${owner}/${path.basename(dir)} --${visibility} --source ${JSON.stringify(dir)} --remote origin --push`;
}

export class InitError extends Error {}

/** P91: the one question `hub new-instance` asks on a terminal without `--kind`: the kinds of `hub project kinds`, numbered. */
export function kindQuestion(): string {
  const ks = Object.values(KINDS);
  const w = Math.max(...ks.map((k) => k.id.length));
  return [
    "Which kind is the first project? (`hub project kinds`)",
    ...ks.map((k, i) => `  ${i + 1}. ${k.id.padEnd(w)}  ${k.title}`),
    "Number or name; Enter: no project yet (a session creates it later).",
  ].join("\n");
}

/** The answer to `kindQuestion`: a number or a kind id; empty is no project. */
export function kindFromAnswer(answer: string): { kind?: string } | { error: string } {
  const a = answer.trim();
  if (!a) return {};
  const ids = Object.keys(KINDS);
  const n = /^\d+$/.test(a) ? Number(a) : NaN;
  const kind = Number.isInteger(n) ? ids[n - 1] : ids.find((id) => id === a.toLowerCase());
  return kind ? { kind } : { error: `not a kind: answer 1 to ${ids.length}, a name (${ids.join(", ")}), or Enter for none` };
}

const isLocalPath = (u: string): boolean => u.startsWith("/") || u.startsWith("./") || u.startsWith("../") || u.startsWith("file:");

/** Every file under `root` as relative paths (folders are made by writing their files). */
function filesUnder(root: string, rel = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...filesUnder(root, r));
    else out.push(r);
  }
  return out.sort();
}

/** The files `hub new-instance` writes (template files plus `core.version`). The test pins this list. */
export const templateFiles = (coreRoot: string = CORE_ROOT): string[] => [...new Set([...filesUnder(path.join(coreRoot, INSTANCE_TEMPLATE)), "core.version"])].sort();

export const renderTemplate = (text: string, vars: Record<string, string>): string => text.replace(/\{\{(\w+)\}\}/g, (m, k: string) => vars[k] ?? m);

/** The text of a new `core.version`: header, the one managed mark (`# follows: main` or `# tag: vX.Y.Z`), then the commit. */
export function pinFile(sha: string, mark: { branch?: string; tag?: string }): string {
  return pinMark([
    "# The ONE statement of the core version this instance runs on (decision 0016). Prose elsewhere never restates it.",
    "# First non-comment line: a core commit or tag. `hub doctor` checks the core in use against it.",
    sha,
    "",
  ].join("\n"), mark);
}

/**
 * `hub new-instance <name>`: a new instance repository in one command (plans P35, P89). Git, the core as a submodule at a pin, the files from the template,
 * the skill links, the working folders and config through `hub install --only Files`, then `hub doctor`; ends with one commit. Never pushes,
 * never creates a remote, never touches another folder. Refuses a folder that is not empty. `dryRun` lists what would be written and writes nothing.
 */
export async function initInstance(o: InitOptions, d: InitDeps): Promise<{ dir: string; pin: string; follows: boolean; files: string[]; project?: string; url: string }> {
  const coreRoot = d.coreRoot ?? CORE_ROOT;
  const dir = path.resolve(o.dir);
  if (existsSync(dir) && (!statSync(dir).isDirectory() || readdirSync(dir).length > 0)) throw new InitError(`${dir} is not empty: hub new-instance only creates a new instance`);
  if (!existsSync(path.join(coreRoot, INSTANCE_TEMPLATE))) throw new InitError(`the core at ${coreRoot} has no ${INSTANCE_TEMPLATE}: update the core first`);

  const url = o.coreUrl ?? (await d.run("git", ["-C", coreRoot, "remote", "get-url", "origin"])).stdout.trim();
  if (!url) throw new InitError("no core repository URL: pass --core-url <url> (the core in use has no origin)");

  let pin = o.pin;
  if (!pin) {
    const tags = await d.run("git", ["ls-remote", "--tags", "--refs", "--sort=-v:refname", url]);
    // Only a vX.Y.Z tag is a version: a tag such as `backup-2026` is never pinned.
    const first = tags.stdout.split("\n").map((l) => l.split("refs/tags/")[1]).find((n): n is string => !!n && VERSION_TAG.test(n));
    pin = first ?? "main";
  }
  if (pin !== "main" && !VERSION_TAG.test(pin)) throw new InitError(`--pin must be a vX.Y.Z tag or main, not ${pin}`);
  const follows = pin === "main";
  const project = o.kind ? (o.project ?? path.basename(dir).replace(/^hub-/, "")) : undefined;
  const files = templateFiles(coreRoot);
  if (o.dryRun) {
    d.log(`would create ${dir}: git init, core submodule ${url} at ${follows ? "main (follows)" : pin}, and ${files.length} files:`);
    for (const f of files) d.log(`  ${f}`);
    if (project) d.log(`  projects/${project}/ (kind ${o.kind}: project.md, knowledge/, workflows/, sequences/, @dev/)`);
    return { dir, pin, follows, files, url, ...(project ? { project } : {}) };
  }

  const git = async (...a: string[]) => {
    const r = await d.run("git", ["-C", dir, ...a]);
    if (r.code !== 0) throw new InitError(`git ${a.join(" ")} failed: ${(r.stderr || r.stdout).trim().split("\n")[0]}`);
    return r;
  };
  mkdirSync(dir, { recursive: true });
  await git("init", "-q", "-b", "main");
  const proto = isLocalPath(url) ? ["-c", "protocol.file.allow=always"] : [];
  await git(...proto, "submodule", "add", "-q", url, "core");
  const target = follows ? "origin/main" : pin;
  await git("-C", "core", "checkout", "-q", "--detach", target).catch(async () => { throw new InitError(`the core has no ${follows ? "main" : `tag ${pin}`}: pass --pin <tag|main>`); });
  const sha = (await git("-C", "core", "rev-parse", "HEAD")).stdout.trim();

  const vars = { NAME: o.name ?? path.basename(dir) };
  const src = path.join(coreRoot, INSTANCE_TEMPLATE);
  for (const f of filesUnder(src)) {
    const dst = path.join(dir, f);
    mkdirSync(path.dirname(dst), { recursive: true });
    // A link stays a link (AGENTS.md -> CLAUDE.md): two copies of one page drift apart.
    if (lstatSync(path.join(src, f)).isSymbolicLink()) { symlinkSync(readlinkSync(path.join(src, f)), dst); continue; }
    const text = readFileSync(path.join(src, f), "utf8");
    writeFileSync(dst, renderTemplate(text, vars));
    chmodSync(dst, statSync(path.join(src, f)).mode & 0o777);
  }
  writeFileSync(path.join(dir, "core.version"), pinFile(sha, follows ? { branch: "main" } : { tag: pin }));
  if (project && o.kind) {
    try { scaffoldProject(dir, coreRoot, project, o.kind, d.today?.() ?? new Date().toLocaleDateString("en-CA")); }
    catch (e) { throw new InitError((e as Error).message); }
    d.log(`first project: projects/${project}/ (kind ${o.kind}); in a session say «настрой проект ${project}»`);
  }

  // From here the instance's own pinned core does the work: working folders, config defaults, skill links, then the checks.
  const install = o.install !== false;
  syncInstanceSkills(hubPaths({ core: path.join(dir, "core"), home: dir, env: {} }));
  const hub = path.join(dir, "core", "hub.sh");
  const env = { HUB_HOME: dir };
  // The pinned core needs its dependencies before its `hub` runs (a fresh submodule has none).
  const app = path.join(dir, "core", "app");
  let ready = existsSync(path.join(app, "node_modules"));
  const free = install && !ready ? await (d.freeGb ?? ((x: string) => dfFreeGb(d.run, x)))(dir) : undefined;
  if (!install) {
    ready = false;
    d.log("dependencies not installed (--no-install): run ./run.sh setup in the instance when you want it running");
  } else if (!ready && free !== undefined && free < MIN_FREE_GB) {
    d.log(`only ${free.toFixed(1)} GB free (under ${MIN_FREE_GB} GB): pnpm install skipped. Free space, then run ./run.sh setup in the instance`);
  } else if (!ready) {
    d.log("installing the core's dependencies (pnpm install --frozen-lockfile)...");
    const r = await d.run("pnpm", ["install", "--frozen-lockfile"], { cwd: app });
    ready = r.code === 0;
    if (!ready) d.log(`pnpm install failed (${(r.stderr || r.stdout).trim().split("\n")[0] ?? "no output"}): run ./install.sh in core/ once, then ./run.sh install --only Files and ./run.sh doctor`);
  }
  if (ready && install) {
    for (const args of [["install", "--only", "Files"], ["doctor"]]) {
      const r = await d.run(hub, args, { cwd: dir, env });
      for (const l of (r.stdout + r.stderr).split("\n").filter(Boolean)) d.log(l);
    }
  }
  await git("add", "-A");
  // A failed commit (no user.name, a hook) is an error, not a success with nothing committed.
  const commit = await d.run("git", ["-C", dir, "commit", "-q", "-m", `instance: created by hub new-instance, core pinned at ${sha.slice(0, 9)}${follows ? " (follows main)" : ` (${pin})`}${project ? `, project ${project} (${o.kind})` : ""}`]);
  if (commit.code !== 0) throw new InitError(`the instance was created in ${dir} but git commit failed: ${(commit.stderr || commit.stdout).trim().split("\n")[0] || "no detail"}. Set git user.name and user.email, then run \`git -C ${dir} add -A && git -C ${dir} commit\``);
  return { dir, pin, follows, files, url, ...(project ? { project } : {}) };
}


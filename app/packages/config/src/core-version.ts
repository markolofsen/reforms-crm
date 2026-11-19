// P68: which core an instance runs, and whether its origin has a newer one. The one owner of the pin file's reading, of what a
// version tag is, of their order, of the judge ("is it worth updating") and of the tag check with its cache. Node only. It spawns
// nothing itself: every git call goes through the `run` the caller hands in (the installer's `ctx.run`, the server's `execFile`
// wrapper), so this package keeps no runtime dependency and the tests need no git.
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CORE_LEVELS, type CoreLevel } from "./index";
import { INSTANCE_MARKER, type HubPaths } from "./paths";

/** A version tag: the only kind of tag an instance is ever moved to, pinned at, or told about. */
export const VERSION_TAG = /^v\d+\.\d+\.\d+$/;
/** The marker a release writes in its tag's first line when every instance must take it (a security or data fix). */
export const REQUIRED_MARK = /\[update:\s*required\]/i;

const parts = (t: string): [number, number, number] => {
  const [a = 0, b = 0, c = 0] = t.slice(1).split(".").map(Number);
  return [a, b, c];
};
/** Semver order of two `vX.Y.Z` tags: negative when `a` is older. */
export function compareVersions(a: string, b: string): number {
  const x = parts(a), y = parts(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}
/** The version tags of a list, oldest first; anything else is dropped. */
export const sortVersions = (names: Iterable<string>): string[] => [...new Set(names)].filter((t) => VERSION_TAG.test(t)).sort(compareVersions);

/** `core.version` read: the pin (first line that is not blank and not `#`), and the managed comment above it (`# tag:` or `# follows:`). */
export interface PinFile { pin?: string; tag?: string; follows?: string }

/** The instance's pin file, or undefined when there is none. */
export function readPinFile(home: string): PinFile | undefined {
  const f = join(home, INSTANCE_MARKER);
  if (!existsSync(f)) return undefined;
  const lines = readFileSync(f, "utf8").split("\n").map((l) => l.trim());
  const out: PinFile = {};
  const pin = lines.find((l) => l && !l.startsWith("#"));
  if (pin) out.pin = pin;
  const tag = lines.map((l) => /^#\s*tag:\s*(\S+)/.exec(l)?.[1]).find((t) => t && VERSION_TAG.test(t));
  if (tag) out.tag = tag;
  const follows = lines.map((l) => /^#\s*follows:\s*(\S+)/.exec(l)?.[1]).find(Boolean);
  if (follows) out.follows = follows;
  return out;
}

/** The pinned version: the first line of `core.version` that is not blank and not a `#` comment. */
export const readCoreVersion = (home: string): string | undefined => readPinFile(home)?.pin;

/** How the pin is named to a person: its tag (the managed comment, or the pin itself), else the short commit. */
export function pinLabel(f: PinFile | undefined): string | null {
  if (!f?.pin) return null;
  if (VERSION_TAG.test(f.pin)) return f.pin;
  return f.tag ?? f.pin.slice(0, 9);
}

// ---- the judge (pure) ----

export interface CoreTag { name: string; date: string | null; subject: string }
export interface CoreFacts { dependencies: boolean; migrations: boolean; rollback: boolean }
/** The answer the server caches in `<state>/core-update.json` and serves; `@hub/contract/instance` `coreUpdateDto` is its wire form. */
export interface CoreUpdate {
  pin: string | null;
  inUse: string | null;
  follows?: { branch: string; behind: number | null };
  newest?: string;
  level: CoreLevel;
  reason: string;
  /** The tags newer than the pin, newest first, at most {@link SHOWN_TAGS}. */
  tags: CoreTag[];
  facts: CoreFacts;
  /** The instance's own lines to run, in order; empty when there is nothing to do. */
  command: string[];
  /** The last check that reached the origin. */
  checkedAt?: string;
  /** The last check that did not; the rest is the last good answer. */
  error?: { at: string; message: string };
  /** `core/` is a link to a local checkout (`hub core dev`): nothing to check, never a tag to move to (UX pass 2026-11-20). */
  local?: true;
}

export const SHOWN_TAGS = 10;
/** Patch releases behind before a move is recommended. */
export const PATCHES_RECOMMENDED = 5;
/** Days between the pin's tag and the newest tag before a move is recommended. */
export const DAYS_RECOMMENDED = 14;
const NO_FACTS: CoreFacts = { dependencies: false, migrations: false, rollback: false };

export interface JudgeInput {
  home: string;
  /** The pin as a person reads it ({@link pinLabel}). */
  pin: string | null;
  inUse: string | null;
  /** The version tag at the pin, or the nearest one below a bare commit; undefined: no version tag at or below it. */
  base?: { name: string; date: string | null; exact: boolean };
  /** Every version tag of the origin with what the local repository knows of it (date and subject empty when its objects are not local). */
  tags: CoreTag[];
  facts?: CoreFacts;
  follows?: { branch: string; behind: number | null };
  /** The instance has its own workspace files (decision 0018): `core update` regenerates them, so the commit names them. */
  workspace?: boolean;
  /** One more clause for the reason (a fetch that was skipped, a tag that moved). */
  note?: string;
}

const DAY = 86_400_000;
const daysBetween = (a: string | null | undefined, b: string | null | undefined): number | null => {
  const x = a ? Date.parse(a) : NaN, y = b ? Date.parse(b) : NaN;
  return Number.isNaN(x) || Number.isNaN(y) ? null : Math.floor((y - x) / DAY);
};
export const WORKSPACE_FILES = ["package.json", "pnpm-workspace.yaml", "turbo.json"] as const;

/** The three lines that move this instance to `tag`: plan and move, commit, restart (the server runs the new core only after it). */
export function updateCommand(home: string, tag: string, workspace = false): string[] {
  return [`cd ${home} && ./run.sh core update ${tag} --apply`, `git add core core.version${workspace ? ` ${WORKSPACE_FILES.join(" ")}` : ""} && git commit -m "core: ${tag}"`, "./run.sh restart"];
}

/** Verdict 4 of P68: the level, its reason in one sentence, the newer tags and the command. No I/O. */
export function judgeCoreUpdate(i: JudgeInput): Omit<CoreUpdate, "checkedAt" | "error"> {
  const facts = i.facts ?? NO_FACTS;
  const head = { pin: i.pin, inUse: i.inUse };
  const note = i.note ? `; ${i.note}` : "";
  const all = sortVersions(i.tags.map((t) => t.name));
  const byName = new Map(i.tags.map((t) => [t.name, t]));
  if (i.follows) {
    const b = i.follows.behind;
    const where = b === null ? `the tip of origin/${i.follows.branch} is not known yet` : b === 0 ? `at the tip of origin/${i.follows.branch}` : `${b} commit(s) behind origin/${i.follows.branch}`;
    return { ...head, follows: i.follows, level: "follows", reason: `follows ${i.follows.branch}: ${where}${note}`, tags: [], facts, command: b ? [`cd ${i.home} && ./run.sh core update --branch ${i.follows.branch} --apply`, `git add core core.version${i.workspace ? ` ${WORKSPACE_FILES.join(" ")}` : ""} && git commit -m "core: ${i.follows.branch}"`, "./run.sh restart"] : [] };
  }
  const newest = all.at(-1);
  const base = i.base;
  const newer = base ? all.filter((t) => compareVersions(t, base.name) > 0) : all;
  const shown = newer.slice().reverse().slice(0, SHOWN_TAGS).map((n) => byName.get(n) ?? { name: n, date: null, subject: "" });
  const withNewest = newest ? { newest } : {};
  if (!newer.length || !newest) {
    if (base && newest && compareVersions(base.name, newest) > 0) return { ...head, ...withNewest, level: "current", reason: `the pin ${base.name} is newer than the newest tag of origin (${newest}): a tag was moved or deleted there${note}`, tags: [], facts: { ...facts, rollback: true }, command: [] };
    return { ...head, ...withNewest, level: "current", reason: `${base ? (base.exact ? base.name : `a commit after ${base.name}`) : "this core"} is the newest release${note}`, tags: [], facts, command: [] };
  }
  const what = [facts.migrations ? "database migrates" : "", facts.dependencies ? "dependencies change" : ""].filter(Boolean).join(", ");
  const tail = `${what ? `; ${what}` : ""}${note}`;
  const command = updateCommand(i.home, newest, i.workspace);
  const marked = newer.map((n) => byName.get(n)).find((t) => t && REQUIRED_MARK.test(t.subject));
  const out = { ...head, newest, tags: shown, facts, command };
  if (marked) return { ...out, level: "required", reason: `${marked.name} is marked [update: required]${tail}` };
  if (!base) return { ...out, level: "recommended", reason: `the pin is a commit with no version tag at or below it; origin has ${newest}${tail}` };
  const [bMaj, bMin] = parts(base.name), [nMaj, nMin] = parts(newest);
  const age = daysBetween(base.date, byName.get(newest)?.date);
  const count = `${newer.length} newer release${newer.length === 1 ? "" : "s"}`;
  if (nMaj !== bMaj || nMin !== bMin) return { ...out, level: "recommended", reason: `${newest} is a new ${nMaj !== bMaj ? "major" : "minor"} version (${count})${tail}` };
  if (newer.length >= PATCHES_RECOMMENDED) return { ...out, level: "recommended", reason: `${count} behind${tail}` };
  if (age !== null && age >= DAYS_RECOMMENDED) return { ...out, level: "recommended", reason: `${newest} is ${age} days newer than ${base.name}${tail}` };
  return { ...out, level: "available", reason: `${count} (patch${newer.length === 1 ? "" : "es"})${tail}` };
}

// ---- the check (git through the injected runner) ----

export interface RunResult { code: number; stdout: string; stderr: string }
/** The caller's process runner: argv only, a timeout, extra environment. */
export type CommandRun = (cmd: string, args: string[], opts?: { env?: Record<string, string>; timeoutMs?: number }) => Promise<RunResult>;

/** The origin did not answer (offline, a captive network, a private repository): the last good answer is kept. */
export class CoreCheckError extends Error {}

/** No prompt for a login, ever: a repository that turns private fails fast with a reason instead of waiting on a terminal. */
const NO_PROMPT = { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "" };
export const LS_REMOTE_MS = 15_000;
const FETCH_MS = 60_000;
const firstLine = (r: RunResult): string => (r.stderr || r.stdout).trim().split("\n").find(Boolean)?.slice(0, 200) ?? `exit ${r.code}`;

/** `git ls-remote --refs` output: version tags and branch heads by name. */
export function parseLsRemote(out: string): { tags: Map<string, string>; heads: Map<string, string> } {
  const tags = new Map<string, string>(), heads = new Map<string, string>();
  for (const line of out.split("\n")) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (!sha || !ref) continue;
    if (ref.startsWith("refs/tags/") && VERSION_TAG.test(ref.slice(10))) tags.set(ref.slice(10), sha);
    else if (ref.startsWith("refs/heads/")) heads.set(ref.slice(11), sha);
  }
  return { tags, heads };
}

/** Whether `core/` is a link to a local checkout (`hub core dev`). */
export const isLocalCore = (home: string): boolean => lstatSync(join(home, "core"), { throwIfNoEntry: false })?.isSymbolicLink() ?? false;

/** The answer while `core/` is a local checkout: no check, no command, and `local` so the admin says it in one line. */
export const localCoreUpdate = (home: string): CoreUpdate => ({ ...uncheckedCoreUpdate(home, "core/ is a link to a local checkout (hub core dev): no update check"), local: true });

/** The "not checked" answer: the pin from the file, nothing else known. */
export function uncheckedCoreUpdate(home: string, reason = "not checked yet"): CoreUpdate {
  return { pin: pinLabel(readPinFile(home)), inUse: null, level: "unknown", reason, tags: [], facts: NO_FACTS, command: [] };
}

/**
 * One check (verdict 2): `git ls-remote --refs origin` in the core (writes nothing), then, only when origin has a version tag newer
 * than the pin that the core does not hold (or a branch tip it lacks), one `git fetch --tags origin` (no `--force`: a moved tag is
 * reported, never taken; a fetch that meets a lock is skipped until the next run). The subjects and the facts come from the local
 * objects. Throws {@link CoreCheckError} when the origin does not answer.
 */
export async function checkCoreUpdates(run: CommandRun, paths: Pick<HubPaths, "home" | "core">, now: () => Date = () => new Date()): Promise<CoreUpdate> {
  const git = (args: string[], timeoutMs = 10_000, env?: Record<string, string>) => run("git", ["-C", paths.core, ...args], { timeoutMs, ...(env ? { env } : {}) });
  const file = readPinFile(paths.home);
  if (!file?.pin) return uncheckedCoreUpdate(paths.home, `${INSTANCE_MARKER} is missing or empty`);
  if (isLocalCore(paths.home)) return localCoreUpdate(paths.home);
  const head = await git(["rev-parse", "HEAD"]);
  if (head.code !== 0) return uncheckedCoreUpdate(paths.home, "the core is not a git checkout: no update check");
  const inUse = (await git(["describe", "--tags", "--exact-match", "HEAD"])).stdout.trim() || head.stdout.trim().slice(0, 9);
  const remote = await git(["ls-remote", "--refs", "origin"], LS_REMOTE_MS, NO_PROMPT);
  if (remote.code !== 0) throw new CoreCheckError(`origin unreachable: ${firstLine(remote)}`);
  const { tags: remoteTags, heads } = parseLsRemote(remote.stdout);
  const pinCommit = (await git(["rev-parse", "--verify", "--quiet", `${file.pin}^{commit}`])).stdout.trim() || head.stdout.trim();
  const local = new Set((await git(["tag", "--list"])).stdout.split("\n").map((t) => t.trim()).filter(Boolean));
  const branch = file.follows;
  const tip = branch ? heads.get(branch) : undefined;
  const tipLocal = tip ? (await git(["cat-file", "-e", `${tip}^{commit}`])).code === 0 : true;
  const at = sortVersions((await git(["tag", "--points-at", pinCommit])).stdout.split("\n").map((t) => t.trim()));
  let baseName = file.tag && at.includes(file.tag) ? file.tag : at.at(-1);
  const exact = !!baseName;
  if (!baseName) baseName = (await git(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", pinCommit])).stdout.trim() || undefined;
  if (baseName && !VERSION_TAG.test(baseName)) baseName = undefined;
  const wanted = sortVersions(remoteTags.keys()).filter((t) => !baseName || compareVersions(t, baseName) > 0);
  let note: string | undefined;
  if (wanted.some((t) => !local.has(t)) || !tipLocal) {
    const f = await git(["fetch", "--tags", "origin"], FETCH_MS, NO_PROMPT);
    if (f.code !== 0) note = /\.lock\b|unable to lock|another git process/i.test(f.stderr) ? "a fetch was skipped (the core is locked: a `core update` is running); the next check retries" : /would clobber|rejected/i.test(f.stderr) ? `a tag moved on origin and was not taken: ${firstLine(f)}` : `fetch failed: ${firstLine(f)}`;
  }
  const meta = new Map<string, CoreTag>();
  for (const line of (await git(["for-each-ref", "refs/tags", "--format=%(refname:strip=2)%09%(creatordate:iso-strict)%09%(contents:subject)"])).stdout.split("\n")) {
    const [name, date, ...subject] = line.split("\t");
    if (name && VERSION_TAG.test(name)) meta.set(name, { name, date: date || null, subject: subject.join("\t").trim() });
  }
  const tags = sortVersions(remoteTags.keys()).map((n) => meta.get(n) ?? { name: n, date: null, subject: "" });
  const newest = wanted.at(-1);
  const newestLocal = newest ? (await git(["rev-parse", "--verify", "--quiet", `${newest}^{commit}`])).stdout.trim() : "";
  let facts = NO_FACTS;
  if (newestLocal) {
    const lock = await git(["diff", "--quiet", pinCommit, newestLocal, "--", "app/pnpm-lock.yaml"]);
    const added = await git(["diff", "--name-only", "--diff-filter=A", pinCommit, newestLocal, "--", "app/packages/db/drizzle"]);
    facts = { dependencies: lock.code === 1, migrations: added.stdout.split("\n").some((l) => l.trim().endsWith(".sql")), rollback: false };
  }
  let follows: JudgeInput["follows"];
  if (branch) {
    const n = tip ? await git(["rev-list", "--count", `${pinCommit}..${tip}`]) : undefined;
    follows = { branch, behind: n && n.code === 0 ? Number(n.stdout.trim()) : null };
  }
  const base = baseName ? { name: baseName, date: meta.get(baseName)?.date ?? null, exact } : undefined;
  const judged = judgeCoreUpdate({ home: paths.home, pin: pinLabel(file), inUse, ...(base ? { base } : {}), tags, facts, ...(follows ? { follows } : {}), workspace: existsSync(join(paths.home, "pnpm-workspace.yaml")), ...(note ? { note } : {}) });
  return { ...judged, checkedAt: now().toISOString() };
}

// ---- the cache ----

const isLevel = (v: unknown): v is CoreLevel => CORE_LEVELS.some((l) => l === v);

/** The cached answer, or undefined when there is none or it is not one (the server's strict parse is the full check). */
export function readCoreUpdateCache(file: string): CoreUpdate | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  const r: Partial<Record<string, unknown>> = raw;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const obj = (v: unknown): Partial<Record<string, unknown>> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? v : null);
  if (!isLevel(r.level) || typeof r.reason !== "string" || !Array.isArray(r.tags) || !Array.isArray(r.command)) return undefined;
  const facts = obj(r.facts);
  const out: CoreUpdate = {
    pin: str(r.pin),
    inUse: str(r.inUse),
    level: r.level,
    reason: r.reason,
    tags: r.tags.flatMap((t) => {
      const o = obj(t);
      const name = str(o?.name);
      return o && name ? [{ name, date: str(o.date), subject: str(o.subject) ?? "" }] : [];
    }),
    facts: { dependencies: facts?.dependencies === true, migrations: facts?.migrations === true, rollback: facts?.rollback === true },
    command: r.command.filter((l): l is string => typeof l === "string"),
  };
  const follows = obj(r.follows);
  const branch = str(follows?.branch);
  if (follows && branch) out.follows = { branch, behind: typeof follows.behind === "number" ? follows.behind : null };
  const newest = str(r.newest);
  if (newest) out.newest = newest;
  const checkedAt = str(r.checkedAt);
  if (checkedAt) out.checkedAt = checkedAt;
  const error = obj(r.error);
  const at = str(error?.at), message = str(error?.message);
  if (at && message) out.error = { at, message };
  return out;
}

/** Atomic: a reader never sees half a file. */
export function writeCoreUpdateCache(file: string, value: CoreUpdate): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

/** The cache, unless the pin moved since it was written (then the answer is about another core: "not checked since"). */
export function currentCoreUpdate(paths: Pick<HubPaths, "home" | "coreUpdate">): CoreUpdate {
  const cached = readCoreUpdateCache(paths.coreUpdate);
  const pin = pinLabel(readPinFile(paths.home));
  if (isLocalCore(paths.home)) return localCoreUpdate(paths.home);
  if (!cached) return uncheckedCoreUpdate(paths.home);
  if (cached.pin !== pin) return uncheckedCoreUpdate(paths.home, `the pin moved to ${pin ?? "nothing"} since the last check`);
  return cached;
}

/** A check and its cache write: a failure keeps the last good answer and adds `error` (when and why), never an empty page. */
export async function refreshCoreUpdate(run: CommandRun, paths: Pick<HubPaths, "home" | "core" | "coreUpdate">, now: () => Date = () => new Date()): Promise<CoreUpdate> {
  let next: CoreUpdate;
  try {
    next = await checkCoreUpdates(run, paths, now);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    next = { ...currentCoreUpdate(paths), error: { at: now().toISOString(), message } };
  }
  writeCoreUpdateCache(paths.coreUpdate, next);
  return next;
}

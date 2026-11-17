import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CORE_ROOT, hubPaths } from "@hub/config/paths";
import type { RunResult } from "./context";
import { pinMark, VERSION_TAG } from "./core-update";
import { syncInstanceSkills } from "./instance-skills";

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
}

export interface InitDeps {
  /** Runs a command; never throws. Tests replace it to avoid starting the real core. */
  run: (cmd: string, args: string[], opts?: { cwd?: string; env?: Record<string, string> }) => Promise<RunResult>;
  log: (msg: string) => void;
  /** The checkout whose templates are copied. Default: the core in use. */
  coreRoot?: string;
}

export class InitError extends Error {}

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

/** The files `hub init` writes (template files plus `core.version`). The test pins this list. */
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
 * `hub init <dir>`: a new instance repository in one command (plan P35). Git, the core as a submodule at a pin, the files from the template,
 * the skill links, the working folders and config through `hub install --only Files`, then `hub doctor`; ends with one commit. Never pushes,
 * never creates a remote, never touches another folder. Refuses a folder that is not empty. `dryRun` lists what would be written and writes nothing.
 */
export async function initInstance(o: InitOptions, d: InitDeps): Promise<{ dir: string; pin: string; follows: boolean; files: string[] }> {
  const coreRoot = d.coreRoot ?? CORE_ROOT;
  const dir = path.resolve(o.dir);
  if (existsSync(dir) && (!statSync(dir).isDirectory() || readdirSync(dir).length > 0)) throw new InitError(`${dir} is not empty: hub init only creates a new instance`);
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
  const files = templateFiles(coreRoot);
  if (o.dryRun) {
    d.log(`would create ${dir}: git init, core submodule ${url} at ${follows ? "main (follows)" : pin}, and ${files.length} files:`);
    for (const f of files) d.log(`  ${f}`);
    return { dir, pin, follows, files };
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
    const text = readFileSync(path.join(src, f), "utf8");
    writeFileSync(dst, renderTemplate(text, vars));
    chmodSync(dst, statSync(path.join(src, f)).mode & 0o777);
  }
  writeFileSync(path.join(dir, "core.version"), pinFile(sha, follows ? { branch: "main" } : { tag: pin }));

  // From here the instance's own pinned core does the work: working folders, config defaults, skill links, then the checks.
  const paths = hubPaths({ core: path.join(dir, "core"), home: dir, env: {} });
  syncInstanceSkills(paths);
  const hub = path.join(dir, "core", "hub.sh");
  const env = { HUB_HOME: dir };
  // The pinned core needs its dependencies before its `hub` runs (a fresh submodule has none).
  const app = path.join(dir, "core", "app");
  let ready = existsSync(path.join(app, "node_modules"));
  if (!ready) {
    d.log("installing the core's dependencies (pnpm install --frozen-lockfile)...");
    const r = await d.run("pnpm", ["install", "--frozen-lockfile"], { cwd: app });
    ready = r.code === 0;
    if (!ready) d.log(`pnpm install failed (${(r.stderr || r.stdout).trim().split("\n")[0] ?? "no output"}): run ./install.sh in core/ once, then ./run.sh install --only Files and ./run.sh doctor`);
  }
  if (ready) {
    for (const args of [["install", "--only", "Files"], ["doctor"]]) {
      const r = await d.run(hub, args, { cwd: dir, env });
      for (const l of (r.stdout + r.stderr).split("\n").filter(Boolean)) d.log(l);
    }
  }
  await git("add", "-A");
  // A failed commit (no user.name, a hook) is an error, not a success with nothing committed.
  const commit = await d.run("git", ["-C", dir, "commit", "-q", "-m", `instance: created by hub init, core pinned at ${sha.slice(0, 9)}${follows ? " (follows main)" : ` (${pin})`}`]);
  if (commit.code !== 0) throw new InitError(`the instance was created in ${dir} but git commit failed: ${(commit.stderr || commit.stdout).trim().split("\n")[0] || "no detail"}. Set git user.name and user.email, then run \`git -C ${dir} add -A && git -C ${dir} commit\``);
  return { dir, pin, follows, files };
}


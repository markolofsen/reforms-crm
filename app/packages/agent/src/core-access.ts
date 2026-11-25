import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

// P159 part 2 (owner 2026-11-26: «Надо убрать сэндбокс, чтобы наш агент мог спокойно работать с Core Reforms Hub… улучшать
// общие инструкции, скиллы»; the coordinator's delegated decision): an attended session improves the core through git
// worktrees, never through the main checkout's files, which the running server reads live (half-edited files there broke the
// dock three times on 2026-11-25). Writable: the core's git dir (refs, objects, worktree metadata), but its hooks and config
// (shared by every worktree: a planted hook would run unsandboxed in the next writer's commit), and one folder of worktrees
// beside the core, `<core>-dock/<topic>`. Read-only: every other entry of the main checkout. Main moves only by a push whose
// change is text the server does not compile (`skills/`, `@docs/`); the guard refuses the rest (`coreGitViolations`).

/** Where a session may write in the core, derived from the instance's core link (`paths.core`), never hard-coded. */
export interface CoreAccess {
  /** The main checkout (real path). */
  core: string;
  /** Its git dir: writable. */
  gitDir: string;
  /** The worktree folder beside the core: writable. */
  dock: string;
  /** Read-only inside the writable git dir: its hooks and config. */
  gitReadOnly: string[];
  /** Read-only: every entry of the main checkout but `.git`. */
  checkout: string[];
}

const real = (p: string): string => { try { return realpathSync(p); } catch { return path.resolve(p); } };

export function coreAccess(core: string): CoreAccess {
  const root = real(core);
  const gitDir = path.join(root, ".git");
  const checkout = existsSync(root) ? readdirSync(root).filter((e) => e !== ".git").map((e) => path.join(root, e)) : [root];
  return { core: root, gitDir, dock: `${root}-dock`, gitReadOnly: [path.join(gitDir, "hooks"), path.join(gitDir, "config")], checkout };
}

/** The paths that may change the core's `main` without a guard: text the running server does not compile. */
export const CORE_PUBLISHABLE: readonly string[] = ["skills/", "@docs/"];

/** One shell word list per simple command of a Bash line (split on `;`, `&&`, `||`, `|`, newlines; quotes kept together). */
export function commandsOf(line: string): string[][] {
  const out: string[][] = [];
  let words: string[] = [];
  let w = "";
  let has = false;
  let q: string | null = null;
  const end = () => { if (has) words.push(w); w = ""; has = false; };
  const cut = () => { end(); if (words.length) out.push(words); words = []; };
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) { if (c === q) q = null; else if (c === "\\" && q === '"' && i + 1 < line.length) w += line[++i]; else w += c; continue; }
    if (c === "'" || c === '"') { q = c; has = true; continue; }
    if (c === "\\" && i + 1 < line.length) { w += line[++i]; has = true; continue; }
    if (c === " " || c === "\t") { end(); continue; }
    if (c === ";" || c === "\n" || c === "|" || c === "&") { cut(); continue; }
    w += c; has = true;
  }
  cut();
  return out;
}

/** A git command's working folder (`-C`, applied in order, from `cwd`), its subcommand and that subcommand's arguments. */
function gitParts(words: string[], cwd: string): { dir: string; sub: string; args: string[] } | null {
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!)) i++; // VAR=x git ...
  if (!words[i] || path.basename(words[i]!) !== "git") return null;
  i++;
  let dir = cwd;
  while (i < words.length && words[i]!.startsWith("-")) {
    const o = words[i]!;
    if (o === "-C") { dir = path.resolve(dir, words[i + 1] ?? "."); i += 2; continue; }
    if (o === "-c" || o === "--git-dir" || o === "--work-tree" || o === "--namespace") { i += 2; continue; }
    i++;
  }
  return { dir, sub: words[i] ?? "", args: words.slice(i + 1) };
}

/** What a session's git may not do to the core's main checkout or its `main` (P159). */
const CHECKOUT_MUTATIONS = new Set(["merge", "pull", "reset", "checkout", "switch", "rebase", "commit", "stash", "cherry-pick", "revert", "am", "restore", "rm", "mv", "add", "apply", "clean", "symbolic-ref", "update-ref", "config"]);
const MAIN = new Set(["main", "refs/heads/main"]);
const FORCE = /^(-f|--force|--force-with-lease.*|--force-if-includes|--mirror|--all|--delete|-d|--prune|--receive-pack.*|--exec.*|--repo.*|-u|--set-upstream)$/;

export interface GitProbe { commonDir(dir: string): string | null; changed(dir: string, from: string, to: string): string[] | null; branch(dir: string): string | null }

const git = (dir: string, args: string[]): string | null => {
  try { return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
};

export const realGitProbe: GitProbe = {
  commonDir: (dir) => { const d = git(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]); return d ? real(d) : null; },
  changed: (dir, from, to) => { const d = git(dir, ["diff", "--name-only", `${from}...${to}`]); return d === null ? null : d.split("\n").filter(Boolean); },
  branch: (dir) => git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]),
};

/**
 * The guard's core rule (P159): a Bash call's git commands against the core repository. In the main checkout nothing that moves
 * its HEAD, index, files or config; anywhere in the repo no `update-ref`, no `branch -f/-D/-M` of main, no force, mirror, delete
 * or upstream-setting push, no push to a remote other than `origin`; a push to `main` only of a change inside
 * {@link CORE_PUBLISHABLE} against `origin/main` (fail closed: a diff that cannot be read is refused). Returns the refusals.
 */
export function coreGitViolations(command: string, cwd: string, core: string, probe: GitProbe = realGitProbe): string[] {
  const root = real(core);
  const common = path.join(root, ".git");
  const out: string[] = [];
  for (const words of commandsOf(command)) {
    const g = gitParts(words, cwd);
    if (!g || !g.sub) continue;
    const dir = real(g.dir);
    const inCore = dir === root || dir.startsWith(`${root}${path.sep}`) || dir === `${root}-dock` || dir.startsWith(`${root}-dock${path.sep}`) || probe.commonDir(dir) === common;
    if (!inCore) continue;
    const say = (why: string) => out.push(`git ${g.sub} refused in the core repository (P159): ${why}`);
    const reads = g.sub === "config" && g.args.some((a) => /^(--get.*|--list|-l|--show-origin)$/.test(a));
    if (reads) continue;
    if ((dir === root || dir.startsWith(`${root}${path.sep}`)) && CHECKOUT_MUTATIONS.has(g.sub)) { say("the main checkout is the live server's; work in a worktree under the core's -dock folder (git -C <core> worktree add <core>-dock/<topic> -b dock/<topic> origin/main)"); continue; }
    if (g.sub === "update-ref" || g.sub === "symbolic-ref" || g.sub === "config") { say("refs and the repository config are not a session's to set"); continue; }
    if (g.sub === "branch" && g.args.some((a) => /^-(-force|f|D|M|m|-delete|d|-move)$/.test(a)) && g.args.some((a) => MAIN.has(a))) { say("main is moved only by a push of a skills/@docs change"); continue; }
    if (g.sub !== "push") continue;
    const flags = g.args.filter((a) => a.startsWith("-"));
    const rest = g.args.filter((a) => !a.startsWith("-"));
    const bad = flags.find((f) => FORCE.test(f));
    if (bad) { say(`${bad} is not allowed (no force, mirror, delete or upstream setting)`); continue; }
    if (rest.length && rest[0] !== "origin") { say(`push only to origin, not ${rest[0]}`); continue; }
    const specs = rest.slice(1);
    if (!specs.length) { const b = probe.branch(dir); if (b === "main" || b === null) say("name the branch: git push origin dock/<topic>"); continue; }
    for (const s of specs) {
      if (s.startsWith("+") || s.startsWith(":")) { say(`${s}: no forced or deleting refspec`); continue; }
      const [src, dst] = s.includes(":") ? [s.slice(0, s.indexOf(":")), s.slice(s.indexOf(":") + 1)] : [s, s];
      const toMain = MAIN.has(dst) || (dst === "HEAD" && probe.branch(dir) === "main");
      if (!toMain) continue;
      if (MAIN.has(src)) { say("push a worktree branch to main (git push origin dock/<topic>:main), never main itself"); continue; }
      const files = probe.changed(dir, "origin/main", src || "HEAD");
      if (files === null) { say(`the change of ${src} against origin/main cannot be read (git fetch origin first)`); continue; }
      const other = files.filter((f) => !CORE_PUBLISHABLE.some((p) => f.startsWith(p)));
      if (!files.length) say(`${src} changes nothing against origin/main`);
      else if (other.length) say(`${src} changes ${other.slice(0, 5).join(", ")}${other.length > 5 ? ` and ${other.length - 5} more` : ""} outside skills/ and @docs/: push the branch (git push origin ${src}) and hand it to the coordinator`);
    }
  }
  return out;
}

/**
 * Codex has no guard hook: these prefixes are its belt for the core rule (P159), refused without a prompt. A prefix cannot see a
 * `-C` folder or a refspec, so the rule on main is mostly the session text there (and Codex cannot push: the credential is closed).
 */
export const CODEX_CORE_FORBIDDEN: ReadonlyArray<readonly string[]> = [["git", "update-ref"], ["git", "symbolic-ref"], ["git", "push", "--force"], ["git", "push", "-f"], ["git", "push", "--mirror"], ["git", "push", "--delete"], ["git", "push", "origin", "main"], ["git", "push", "origin", "HEAD:main"]];

import { accessSync, chmodSync, constants, existsSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { CORE_ROOT } from "@hub/config/paths";

// Can a terminal tab start at all (P66, decision 0032)? The terminal has no switch; what it needs is checked here, once,
// for the server (the state's `problem`, the 503 on a start) and for `hub doctor` (`agent.terminal`), so they cannot disagree.
// Only what stops EVERY tab counts, Shell included: a missing or signed-out CLI is not a problem (P57's quiet line says it).

/** Why no tab can start, and the one line that fixes it. */
export interface TerminalProblem { reason: string; fix: string }

/** This checkout's `app/` (`CORE_ROOT`, the one place that knows it); the server, the doctor and `hub core update` pass the core's own. */
const OWN_APP = path.join(CORE_ROOT, "app");

/**
 * The core's node-pty package folder: the first `node_modules/node-pty` from `<app>/packages/terminal` upwards, as Node finds
 * it from `@hub/terminal`, real path; null when it is not installed. Walked by hand, not `require.resolve`: under `pnpm run`
 * NODE_PATH names the running checkout's store, which would answer for another core.
 */
export function nodePtyRoot(app: string = OWN_APP): string | null {
  for (let dir = path.join(app, "packages", "terminal"); ; dir = path.dirname(dir)) {
    const root = path.join(dir, "node_modules", "node-pty");
    if (existsSync(path.join(root, "package.json"))) return realpathSync(root);
    if (path.dirname(dir) === dir) return null;
  }
}

/** node-pty's prebuilt `spawn-helper` for this machine under `root`; it may not exist (node-gyp built it into build/Release). */
export const spawnHelperPath = (root: string): string => path.join(root, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");

const executable = (file: string): boolean => {
  try { accessSync(file, constants.X_OK); return true; } catch { return false; }
};

/**
 * node-pty 1.1.0 ships `prebuilds/darwin-*\/spawn-helper` without the execute bit when pnpm unpacks it, and every spawn then
 * fails with "posix_spawnp failed" (measured 2026-11-18). Called by the server at start, by the `agent.terminal` step's
 * apply and by `hub core update` after its `pnpm install` (a reinstall unpacks it without the bit again). Adds only `+x`.
 * Returns the helper's path, or null when there is none for this platform. A chmod that fails is not thrown: the
 * readiness check then reports the helper as not executable, with its fix line.
 */
export function ensureSpawnHelper(root: string): string | null {
  const helper = spawnHelperPath(root);
  if (!existsSync(helper)) return null;
  if (!executable(helper)) {
    try { chmodSync(helper, statSync(helper).mode | 0o111); } catch { /* reported by terminalReadiness */ }
  }
  return helper;
}

export interface ReadinessOptions {
  /** The core's `app/` folder (`<core>/app`): node-pty is resolved from its `@hub/terminal`, and the fix line names it. */
  app: string;
  /**
   * Set the helper's bit before checking it (the server at start). The doctor's check passes false, so a 644 helper is
   * reported and its `apply` sets the bit through the runner (check, apply, check).
   */
  heal?: boolean;
  /** The shell a tab starts (`$SHELL`, else `/bin/zsh`, as `spawnLine` uses it). */
  shell?: string;
  /** Tests: how node-pty is loaded from its folder (default: `require` it, which loads the native module). */
  load?: (root: string) => unknown;
}

/** The shell a tab starts: the owner's `$SHELL`, else zsh (the same rule as the server's `spawnLine` call). */
export const tabShell = (env: NodeJS.ProcessEnv): string => env.SHELL?.trim() || "/bin/zsh";

/**
 * null when a tab can start; else the first reason it cannot, with its fix. With `heal`, sets the helper's bit first. Order: node-pty installed, its helper executable, node-pty
 * loads (no prebuild for this machine, or a Node ABI mismatch after a Node upgrade), the shell exists and is executable.
 */
export function terminalReadiness(o: ReadinessOptions): TerminalProblem | null {
  const app = o.app;
  const reinstall = `pnpm --dir ${app} install --frozen-lockfile`;
  const root = nodePtyRoot(app);
  if (!root) return { reason: "node-pty (the terminal's PTY module) is not installed in the core", fix: reinstall };
  const helper = o.heal ? ensureSpawnHelper(root) : existsSync(spawnHelperPath(root)) ? spawnHelperPath(root) : null;
  if (helper && !executable(helper)) return { reason: `node-pty's spawn-helper is not executable (${helper})`, fix: `chmod +x ${helper}` };
  try {
    (o.load ?? ((r: string) => createRequire(path.join(r, "package.json"))(r)))(root);
  } catch (e) {
    const why = (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 200);
    return { reason: `node-pty does not load on this Node (${process.version}): ${why}`, fix: reinstall };
  }
  const shell = o.shell ?? tabShell(process.env);
  if (!existsSync(shell) || !executable(shell)) return { reason: `the shell a tab starts (${shell}) does not exist or is not executable`, fix: "set SHELL to an existing shell (/bin/zsh) and restart the hub with ./run.sh up" };
  return null;
}

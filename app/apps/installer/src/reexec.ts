import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { CORE_ROOT, findInstanceHome, hasExplicitHome } from "@hub/config/paths";

const HUB_BIN = join("app", "apps", "installer", "bin", "hub.mjs");

/**
 * `hub` is one global command (`~/.local/bin/hub`), but every instance pins its own core. Started inside an instance (no `HUB_HOME`),
 * the command must run THAT instance's `core/`, not the checkout the symlink points at. Returns the `{ home, bin }` to hand over to,
 * or `undefined` when there is nothing to do: `HUB_HOME` is set (explicit wins), no instance around, no `core/` inside it, or it already is this core.
 */
export function handOver(cwd: string, env: NodeJS.ProcessEnv, running: string = CORE_ROOT): { home: string; bin: string } | undefined {
  if (hasExplicitHome(env) || env.HUB_REEXEC) return undefined;
  const home = findInstanceHome(cwd);
  if (!home) return undefined;
  const bin = join(home, "core", HUB_BIN);
  if (!existsSync(bin)) return undefined;
  try { if (realpathSync(join(home, "core")) === realpathSync(running)) return undefined; } catch { return undefined; }
  return { home, bin };
}

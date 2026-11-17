import { chmodSync, existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";

export interface LinkPlan { dir: string; linkPath: string; target: string; onPath: boolean }

/** Where the optional `hub` shortcut goes: ~/.local/bin/hub, a symlink to app/apps/installer/bin/hub.mjs. Written only by `hub link`. */
export function planLink(root: string, home: string, pathEnv: string): LinkPlan {
  const dir = path.join(home, ".local", "bin");
  return {
    dir,
    linkPath: path.join(dir, "hub"),
    target: path.join(root, "app", "apps", "installer", "bin", "hub.mjs"),
    onPath: pathEnv.split(path.delimiter).includes(dir),
  };
}

export type LinkState = "linked" | "missing" | "elsewhere" | "foreign";
export function linkState(plan: LinkPlan): LinkState {
  let st;
  try { st = lstatSync(plan.linkPath); } catch { return "missing"; }
  if (!st.isSymbolicLink()) return "foreign";
  return readlinkSync(plan.linkPath) === plan.target ? "linked" : "elsewhere";
}

/** Idempotent. Never replaces a real file; replaces a symlink that points elsewhere (an old checkout). */
export function installLink(plan: LinkPlan): { state: LinkState; message: string } {
  const state = linkState(plan);
  if (state === "foreign") throw new Error(`${plan.linkPath} exists and is not a symlink: move it away, then rerun`);
  if (state === "linked") return { state, message: `already linked: ${plan.linkPath}` };
  if (!existsSync(plan.target)) throw new Error(`${plan.target} not found`);
  chmodSync(plan.target, 0o755);
  mkdirSync(plan.dir, { recursive: true });
  if (state === "elsewhere") rmSync(plan.linkPath);
  symlinkSync(plan.target, plan.linkPath);
  return { state: "linked", message: `linked ${plan.linkPath} -> ${plan.target}` };
}

export function removeLink(plan: LinkPlan): string {
  const state = linkState(plan);
  if (state === "foreign") throw new Error(`${plan.linkPath} is not a symlink: not touching it`);
  if (state === "missing") return "not linked";
  rmSync(plan.linkPath);
  return `removed ${plan.linkPath}`;
}

export const pathHint = (plan: LinkPlan): string =>
  `${plan.dir} is not on PATH. Add this line to ~/.zshrc, then open a new terminal:\n  export PATH="$HOME/.local/bin:$PATH"`;

import { existsSync, lstatSync, readlinkSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { userClaudeSkills } from "@hub/config/paths";
import type { Ctx } from "./context.ts";

/**
 * Removes only what install created: skill links in ~/.claude/skills that point into this folder. Config, state and secrets stay.
 * The launchd jobs of the archived automation (P25) are not touched; see the archived installer-automation material (not part of this repo) to remove them by hand.
 */
export async function uninstall(ctx: Ctx): Promise<string[]> {
  const out: string[] = [];
  const say = (m: string) => out.push(ctx.dryRun ? `would ${m}` : m);
  const skills = userClaudeSkills(ctx.home);
  if (existsSync(skills)) {
    for (const e of readdirSync(skills)) {
      const f = path.join(skills, e);
      if (!lstatSync(f).isSymbolicLink()) continue;
      if (!path.resolve(skills, readlinkSync(f)).startsWith(ctx.paths.skills + path.sep)) continue;
      say(`unlink skill ${e}`);
      if (!ctx.dryRun) rmSync(f);
    }
  }
  out.push(`kept: config/, state/, ${ctx.configDir} (secrets). Delete them by hand if you want a clean slate.`);
  return out;
}

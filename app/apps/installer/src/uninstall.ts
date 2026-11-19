import { existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { Ctx } from "./context";
import { filesOf } from "./autostart";
import { legacyRemoveCommand, legacyUserLinks, linksIntoCore } from "./instance-skills";
import { bootout, printJob } from "./launchctl";

/**
 * Removes only what this instance created: the skill links in `<instance>/.claude/skills` that point into the core. Config, state and secrets stay.
 * Nothing outside the instance is touched; old links in the user's `~/.claude/skills` (an older `hub setup`) are reported with the command that removes them.
 * The instance's own LaunchAgent (P67) is booted out and its plist removed: that stops a server launchd started, and the line says so first.
 * The launchd jobs of the archived automation (P25) are not touched; remove them by hand (`launchctl bootout`).
 */
export async function uninstall(ctx: Ctx): Promise<string[]> {
  const out: string[] = [];
  const say = (m: string) => out.push(ctx.dryRun ? `would ${m}` : m);
  const skills = ctx.paths.claudeSkills;
  if (existsSync(skills)) {
    for (const e of readdirSync(skills)) {
      const f = path.join(skills, e);
      if (!lstatSync(f).isSymbolicLink() || !linksIntoCore(ctx.paths, e)) continue;
      say(`unlink skill ${e}`);
      if (!ctx.dryRun) rmSync(f);
    }
  }
  const a = filesOf(ctx);
  if (existsSync(a.plist)) {
    const job = await printJob(ctx, a.label);
    if (job.loaded) {
      say(`boot out the LaunchAgent ${a.label}${job.running ? " (this stops the server launchd started; start it by hand with ./run.sh up --foreground)" : ""}`);
      if (!ctx.dryRun) await bootout(ctx, a.label);
    }
    say(`remove ${a.plist} (the Hub no longer starts after a restart; state/autostart/ is kept)`);
    if (!ctx.dryRun) rmSync(a.plist);
  }
  const old = legacyUserLinks(ctx.home, ctx.paths);
  if (old.length) out.push(`old links in the user-global skills folder (not removed, outside the instance): ${legacyRemoveCommand(ctx.home, old)}`);
  out.push(`kept: config/, state/, ${ctx.configDir} (secrets). Delete them by hand if you want a clean slate.`);
  return out;
}

import { existsSync, readlinkSync } from "node:fs";
import path from "node:path";
import type { Ctx } from "../context";
import type { Step } from "../types";
import { coreSkills, legacyRemoveCommand, legacyUserLinks, syncInstanceSkills } from "../instance-skills";
import { fail, pass, warn } from "./helpers";

const readlinkOf = (p: string): string | undefined => { try { return readlinkSync(p); } catch { return undefined; } };
/** Run-time skills the core ships in `<core>/skills/<name>/SKILL.md`. */
export const runtimeSkills = (c: Ctx): string[] => coreSkills(c.paths);

export const skillSteps: Step[] = [
  {
    id: "skills.runtime", group: "Skills", title: "Agent skills linked into the instance",
    why: "The skills in the core's `skills/` (the agent's playbooks) must be visible to a Claude session started in this instance. Claude Code loads project skills from `.claude/skills/` of the folder it starts in, so the instance carries its own links and nothing is written to the user's home.",
    verifies: "Every core skill is a symlink in `<instance>/.claude/skills/` that resolves to the core's skill (a real folder of the same name is the instance's own and passes).",
    does: "Relative symlink per skill into `<instance>/.claude/skills/` (git-ignored, regenerated; `hub agent` does the same on every start). A real folder of the same name is never replaced.",
    async check(ctx) {
      const names = runtimeSkills(ctx);
      const dir = ctx.paths.claudeSkills;
      const off = names.filter((n) => !existsSync(path.join(dir, n, "SKILL.md")));
      const absolute = names.filter((n) => !off.includes(n) && path.isAbsolute(readlinkOf(path.join(dir, n)) ?? "x")); // an older core wrote absolute links: they break when the instance moves
      if (!off.length && absolute.length) return fail(`absolute links (they do not survive moving the instance): ${absolute.join(", ")}. Run: ./run.sh install --only skills.runtime`);
      if (off.length) return fail(`not linked (or dangling) in ${path.relative(ctx.paths.home, dir) || dir}: ${off.join(", ")}. Run: ./run.sh install --only skills.runtime`);
      return pass(names.length ? names.join(", ") : "no run-time skills yet");
    },
    async apply(ctx) {
      const done = syncInstanceSkills(ctx.paths);
      return done.length ? `linked ${done.join(", ")}` : "already linked";
    },
  },
  {
    id: "skills.legacy", group: "Skills", title: "No hub skill links left in the user's home",
    why: "An older `hub setup` linked the core skills into `~/.claude/skills`, shared by every instance. An instance now carries its own, so those links only make one instance's skills show up in another.",
    verifies: "`~/.claude/skills` holds no symlink into a hub core. Read only: the hub never deletes outside the instance; the warning prints the one command to run.",
    async check(ctx) {
      const old = legacyUserLinks(ctx.home, ctx.paths);
      return old.length ? warn(`${old.length} old link(s) in the user-global skills folder point into a hub core (${old.join(", ")}). Remove them once with: ${legacyRemoveCommand(ctx.home, old)}`) : pass("none");
    },
  },
];

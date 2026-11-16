import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { userClaudeSkills } from "@hub/config/paths";
import type { Ctx } from "../context.ts";
import type { Step } from "../types.ts";
import { fail, pass } from "./helpers.ts";

const skillsHome = (c: Ctx) => userClaudeSkills(c.home);
/** Run-time skills shipped in reforms-crm/skills/<name>/SKILL.md. */
export const runtimeSkills = (c: Ctx): string[] => {
  const d = c.paths.skills;
  if (!existsSync(d)) return [];
  return readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(path.join(d, e.name, "SKILL.md"))).map((e) => e.name);
};
const linkTarget = (p: string) => { try { return lstatSync(p).isSymbolicLink() ? readlinkSync(p) : undefined; } catch { return undefined; } };

export const skillSteps: Step[] = [
  {
    id: "skills.dev", group: "Skills", title: "UI skills for development (coss, coss-particles)",
    why: "Whoever changes the local app's screens needs the UI component skills.",
    verifies: "`~/.claude/skills/coss` and `coss-particles` exist.",
    does: "`npx skills add https://github.com/cosscom/ui.git --skill coss --skill coss-particles -a claude-code -g -y`.",
    async check(ctx) {
      const miss = ["coss", "coss-particles"].filter((s) => !existsSync(path.join(skillsHome(ctx), s)));
      return miss.length ? fail(`missing: ${miss.join(", ")}`) : pass("coss, coss-particles");
    },
    async apply(ctx) {
      const r = await ctx.run("npx", ["-y", "skills", "add", "https://github.com/cosscom/ui.git", "--skill", "coss", "--skill", "coss-particles", "-a", "claude-code", "-g", "-y"], { timeoutMs: 240000 });
      if (r.code !== 0) throw new Error(`skills add failed: ${r.stderr.trim().slice(0, 200)}`);
      return "installed coss, coss-particles";
    },
  },
  {
    id: "skills.runtime", group: "Skills", title: "Agent skills linked into Claude",
    why: "The skills in `skills/` (the agent's playbooks) must be visible to `claude -p`.",
    verifies: "Every `skills/<name>/` is a symlink in `~/.claude/skills/` pointing at this folder.",
    does: "`ln -sfn` per skill; a real folder of the same name is never replaced.",
    async check(ctx) {
      const names = runtimeSkills(ctx);
      const off = names.filter((n) => linkTarget(path.join(skillsHome(ctx), n)) !== path.join(ctx.paths.skills, n));
      return off.length ? fail(`not linked: ${off.join(", ")}`) : pass(names.length ? names.join(", ") : "no run-time skills yet");
    },
    async apply(ctx) {
      mkdirSync(skillsHome(ctx), { recursive: true });
      const done: string[] = [];
      for (const n of runtimeSkills(ctx)) {
        const dst = path.join(skillsHome(ctx), n);
        const cur = linkTarget(dst);
        if (cur === path.join(ctx.paths.skills, n)) continue;
        if (existsSync(dst) && cur === undefined) throw new Error(`${dst} is a real folder; move it away first`);
        if (cur !== undefined) rmSync(dst);
        symlinkSync(path.join(ctx.paths.skills, n), dst);
        done.push(n);
      }
      return `linked ${done.join(", ")}`;
    },
  },
];

import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import type { HubPaths } from "@hub/config/paths";

const linkOf = (p: string): string | undefined => { try { return lstatSync(p).isSymbolicLink() ? readlinkSync(p) : undefined; } catch { return undefined; } };

/** The core's run-time skills: folders of `<core>/skills` with a SKILL.md. */
export const coreSkills = (paths: HubPaths): string[] =>
  existsSync(paths.skills)
    ? readdirSync(paths.skills, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(path.join(paths.skills, e.name, "SKILL.md"))).map((e) => e.name).sort()
    : [];

/**
 * Skill discovery for an agent started in an instance (decision 0016): `<home>/.claude/skills/<name>` is a symlink to `<core>/skills/<name>`,
 * generated here, git-ignored, never hand-edited. Idempotent. A real folder of the same name is the instance's own skill and is left alone;
 * a link into the core for a skill the core no longer ships is removed; a link pointing anywhere else is not ours and stays.
 * Returns the names linked in this call. A no-op in the single-repo layout (core and home are one folder, `skills/` is already there).
 */
export function syncInstanceSkills(paths: HubPaths): string[] {
  if (!paths.instance) return [];
  const want = coreSkills(paths);
  mkdirSync(paths.claudeSkills, { recursive: true });
  for (const e of readdirSync(paths.claudeSkills)) {
    const f = path.join(paths.claudeSkills, e);
    const to = linkOf(f);
    if (to !== undefined && path.resolve(paths.claudeSkills, to).startsWith(paths.skills + path.sep) && !want.includes(e)) rmSync(f);
  }
  const done: string[] = [];
  for (const n of want) {
    const dst = path.join(paths.claudeSkills, n);
    const target = path.join(paths.skills, n);
    const cur = linkOf(dst);
    if (cur === target) continue;
    if (existsSync(dst) && cur === undefined) continue;
    if (cur !== undefined) rmSync(dst);
    symlinkSync(target, dst);
    done.push(n);
  }
  return done;
}

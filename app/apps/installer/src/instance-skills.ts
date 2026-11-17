import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { userClaudeSkills, type HubPaths } from "@hub/config/paths";

const linkOf = (p: string): string | undefined => { try { return lstatSync(p).isSymbolicLink() ? readlinkSync(p) : undefined; } catch { return undefined; } };

const real = (p: string): string => { try { return realpathSync(p); } catch { return p; } };

/**
 * Where the symlink `<dir>/<name>` points, as an absolute path, resolved from the REAL folder of `dir` (a relative link is read by the OS
 * from the physical folder, which differs from the typed path under a symlinked parent such as macOS /var). Undefined when it is not a symlink.
 */
export function linkDestination(dir: string, name: string): string | undefined {
  const to = linkOf(path.join(dir, name));
  return to === undefined ? undefined : path.resolve(real(dir), to);
}

/** Does `<claudeSkills>/<name>` link into this core's `skills/`? (existing or not) */
export const linksIntoCore = (paths: HubPaths, name: string): boolean => {
  const to = linkDestination(paths.claudeSkills, name);
  return to !== undefined && (to.startsWith(real(paths.skills) + path.sep) || real(path.dirname(to)) === real(paths.skills)); // the folder is compared by real path: the skill itself may be gone
};

/** The core's run-time skills: folders of `<core>/skills` with a SKILL.md. */
export const coreSkills = (paths: HubPaths): string[] =>
  existsSync(paths.skills)
    ? readdirSync(paths.skills, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(path.join(paths.skills, e.name, "SKILL.md"))).map((e) => e.name).sort()
    : [];

/**
 * Skill discovery for an agent started in an instance (decision 0016, P40): `<home>/.claude/skills/<name>` is a RELATIVE symlink to
 * `<core>/skills/<name>` (it survives moving the instance), generated here, git-ignored, never hand-edited. Claude Code loads project skills
 * from `.claude/skills/` of the folder it starts in, and follows symlinked skill folders. An absolute link from an older core is replaced. Idempotent. A real folder of the same name is the instance's own skill and is left alone;
 * a link into the core for a skill the core no longer ships is removed; a link pointing anywhere else is not ours and stays.
 * Returns the names linked in this call.
 */
export function syncInstanceSkills(paths: HubPaths): string[] {
  const want = coreSkills(paths);
  mkdirSync(paths.claudeSkills, { recursive: true });
  for (const e of readdirSync(paths.claudeSkills)) {
    if (linksIntoCore(paths, e) && !want.includes(e)) rmSync(path.join(paths.claudeSkills, e));
  }
  const done: string[] = [];
  for (const n of want) {
    const dst = path.join(paths.claudeSkills, n);
    const target = path.relative(real(paths.claudeSkills), path.join(real(paths.skills), n));
    const cur = linkOf(dst);
    if (cur === target && existsSync(path.join(dst, "SKILL.md"))) continue;
    if (existsSync(dst) && cur === undefined) continue;
    if (cur !== undefined) rmSync(dst);
    symlinkSync(target, dst);
    done.push(n);
  }
  return done;
}

/**
 * One-time cleanup (P40): an older `hub setup` linked the core skills into the user-global `~/.claude/skills`, shared by every instance.
 * Lists the links there that point into a hub core (a folder holding `app/apps/installer/bin/hub.mjs`), or dangle at a skill name the core ships.
 * Read only: the hub never deletes outside the instance.
 */
export function legacyUserLinks(userHome: string, paths: HubPaths): string[] {
  const dir = userClaudeSkills(userHome);
  if (!existsSync(dir)) return [];
  const shipped = coreSkills(paths);
  const out: string[] = [];
  for (const e of readdirSync(dir).sort()) {
    const t = linkDestination(dir, e);
    if (t === undefined) continue;
    if (path.basename(t) !== e || path.basename(path.dirname(t)) !== "skills") continue;
    const coreRoot = path.dirname(path.dirname(t));
    if (existsSync(path.join(coreRoot, "app", "apps", "installer", "bin", "hub.mjs")) || (!existsSync(t) && shipped.includes(e))) out.push(e);
  }
  return out;
}

/** The one command that removes those links (removes the links only; a link is not its target). */
export const legacyRemoveCommand = (userHome: string, names: string[]): string =>
  `rm ${names.map((n) => `'${path.join(userClaudeSkills(userHome), n)}'`).join(" ")}`;

import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import type { Ctx } from "../context.ts";
import { coreSkills } from "../instance-skills.ts";
import type { CheckResult, Step } from "../types.ts";
import { fail, pass, warn } from "./helpers.ts";

/** The one place an instance states which core it runs on (decision 0016): `<home>/core.version`. */
export const CORE_VERSION_FILE = "core.version";

/** Paths that belong to the core: an instance must not carry them. `core/` (the pinned submodule) is the only core inside an instance. */
const CORE_ONLY = ["app/apps", "app/packages", "app/@rules", "@docs/core", "skills", "install.sh", "hub.sh", "projects/_template"];
/** Paths that belong to an owner: the core must not track them. The core keeps one data-shaped folder, the template: `app/projects/_template`. */
const INSTANCE_ONLY = ["@docs/custom", "@dev", "@refs"];
const CORE_PROJECTS = "app/projects";

const real = (p: string): string => { try { return realpathSync(p); } catch { return path.resolve(p); } };
const linkOf = (p: string): string | undefined => { try { return lstatSync(p).isSymbolicLink() ? readlinkSync(p) : undefined; } catch { return undefined; } };

/** The pinned version: the first line of `core.version` that is not blank and not a `#` comment. */
export function readCoreVersion(home: string): string | undefined {
  const f = path.join(home, CORE_VERSION_FILE);
  if (!existsSync(f)) return undefined;
  const line = readFileSync(f, "utf8").split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
  return line || undefined;
}

const git = async (ctx: Ctx, cwd: string, args: string[]) => ctx.run("git", ["-C", cwd, ...args]);

/** Instance files inside the core: tracked paths when the core is a git checkout, else what exists. Only the first few are named. */
async function instanceFilesInCore(ctx: Ctx): Promise<string[]> {
  const core = ctx.paths.core;
  const specs = [CORE_PROJECTS, ...INSTANCE_ONLY];
  const tracked = await git(ctx, core, ["ls-files", "--", ...specs]);
  if (tracked.code === 0) {
    const names = new Set<string>();
    for (const f of tracked.stdout.split("\n").filter(Boolean)) {
      const parts = f.split("/");
      if (parts[0] === "app" && parts[2] && !parts[2].startsWith("_")) names.add(`app/projects/${parts[2]}`);
      else if (parts[0] === "app") continue;
      else names.add(parts[0] === "@docs" ? "@docs/custom" : parts[0]!);
    }
    return [...names].sort();
  }
  const found: string[] = [];
  const projects = path.join(core, CORE_PROJECTS);
  if (existsSync(projects)) for (const e of readdirSync(projects, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith(".")) found.push(`app/projects/${e.name}`);
  for (const s of INSTANCE_ONLY) if (existsSync(path.join(core, s))) found.push(s);
  return found.sort();
}

const brief = (xs: string[]): string => (xs.length > 4 ? `${xs.slice(0, 4).join(", ")} and ${xs.length - 4} more` : xs.join(", "));

export async function checkInstance(ctx: Ctx): Promise<CheckResult> {
  const { paths } = ctx;
  const problems: string[] = [];
  const notes: string[] = [];

  // 1. The pin: present, and the core in use is that version.
  const ver = readCoreVersion(paths.home);
  const dev = linkOf(path.join(paths.home, "core"));
  if (!ver) problems.push(`${CORE_VERSION_FILE} missing or empty in ${paths.home}: write the core commit or tag it runs on, once`);
  else if (dev !== undefined) notes.push(`core/ is a link to ${path.resolve(paths.home, dev)} (local development, \`hub core dev\`): pin ${ver} is not verified and this instance must not be deployed; \`hub core install\` restores the pinned core`);
  else {
    const top = await git(ctx, paths.core, ["rev-parse", "--show-toplevel"]);
    const ownRepo = top.code === 0 && real(top.stdout.trim()) === real(paths.core);
    const want = await git(ctx, paths.core, ["rev-parse", "--verify", "--quiet", `${ver}^{commit}`]);
    if (top.code !== 0) notes.push(`core is not a git checkout: pin ${ver} cannot be verified`);
    else if (want.code !== 0) problems.push(`pin ${ver} is not a commit of the core in use`);
    else if (!ownRepo) problems.push(`core is a folder inside another repository: "core at the pin" needs the core as its own repository (the instance's core/ submodule)`);
    else {
      const head = (await git(ctx, paths.core, ["rev-parse", "HEAD"])).stdout.trim();
      if (head !== want.stdout.trim()) problems.push(`core is at ${head.slice(0, 9)} but ${CORE_VERSION_FILE} pins ${ver}: check out the pin, or move the pin and commit it alone`);
      const dirty = await git(ctx, paths.core, ["status", "--porcelain", "--untracked-files=no"]);
      if (dirty.code === 0 && dirty.stdout.trim()) problems.push("core has uncommitted changes: an instance never edits core");
    }
  }

  // 2. The instance carries no core file.
  const coreInside = CORE_ONLY.filter((p) => existsSync(path.join(paths.home, p)));
  if (coreInside.length) problems.push(`core files inside the instance: ${brief(coreInside)}`);

  // 3. The core carries no instance file.
  const ownerInCore = await instanceFilesInCore(ctx);
  if (ownerInCore.length) problems.push(`instance files inside the core: ${brief(ownerInCore)}`);

  // 4. Skill links the instance generated still point at the core (`hub agent` regenerates them).
  const dangling: string[] = [];
  if (existsSync(paths.claudeSkills)) {
    for (const e of readdirSync(paths.claudeSkills)) {
      const to = linkOf(path.join(paths.claudeSkills, e));
      if (to !== undefined && path.resolve(paths.claudeSkills, to).startsWith(paths.skills + path.sep) && !existsSync(path.resolve(paths.claudeSkills, to))) dangling.push(e);
    }
  }
  if (dangling.length) problems.push(`skill links into core are dangling: ${brief(dangling)} (run \`hub agent\` to regenerate)`);
  const unlinked = coreSkills(paths).filter((n) => !existsSync(path.join(paths.claudeSkills, n)));
  if (unlinked.length && !dangling.length) notes.push(`${unlinked.length} core skill(s) not linked yet in .claude/skills: \`hub agent\` links them`);

  if (problems.length) return fail([...problems, ...notes].join("; "));
  if (notes.length) return warn(notes.join("; "));
  return pass(`core ${ver} in use; no core file in the instance, no instance file in the core`);
}

export const instanceSteps: Step[] = [
  {
    id: "instance.core", group: "Instance", title: "Instance matches the core",
    why: "An owner's instance (`HUB_HOME`) and the core code are separate repositories. The instance states the core version it runs on in ONE file; neither side may hold the other's files.",
    verifies: "`core.version` exists and names the core in use (core clean at that commit), the instance holds no core files, the core tracks no instance files, and generated skill links point at existing core skills.",
    check: checkInstance,
  },
];

import { existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import type { Ctx } from "./context";
import { hubPaths } from "@hub/config/paths";
import { checkInstance } from "./steps/instance";

/**
 * `hub core install` and `hub core dev <path>` (decision 0016, "no legacy").
 *
 * An instance runs on `<home>/core/`. Two ways to have it:
 *  - **installed** (the default): `core/` is the git submodule, checked out at the commit the instance records. This is the only state a deployed or
 *    committed instance is in.
 *  - **dev**: `core/` is a symlink to a core checkout the developer edits (`hub core dev <path>`). The submodule checkout is removed (`git submodule
 *    deinit`: the gitlink, `.gitmodules` and the pin stay, nothing is lost) and git is told to ignore `core/` (`skip-worktree`), so `git status`,
 *    `git add -A` and `git commit -a` in the instance never see the link. `hub core install` puts the submodule back.
 */
export interface CoreLinkResult { ok: boolean; lines: string[] }

const coreDirOf = (ctx: Ctx): string => path.join(ctx.paths.home, "core");
const git = (ctx: Ctx, args: string[], timeoutMs = 120000) => ctx.run("git", ["-C", ctx.paths.home, ...args], { timeoutMs });
const first = (s: string): string => s.trim().split("\n")[0] ?? "no detail";

type Mode = { kind: "missing" } | { kind: "link"; target: string } | { kind: "folder" };
function modeOf(dir: string): Mode {
  try {
    const st = lstatSync(dir);
    if (st.isSymbolicLink()) return { kind: "link", target: path.resolve(path.dirname(dir), readlinkSync(dir)) };
    return { kind: "folder" };
  } catch {
    return { kind: "missing" };
  }
}
/** The hub that runs this command may itself live elsewhere (a dev checkout): the instance's check must look at the instance's own core/. */
const ownCore = (ctx: Ctx): Ctx => ({ ...ctx, paths: hubPaths({ core: coreDirOf(ctx), home: ctx.paths.home, env: {} }) });
const real = (p: string): string => { try { return realpathSync(p); } catch { return path.resolve(p); } };

/** A core checkout: its own git repository with the hub's entry point and the installer. */
async function isCoreCheckout(ctx: Ctx, dir: string): Promise<string | undefined> {
  if (!existsSync(path.join(dir, "hub.sh")) || !existsSync(path.join(dir, "app", "apps", "installer"))) return `${dir} is not a core checkout (no hub.sh and app/apps/installer)`;
  const top = await ctx.run("git", ["-C", dir, "rev-parse", "--show-toplevel"]);
  if (top.code !== 0 || real(top.stdout.trim()) !== real(dir)) return `${dir} is not the root of its own git repository`;
  return undefined;
}

/** The instance must be a git repository that records `core` as a submodule: that is what makes the link reversible. */
async function recordsCoreSubmodule(ctx: Ctx): Promise<string | undefined> {
  const r = await git(ctx, ["ls-files", "--stage", "--", "core"]);
  if (r.code !== 0) return `${ctx.paths.home} is not a git repository`;
  if (!/^160000 /m.test(r.stdout)) return `${ctx.paths.home} does not record core as a submodule (\`hub new-instance\` makes an instance that does)`;
  return undefined;
}

/** `hub core dev <path>`: remove the submodule checkout and alias `core/` to a local core checkout. Dry run unless apply. */
export async function coreDev(ctx: Ctx, target: string, apply: boolean): Promise<CoreLinkResult> {
  const dir = coreDirOf(ctx);
  const to = path.resolve(target);
  const out: string[] = [];
  const bad = await isCoreCheckout(ctx, to);
  if (bad) return { ok: false, lines: [bad] };
  if (real(to) === real(dir) && modeOf(dir).kind !== "link") return { ok: false, lines: ["that is this instance's own core/: pass the folder of the core checkout you develop"] };
  const noSub = await recordsCoreSubmodule(ctx);
  if (noSub) return { ok: false, lines: [noSub] };

  const mode = modeOf(dir);
  if (mode.kind === "link" && real(mode.target) === real(to)) return { ok: true, lines: [`core/ already links to ${to}: nothing to do`] };
  if (mode.kind === "folder") {
    const dirty = await ctx.run("git", ["-C", dir, "status", "--porcelain", "--untracked-files=no"]);
    if (dirty.code === 0 && dirty.stdout.trim()) return { ok: false, lines: ["core/ has uncommitted changes: an instance never edits core. Discard or commit them in the core first."] };
  }
  out.push(`${apply ? "linking" : "would link"} core/ -> ${to}${mode.kind === "folder" ? " (the submodule checkout is removed; the gitlink, .gitmodules and core.version stay)" : mode.kind === "link" ? ` (it pointed to ${mode.target})` : ""}`);
  if (!apply) return { ok: true, lines: [...out, "dry run: nothing changed. Add --apply."] };

  if (mode.kind === "folder") {
    const d = await git(ctx, ["submodule", "deinit", "-f", "core"]);
    if (d.code !== 0) return { ok: false, lines: [...out, `git submodule deinit failed: ${first(d.stderr || d.stdout)}`] };
  }
  // Order matters: tell git to ignore core/ BEFORE it becomes a symlink, or `git status` errors on a symlinked submodule path.
  const skip = await git(ctx, ["update-index", "--skip-worktree", "core"]);
  if (skip.code !== 0) return { ok: false, lines: [...out, `git update-index failed: ${first(skip.stderr)}`] };
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.dirname(dir), { recursive: true });
  symlinkSync(to, dir);

  const check = await checkInstance(ownCore(ctx));
  out.push(`instance.core: ${check.level}${check.detail ? `: ${check.detail}` : ""}`);
  out.push("git ignores core/ in this instance (skip-worktree): nothing you edit there is committed from here. Edit the core in its own repository.");
  out.push("back to the pinned core: `hub core install` (run it from a hub that does not live in core/, or from this one: it only needs git).");
  return { ok: check.level !== "fail", lines: out };
}

/** `hub core install`: core/ as the git submodule at the commit the instance records (the default, and what a commit or deploy needs). */
export async function coreInstall(ctx: Ctx): Promise<CoreLinkResult> {
  const dir = coreDirOf(ctx);
  const out: string[] = [];
  const noSub = await recordsCoreSubmodule(ctx);
  if (noSub) return { ok: false, lines: [noSub] };
  const mode = modeOf(dir);
  let hadLink: string | undefined;
  if (mode.kind === "link") {
    hadLink = mode.target;
    rmSync(dir, { force: true });
    out.push(`removed the link core/ -> ${mode.target}`);
  }
  await git(ctx, ["update-index", "--no-skip-worktree", "core"]);
  const u = await git(ctx, ["submodule", "update", "--init", "--", "core"], 300000);
  if (u.code !== 0) {
    if (hadLink) { try { symlinkSync(hadLink, dir); await git(ctx, ["update-index", "--skip-worktree", "core"]); } catch { /* the link could not be put back */ } }
    return { ok: false, lines: [...out, `git submodule update failed: ${first(u.stderr || u.stdout)}${hadLink ? "; the dev link was put back" : ""}`] };
  }
  const sha = (await ctx.run("git", ["-C", dir, "rev-parse", "HEAD"])).stdout.trim();
  out.push(`core/ is the submodule at ${sha.slice(0, 9)}`);
  const check = await checkInstance(ownCore(ctx));
  out.push(`instance.core: ${check.level}${check.detail ? `: ${check.detail}` : ""}`);
  return { ok: check.level !== "fail", lines: out };
}

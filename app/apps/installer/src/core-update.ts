import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Ctx } from "./context";
import { ensureSpawnHelper, nodePtyRoot } from "@hub/terminal/readiness";
import { INSTALL, staleDeps } from "./deps";
import { checkInstance, CORE_VERSION_FILE, readCoreVersion } from "./steps/instance";
import { workspaceInit } from "./workspace";

/** Decision 0016: an instance moves to a newer core by moving its pin. `hub core update [tag]`: list the tags, or plan, or (with apply) do it. */
export interface CoreUpdate { ok: boolean; lines: string[] }

const git = (ctx: Ctx, args: string[]) => ctx.run("git", ["-C", ctx.paths.core, ...args], { timeoutMs: 120000 });
/** A version tag: the only kind of tag an instance is ever moved to or pinned at. */
export const VERSION_TAG = /^v\d+\.\d+\.\d+$/;
const semver = (t: string): number[] => t.slice(1).split(".").map(Number);
const newer = (a: string, b: string): number => { const x = semver(a), y = semver(b); return (x[0]! - y[0]!) || (x[1]! - y[1]!) || (x[2]! - y[2]!); };

/** Replace the first non-comment line of core.version with `value` (comments and blanks stay). */
export function rewritePin(text: string, value: string): string {
  const lines = text.replace(/\n+$/, "").split("\n");
  const i = lines.findIndex((l) => l.trim() && !l.trim().startsWith("#"));
  if (i < 0) lines.push(value); else lines[i] = value;
  return lines.join("\n").replace(/\n*$/, "\n");
}

/**
 * The managed comment above the pin line: `# follows: <branch>` for an instance that follows a branch, `# tag: vX.Y.Z` for a tag pin, nothing for a bare commit.
 * Every other comment that names a version (a hand-written "checked out at the tag v0.1.0") is dropped: the pin file states the version once, here, so it cannot go stale.
 */
export function pinMark(text: string, mark: { branch?: string; tag?: string }): string {
  const lines = text.split("\n").filter((l) => !(l.trim().startsWith("#") && (l.startsWith("# follows:") || /\bv\d+\.\d+\.\d+\b/.test(l))));
  const stamp = mark.branch ? `# follows: ${mark.branch}` : mark.tag ? `# tag: ${mark.tag}` : undefined;
  if (stamp) lines.splice((() => { const i = lines.findIndex((l) => l.trim() && !l.trim().startsWith("#")); return i < 0 ? lines.length : i; })(), 0, stamp);
  return lines.join("\n");
}

/** `pnpm install` in core/app (`deps.ts` INSTALL). True = installed; false = failed, with the fix line pushed to `out`. */
async function install(ctx: Ctx, appDir: string, why: string, out: string[]): Promise<boolean> {
  const r = await ctx.run("pnpm", ["--dir", appDir, ...INSTALL], { timeoutMs: 600_000 });
  if (r.code === 0) {
    out.push(`dependencies: ${why}; ran \`pnpm install ${INSTALL.slice(1).join(" ")}\` in ${appDir}`);
    // P66: a reinstall unpacks node-pty's spawn-helper without its execute bit again; the terminal needs it.
    const root = nodePtyRoot(appDir);
    const helper = root ? ensureSpawnHelper(root) : null;
    if (helper) out.push(`terminal: node-pty's spawn-helper is executable (${helper})`);
    return true;
  }
  out.push(`dependencies: ${why} but pnpm install failed (${(r.stderr || r.stdout).trim().split("\n").at(-1)?.slice(0, 160) ?? "no output"}). Run: \`pnpm --dir ${appDir} ${INSTALL.join(" ")}\``);
  return false;
}

export async function coreUpdate(ctx: Ctx, tag: string | undefined, apply: boolean, branch?: string): Promise<CoreUpdate> {
  const { paths } = ctx;
  const out: string[] = [];
  const pin = readCoreVersion(paths.home);
  if (lstatSync(path.join(paths.home, "core"), { throwIfNoEntry: false })?.isSymbolicLink()) return { ok: false, lines: ["core/ is a link to a local checkout (hub core dev): run `hub core install` first, then update"] };
  // Running another core's hub (`<other>/hub.sh`) would move the pin but check out the wrong core: only the instance's own core/ may be moved.
  const own = path.join(paths.home, "core");
  if (existsSync(own) && realpathSync(own) !== realpathSync(paths.core)) return { ok: false, lines: [`this hub runs from ${paths.core}, not from the instance's core/: run \`./run.sh core update\` in ${paths.home}`] };
  const top = await git(ctx, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return { ok: false, lines: [`${paths.core} is not a git checkout: nothing to update`] };
  const dirty = await git(ctx, ["status", "--porcelain", "--untracked-files=no"]);
  if (dirty.stdout.trim()) return { ok: false, lines: ["core has uncommitted changes: an instance never edits core. Discard them first."] };

  const fetched = await git(ctx, ["fetch", "--tags", "--force", "origin"]);
  if (fetched.code !== 0) return { ok: false, lines: [`git fetch failed: ${fetched.stderr.trim().split("\n")[0] ?? "no detail"}`] };
  const tags = (await git(ctx, ["tag", "--list"])).stdout.split("\n").map((t) => t.trim()).filter((t) => VERSION_TAG.test(t)).sort(newer);
  const head = (await git(ctx, ["rev-parse", "HEAD"])).stdout.trim();
  const here = (await git(ctx, ["describe", "--tags", "--exact-match", "HEAD"])).stdout.trim() || head.slice(0, 9);
  out.push(`core in use: ${here}; pin: ${pin ?? "(none)"}`);
  if (!branch && !tags.length) return { ok: false, lines: [...out, "the core has no vX.Y.Z tags to move to"] };
  if (!tag && !branch) {
    out.push(`available: ${tags.join(", ")}`, `latest: ${tags.at(-1)}`, "move with: hub core update <tag> --apply");
    return { ok: true, lines: out };
  }
  const ref = branch ? `origin/${branch}` : tag!;
  const label = branch ? `${branch} (tip)` : tag!;
  if (!branch && !tags.includes(tag!)) return { ok: false, lines: [...out, `${tag} is not a tag of the core (available: ${tags.join(", ")})`] };
  const target = (await git(ctx, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).stdout.trim();
  if (!target) return { ok: false, lines: [...out, `${ref} does not exist in the core's origin`] };
  const appDir = path.join(paths.core, "app");
  if (target === head && pin && (await git(ctx, ["rev-parse", `${pin}^{commit}`])).stdout.trim() === target) {
    // The pin may have moved without this command (a pull of the instance): the checkout is right, its node_modules may not be.
    const stale = staleDeps(appDir);
    if (!stale.length) return { ok: true, lines: [...out, `already on ${label}: nothing to do`] };
    out.push(`already on ${label}`);
    if (!apply) return { ok: true, lines: [...out, `dependencies are behind the checkout (${stale[0]}): add --apply to install them`] };
    return { ok: await install(ctx, appDir, `behind the checkout (${stale[0]})`, out), lines: out };
  }
  const older = !branch && tags.indexOf(tag!) < tags.indexOf(here);
  out.push(`${apply ? "moving" : "would move"} to ${label} (${target.slice(0, 9)})${older ? "; this is a ROLLBACK to an older core" : ""}`);
  if (!apply) return { ok: true, lines: [...out, "dry run: nothing changed. Add --apply."] };

  const co = await git(ctx, ["checkout", "--quiet", "--detach", target]);
  if (co.code !== 0) return { ok: false, lines: [...out, `checkout failed: ${co.stderr.trim().split("\n")[0] ?? "no detail"}`] };
  const file = path.join(paths.home, CORE_VERSION_FILE);
  const before = existsSync(file) ? readFileSync(file, "utf8") : "";
  writeFileSync(file, pinMark(rewritePin(before, target), branch ? { branch } : { tag: tag! }));
  const check = await checkInstance(ctx);
  if (check.level === "fail") {
    // Put it back: a failed update leaves the instance exactly as it was.
    if (pin) await git(ctx, ["checkout", "--quiet", (await git(ctx, ["rev-parse", `${pin}^{commit}`])).stdout.trim() || head]); else await git(ctx, ["checkout", "--quiet", head]);
    writeFileSync(file, before);
    return { ok: false, lines: [...out, `instance.core failed after the move, put back: ${check.detail}`] };
  }
  out.push(`${CORE_VERSION_FILE} now pins ${target.slice(0, 9)} (${label}); instance.core: ${check.level}`);
  // The new core may need other dependencies than the old one: install when the lockfile differs between the two commits.
  const lock = await git(ctx, ["diff", "--quiet", head, target, "--", "app/pnpm-lock.yaml"]);
  const missing = !existsSync(path.join(appDir, "node_modules"));
  const stale = missing ? [] : staleDeps(appDir);
  if (lock.code === 0 && !missing && !stale.length) out.push("dependencies: the lockfile did not change, nothing to install");
  else {
    const why = missing ? "core/app has no node_modules" : lock.code !== 0 ? "the lockfile changed" : `behind the checkout (${stale[0]})`;
    if (!(await install(ctx, appDir, why, out))) return { ok: false, lines: out };
  }
  // An instance with its own workspace (decision 0018): the generated root files follow the new core (versions, catalog, turbo tasks).
  if (existsSync(path.join(paths.home, "pnpm-workspace.yaml"))) {
    const ws = workspaceInit(ctx, true);
    out.push(`workspace: ${ws.lines.join("; ")}`);
    if (!ws.ok) return { ok: false, lines: out };
  }
  out.push("next: run `hub doctor` and the project checks, then commit core/, core.version and any regenerated workspace file together, in one commit.");
  return { ok: true, lines: out };
}

import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Ctx } from "./context.ts";
import { checkInstance, CORE_VERSION_FILE, readCoreVersion } from "./steps/instance.ts";

/** Decision 0016: an instance moves to a newer core by moving its pin. `hub core update [tag]`: list the tags, or plan, or (with apply) do it. */
export interface CoreUpdate { ok: boolean; lines: string[] }

const git = (ctx: Ctx, args: string[]) => ctx.run("git", ["-C", ctx.paths.core, ...args], { timeoutMs: 120000 });
const TAG = /^v\d+\.\d+\.\d+$/;
const semver = (t: string): number[] => t.slice(1).split(".").map(Number);
const newer = (a: string, b: string): number => { const x = semver(a), y = semver(b); return (x[0]! - y[0]!) || (x[1]! - y[1]!) || (x[2]! - y[2]!); };

/** Replace the first non-comment line of core.version with `value` (comments and blanks stay). */
export function rewritePin(text: string, value: string): string {
  const lines = text.replace(/\n+$/, "").split("\n");
  const i = lines.findIndex((l) => l.trim() && !l.trim().startsWith("#"));
  if (i < 0) lines.push(value); else lines[i] = value;
  return lines.join("\n").replace(/\n*$/, "\n");
}

/** `branch` (a stand/test instance): follow the tip of `origin/<branch>` instead of a tag. The pin stays a commit; a comment line records that the instance follows the branch. */
/** Keep exactly one `# follows: <branch>` comment (none for a tag pin), right above the pin line. */
export function followMark(text: string, branch?: string): string {
  const lines = text.split("\n").filter((l) => !l.startsWith("# follows:"));
  if (!branch) return lines.join("\n");
  const i = lines.findIndex((l) => l.trim() && !l.trim().startsWith("#"));
  lines.splice(i < 0 ? lines.length : i, 0, `# follows: ${branch}`);
  return lines.join("\n");
}

export async function coreUpdate(ctx: Ctx, tag: string | undefined, apply: boolean, branch?: string): Promise<CoreUpdate> {
  const { paths } = ctx;
  const out: string[] = [];
  const pin = readCoreVersion(paths.home);
  if (lstatSync(path.join(paths.home, "core"), { throwIfNoEntry: false })?.isSymbolicLink()) return { ok: false, lines: ["core/ is a link to a local checkout (hub core dev): run `hub core install` first, then update"] };
  const top = await git(ctx, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return { ok: false, lines: [`${paths.core} is not a git checkout: nothing to update`] };
  const dirty = await git(ctx, ["status", "--porcelain", "--untracked-files=no"]);
  if (dirty.stdout.trim()) return { ok: false, lines: ["core has uncommitted changes: an instance never edits core. Discard them first."] };

  const fetched = await git(ctx, ["fetch", "--tags", "--force", "origin"]);
  if (fetched.code !== 0) return { ok: false, lines: [`git fetch failed: ${fetched.stderr.trim().split("\n")[0] ?? "no detail"}`] };
  const tags = (await git(ctx, ["tag", "--list"])).stdout.split("\n").map((t) => t.trim()).filter((t) => TAG.test(t)).sort(newer);
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
  if (target === head && pin && (await git(ctx, ["rev-parse", `${pin}^{commit}`])).stdout.trim() === target) return { ok: true, lines: [...out, `already on ${label}: nothing to do`] };
  const older = !branch && tags.indexOf(tag!) < tags.indexOf(here);
  out.push(`${apply ? "moving" : "would move"} to ${label} (${target.slice(0, 9)})${older ? "; this is a ROLLBACK to an older core" : ""}`);
  if (!apply) return { ok: true, lines: [...out, "dry run: nothing changed. Add --apply."] };

  const co = await git(ctx, ["checkout", "--quiet", "--detach", target]);
  if (co.code !== 0) return { ok: false, lines: [...out, `checkout failed: ${co.stderr.trim().split("\n")[0] ?? "no detail"}`] };
  const file = path.join(paths.home, CORE_VERSION_FILE);
  const before = existsSync(file) ? readFileSync(file, "utf8") : "";
  writeFileSync(file, followMark(rewritePin(before, target), branch));
  const check = await checkInstance(ctx);
  if (check.level === "fail") {
    // Put it back: a failed update leaves the instance exactly as it was.
    if (pin) await git(ctx, ["checkout", "--quiet", (await git(ctx, ["rev-parse", `${pin}^{commit}`])).stdout.trim() || head]); else await git(ctx, ["checkout", "--quiet", head]);
    writeFileSync(file, before);
    return { ok: false, lines: [...out, `instance.core failed after the move, put back: ${check.detail}`] };
  }
  out.push(`${CORE_VERSION_FILE} now pins ${target.slice(0, 9)} (${label}); instance.core: ${check.level}`);
  out.push("next: run `hub doctor` and the project checks, then commit core/ and core.version together, in one commit.");
  return { ok: true, lines: out };
}

import { errFields, ops } from "@hub/log/ops";
import type { ToolCtx } from "./ports";
import { adviceOf } from "./refusals";

/**
 * P133 (P129 verdict 11): the owner sees a refusal only he can fix. A tool refused with a registry `fix` (Mail not running,
 * Mail not allowed, Notion unavailable, the session unable) is written as one row per project and code on a short write
 * connection; the tool's next successful call deletes its rows. Overview's Needs you shows them (24 hours at most). It writes
 * no client data: the code, the tool's name, the registry's line and place, the time. A failure here never changes the reply.
 */
export async function noteOwnerFix(ctx: ToolCtx, tool: string, refused: string | null): Promise<void> {
  const write = ctx.env.withRepos;
  const slug = ctx.env.hubProject;
  if (!write || !slug) return;
  try {
    if (refused === null) {
      // A read first, so a successful call opens no write connection when nothing waits.
      if (await ctx.repos.ownerFixes.anyFor(slug, tool)) await write((w) => w.ownerFixes.clear(slug, tool));
      return;
    }
    const fix = adviceOf(refused).fix;
    if (!fix) return;
    const at = ctx.now().toISOString();
    await write((w) => w.ownerFixes.note({ project: slug, code: refused, tool, line: fix.line, place: fix.place, at }));
  } catch (e) {
    // A core update runs this code before the server migrated the database (0038): no table yet, nothing to record.
    if (e instanceof Error && e.message.includes("no such table: owner_fixes")) return;
    ops("agent").warn("the owner-fix record was not written", { project: slug, tool, ...errFields(e) });
  }
}

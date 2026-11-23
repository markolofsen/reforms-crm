import { z } from "zod";
import { recordClientCall } from "../../records/client";
import { clientRecord } from "../../records/schema";
import { defineTool } from "../define";
import { ToolError } from "../result";

// P129 verdict 4 (decision 0045 point 10): a client the session handled WITHOUT a draft, recorded by the hub, not by a shell
// command (`hub record-client` is gone). Writes one Inbox row of the bound project; nothing of the mail's text.

export const clientRecordTool = defineTool({
  name: "client_record",
  title: "Record a client handled without a draft",
  description: "Records a client this session handled without leaving a draft (skipped, escalated, injection suspected, a call to make), so Mail and Activity show who was seen and why. No mail text is stored. Never sends, never writes Mail. A drafted client is recorded by draft_write itself.",
  input: clientRecord,
  output: z.object({ ok: z.literal(true), project: z.string(), inboxId: z.number(), runId: z.number(), created: z.boolean(), followUps: z.string().optional() }),
  effect: "draft",
  refusals: ["unavailable", "busy", "record_failed"],
  handler: async (ctx, input) => {
    const slug = ctx.project();
    const env = ctx.env.records;
    if (!env) throw new ToolError("unavailable", "This hub MCP server cannot record (no database to write).");
    const r = await recordClientCall(slug, input, { dbPath: env.dbPath, ...(env.now ? { now: env.now } : {}) });
    if (!r.ok) throw new ToolError(r.code, r.error);
    return { ok: true as const, project: slug, inboxId: r.inboxId, runId: r.runId, created: r.created, ...(r.followUps ? { followUps: r.followUps } : {}) };
  },
});

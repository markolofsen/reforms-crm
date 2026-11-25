import { clientKey } from "@hub/contract/client-key";
import { brandForKey } from "@hub/projects/brands";
import type { BugChannel, BugReportInput } from "@hub/notion/bug-reports";
import { z } from "zod";
import { defineTool } from "../define";
import { ownFollowUpClient, type ToolCtx } from "../ports";
import { ToolError } from "../result";
import { chatAccess } from "./messengers";

// P145 B3 (verdicts 17 and 18, decision 0054): the agent files a client's bug report through the Hub, never by hand with the
// Notion connector, so the search, the Clients relation and the conversation link are the same every time. The conversation
// (`chat` or a Mail `client`) names the client, the channel and the Source link; the agent gives the area, the symptom, the
// client's words and the evidence it saw. The Hub appends to the one open report of that area and project, creates one when
// there is none, and with several creates nothing and lists them (`into` picks one). One entry per message. It never writes
// Severity, Notes, Fix link or a Status but New, never a cause, and a filing changes nothing a reply may promise.

const evidence = z.string().trim().min(1).max(500);

function project(ctx: ToolCtx, slug: string, named: string | undefined): string {
  const brands = ctx.env.projectConfig?.(slug).brands ?? [];
  if (named) return brandForKey(brands, named)?.name ?? named;
  if (brands.length === 1) return brands[0]!.name;
  if (!brands.length) return slug;
  throw new ToolError("invalid", `Name the project (one of ${brands.map((b) => b.name).join(", ")}): the product the bug is in.`);
}

/** The conversation as the report records it: the client's Clients page, the channel and the admin link. */
async function conversationOf(ctx: ToolCtx, slug: string, input: { chat?: number | undefined; client?: number | undefined }): Promise<{ clientId: number | null; pageId: string | null; email: string | null; channel: BugChannel; path: string }> {
  if ((input.chat === undefined) === (input.client === undefined)) throw new ToolError("invalid", "Give chat or client, one of them: the conversation the report is in.");
  if (input.chat !== undefined) {
    const row = await chatAccess(ctx.repos, ctx.env).target(slug, { chat: input.chat });
    const clientId = await ctx.repos.messengers.clientByIdentifier(slug, row.channel === "whatsapp" ? "whatsapp" : "telegram", row.chatId);
    const c = clientId === null ? null : await ctx.repos.clients.get(slug, clientId);
    const pageId = clientId === null ? null : await ctx.repos.clients.notionPageOf(slug, clientId);
    return { clientId, pageId, email: c?.email ?? null, channel: row.channel === "whatsapp" ? "WhatsApp" : "Telegram", path: `/${slug}/messengers/c/${row.id}` };
  }
  if (ctx.env.autopilotChat !== undefined) throw new ToolError("autopilot_other_chat", `This autopilot turn answers chat:${ctx.env.autopilotChat} only: its report is filed with chat.`);
  const id = input.client as number;
  ownFollowUpClient(ctx.env, id);
  const c = await ctx.repos.clients.get(slug, id);
  if (!c) throw new ToolError("not_found", `No client ${id} in project ${slug}.`);
  return { clientId: id, pageId: await ctx.repos.clients.notionPageOf(slug, id), email: c.email ?? null, channel: "Mail", path: `/${slug}/mail/c/${encodeURIComponent(clientKey({ id, email: c.email ?? null }))}` };
}

export const bugReportTool = defineTool({
  name: "bug_report",
  title: "File a client's bug report",
  description:
    "Files what a client reports as broken (the product does something wrong, with an example, or a known symptom again) in the project's Bug reports: appended to the open report of the same area, else a new one. Not for a feature request, a how-to or billing question, or \"slow\" with no example. Give the conversation, the area, the symptom in their terms, their words and the evidence you saw; never a cause. Afterwards reply: recorded, will be looked at; no date, no cause.",
  input: z
    .object({
      chat: z.number().int().positive().optional().describe("The internal messenger chat id (chat:<id> from focus) the report is in."),
      client: z.number().int().positive().optional().describe("Or a Mail client's id (client_show, mail_list)."),
      message: z.string().trim().min(1).max(300).describe("The message the report is in: its Message-ID (message_show) or the chat message's id (messenger_history). One entry per message."),
      project: z.string().trim().min(1).max(80).optional().describe("The product the bug is in: a ## Brands name of project_show; omit when the project has one."),
      area: z.string().trim().min(3).max(100).describe('Where it is, as "<kind>: <name>" in lower case: "parser: <source>", "site: <domain>", "api", "admin".'),
      symptom: z.string().trim().min(5).max(200).describe("What is wrong, one line, in the client's terms. Not a cause."),
      words: z.string().trim().min(1).max(1500).describe("The client's own words, quoted as they wrote them."),
      evidence: z.array(evidence).max(10).default([]).describe("One item per URL, id or screenshot reference the client gave or you opened with link_fetch; only what you saw."),
      into: z.string().trim().min(32).max(36).optional().describe("Only after a refusal bug_report_several: the page id of the report this repeats."),
    })
    .strict(),
  output: z.object({ project: z.string(), state: z.enum(["created", "appended", "already"]), report: z.string(), client: z.number().nullable(), note: z.string().nullable(), next: z.string() }),
  effect: "draft",
  refusals: ["not_found", "not_linked", "autopilot_other_chat", "followup_other_client", "unavailable", "bug_report_several", "no_bug_database", "notion_unavailable"],
  handler: async (ctx, input) => {
    const slug = ctx.project();
    const file = ctx.env.fileBugReport;
    if (!file) throw new ToolError("unavailable", "This hub MCP server cannot write Notion (no bug report writer).");
    const conv = await conversationOf(ctx, slug, input);
    const origin = ctx.env.adminOrigin?.() ?? null;
    const i: BugReportInput = { project: project(ctx, slug, input.project), area: input.area, symptom: input.symptom, words: input.words, evidence: input.evidence, channel: conv.channel, sourceLink: origin ? `${origin}${conv.path}` : null, clientPageId: conv.pageId, clientEmail: conv.email, messageKey: `${slug}:${input.message}`, at: ctx.now().toISOString(), ...(input.into ? { into: input.into } : {}) };
    const r = await file(slug, i);
    if (r.state === "several") throw new ToolError("bug_report_several", `${r.candidates.length} open reports have this area: ${r.candidates.slice(0, 5).map((c) => `${c.pageId} "${c.bug}"`).join("; ")}. Call again with into.`);
    if (r.state === "no_database") throw new ToolError("no_bug_database", r.detail);
    if (r.state === "no_token" || r.state === "failed") throw new ToolError("notion_unavailable", `The report was not filed: ${r.detail}.`);
    const who = conv.pageId || conv.email ? "" : " The chat has no client, so the report lists none.";
    return {
      project: slug,
      state: r.state,
      report: r.pageId,
      client: conv.clientId,
      note: r.note,
      next: `Reply that the report is recorded and will be looked at; promise no date and no cause; ask for one missing piece of evidence if there is none.${who}`,
    };
  },
});

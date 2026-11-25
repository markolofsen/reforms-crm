import { z } from "zod";
import { LEAD_PASS_DECISIONS, LEAD_PASS_DRAFTED, LEAD_PASS_REASON_MAX } from "@hub/config/lead-pass";
import { defineTool } from "../define";
import { boundLead, ownLeadClient } from "../ports";
import { cut, ToolError } from "../result";

// P147 L2 (decision 0055): the lead pass's two tools. `leads_open` reads the server's mechanical list of open leads with no
// decision (verdict 3), for an attended pass in the dock; `lead_decide` writes the agent's decision for one lead (verdict 2). The
// decision is the agent's notes: it refuses only a malformed shape, another lead in a lead turn (D2), a `client` decision without
// an exact address match (D2), or a second decision. Neither sends anything, and neither makes a Clients card (0044 point 3).

const DAY_MS = 86_400_000;
const PAGE = z.string().trim().regex(/^[0-9a-fA-F-]{32,36}$/).describe("the lead's Notion page id (leads_open, the prompt)");

export const leadsOpenTool = defineTool({
  name: "leads_open",
  title: "The open leads of this project",
  description:
    "The Hub's list of this project's open leads (rows of Notion Leads, Status New, not dismissed, no reply drafted) with no pass decision yet, newest first: page id, name, reply address, brand, when, the 120-character request, site, country, segment, volume, whether a Clients card exists and the client whose email matches exactly. all: true also lists those older than the window. Leads are not unlinked chats. Decide each with lead_decide.",
  input: z.object({ all: z.boolean().optional().describe("also the leads older than leads.window_days (the owner asked for the old ones)"), limit: z.number().int().positive().max(100).optional().describe("at most this many (default 30)") }),
  output: z.object({
    project: z.string(),
    today: z.string(),
    leads: z.array(
      z.object({
        page: z.string(),
        name: z.string(),
        email: z.string().nullable(),
        brand: z.string().nullable(),
        received_at: z.string(),
        request: z.string(),
        site: z.string().nullable(),
        country: z.string().nullable(),
        segment: z.string().nullable(),
        volume: z.string().nullable(),
        has_card: z.boolean(),
        client: z.number().nullable(),
      }),
    ),
    more: z.number(),
    note: z.string(),
  }),
  effect: "read",
  refusals: ["unavailable"],
  handler: async ({ repos, env, project, now }, { all, limit }) => {
    const slug = project();
    const at = now();
    const days = env.projectConfig?.(slug).leads.windowDays ?? 14;
    const from = all ? "" : new Date(at.getTime() - days * DAY_MS).toISOString();
    const due = await repos.leadPass.due(slug, from, limit ?? 30);
    const leads = [];
    for (const r of due.rows) {
      const client = r.email ? await repos.clients.findByIdentity(slug, "email", r.email) : undefined;
      leads.push({ page: r.pageId, name: cut(r.name), email: r.email, brand: r.brand, received_at: r.receivedAt, request: cut(r.preview, 120), site: r.site, country: r.country, segment: r.segment, volume: r.volume, has_card: r.hasClient, client: client ?? null });
    }
    return {
      project: slug,
      today: at.toISOString().slice(0, 10),
      leads,
      more: Math.max(0, due.total - leads.length),
      note: leads.length === 0 ? "No open lead waits for a decision: say so in one line." : "Each lead gets one decision with lead_decide (reply, client, spam, not_now, hand_over); a reply or client decision first writes its new-thread draft with draft_write and record.skill lead-pass. Then report and give the Review link. Nothing is sent.",
    };
  },
});

export const leadDecideTool = defineTool({
  name: "lead_decide",
  title: "Record the pass decision for one lead",
  description:
    "Records your decision for one lead: reply (a real prospect; you wrote the first-reply draft), client (the reply address is exactly an existing client's; you wrote the draft), spam or not_now (a proposal the owner confirms with his Send click), hand_over (the owner decides). reason: one sentence the owner reads. Once per lead; nothing is sent and no Clients card is made.",
  input: z.object({
    lead: PAGE,
    decision: z.enum(LEAD_PASS_DECISIONS),
    reason: z.string().trim().min(3).max(LEAD_PASS_REASON_MAX).describe("one sentence, why (\"Enterprise volume, asks for VIN decode\")"),
  }),
  output: z.object({ project: z.string(), lead: z.string(), decision: z.enum(LEAD_PASS_DECISIONS), client: z.number().nullable(), draft: z.number().nullable(), notion: z.string(), hint: z.string().nullable(), next: z.string() }),
  effect: "draft",
  refusals: ["not_found", "lead_other", "lead_decided", "unavailable"],
  handler: async (ctx, i) => {
    const slug = ctx.project();
    const page = i.lead.replace(/-/g, "").toLowerCase();
    if (ctx.env.leadPage !== undefined && page !== ctx.env.leadPage) throw new ToolError("lead_other", `This lead turn serves lead ${ctx.env.leadPage} only: nothing else is decided here.`);
    const withRepos = ctx.env.withRepos;
    if (!withRepos) throw new ToolError("unavailable", "This hub MCP server cannot record lead decisions (no write connection).");
    const lead = ctx.env.leadPage !== undefined ? await boundLead(ctx, slug) : await ctx.repos.leadRows.get(slug, page);
    if (!lead) throw new ToolError("not_found", `No lead ${i.lead} in project ${slug} (leads_open lists them).`);
    if (lead.passDecision) throw new ToolError("lead_decided", `Lead ${lead.name} was decided already: ${lead.passDecision} (${lead.passReason ?? "no reason"}). Nothing was written.`, { decision: lead.passDecision });
    // D2: `client` only on an exact match of the reply address; any other likeness is the owner's.
    const client = lead.email ? ((await ctx.repos.clients.findByIdentity(slug, "email", lead.email)) ?? null) : null;
    if (i.decision === "client") {
      if (client === null) throw new ToolError("invalid", `No client's email is exactly ${lead.email ?? "this lead's (it has none)"}: decide reply, or hand_over with "possible match: <who>". Nothing was written.`);
      await ownLeadClient(ctx, slug, client);
    }
    const at = ctx.now().toISOString();
    const passId = ctx.env.leadPass ?? (await withRepos((w) => w.leadPass.dockDecision(slug, i.decision, at)));
    const r = await withRepos((w) => w.leadPass.decide({ project: slug, pageId: page, decision: i.decision, reason: i.reason, passId, clientId: i.decision === "client" ? client : null, at }));
    if (r.already) throw new ToolError("lead_decided", `Lead ${lead.name} was decided already: ${r.row.passDecision} (${r.row.passReason ?? "no reason"}). Nothing was written.`, { decision: r.row.passDecision });
    const drafted = (LEAD_PASS_DRAFTED as readonly string[]).includes(i.decision);
    // Verdict 2: a reply or client decision with no pass draft is answered with a hint, never refused.
    const hint = drafted && r.row.passDraftId === null ? "No pass draft of this lead is recorded: write it now with draft_write kind new (record.skill lead-pass), or redo the decision as hand_over." : null;
    const notion = ctx.env.syncLeadDecision ? (await ctx.env.syncLeadDecision(slug, { pageId: page, decision: i.decision, reason: r.row.passReason ?? i.reason })).state : "off";
    return {
      project: slug,
      lead: page,
      decision: i.decision,
      client: i.decision === "client" ? client : null,
      draft: r.row.passDraftId,
      notion,
      hint,
      next: ctx.env.leadPage !== undefined ? "Stop here: the decision is recorded. Write nothing else." : "Go on with the next lead of leads_open, then report: N drafted, M proposed, H for you, and open Review (Mail ▸ Leads).",
    };
  },
});

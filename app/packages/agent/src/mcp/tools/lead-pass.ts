import type { Repos } from "@hub/db";
import { z } from "zod";
import { LEAD_PASS_DECISIONS, LEAD_PASS_DRAFTED, LEAD_PASS_REASON_MAX } from "@hub/config/lead-pass";
import { defineTool, unavailableAnswer } from "../define";
import { boundLead, ownLeadClient } from "../ports";
import { cut, ToolError } from "../result";
import { leadDecisionApplied, samePersonAs, samePersonReason } from "@hub/db";
import { FREE_MAIL, replyAddressOf } from "@hub/notion";

// P147 L2 (decision 0055): the lead pass's two tools. `leads_open` reads the server's mechanical list of open leads with no
// decision (verdict 3), for an attended pass in the dock; `lead_decide` writes the agent's decision for one lead (verdict 2). The
// decision is the agent's notes: it refuses only a malformed shape, another lead in a lead turn (D2), a `client` decision without
// an exact address match (D2), or a second decision. Neither sends anything, and neither makes a Clients card (0044 point 3).

const DAY_MS = 86_400_000;
/** F1 of 3d: the channels in which a person may already be answered (no first-reply mail then). */
const ANSWERED_IN = ["whatsapp", "telegram", "mail"] as const;
const PAGE = z.string().trim().regex(/^[0-9a-fA-F-]{32,36}$/).describe("the lead's Notion page id (leads_open, the prompt)");

export const leadsOpenTool = defineTool({
  name: "leads_open",
  title: "The open leads of this project",
  description:
    "The Hub's list of this project's open leads (its lead rows, the same rows Mail ▸ Leads shows; never the lead notices in Mail) with no pass decision yet, newest first: page id, name, the reply address the Hub chose and why (reply_to null: no usable address, hand_over), same_as (an older request of a person with a newer row: not_now with that reason), brand, when, the 120-character request, site, country, segment, volume, whether a Clients card exists and the client whose email matches exactly. all: true also lists those older than the window. Leads are not unlinked chats. Decide each with lead_decide.",
  input: z.object({ all: z.boolean().optional().describe("also the leads older than leads.window_days (the owner asked for the old ones)"), limit: z.number().int().positive().max(100).optional().describe("at most this many (default 30)") }),
  output: z.object({
    project: z.string(),
    today: z.string(),
    leads: z.array(
      z.object({
        page: z.string(),
        name: z.string(),
        email: z.string().nullable(),
        reply_to: z.string().nullable(),
        reply_why: z.string(),
        same_as: z.string().nullable(),
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
      // E3: the address the reply goes to; E4: an older request of a person with a newer row.
      const to = replyAddressOf(r);
      const person = samePersonAs(r, await repos.leadPass.earlier(slug, r.pageId, 20));
      const dom = to.address ? to.address.slice(to.address.lastIndexOf("@") + 1) : "";
      const company = !person && dom && !FREE_MAIL.has(dom) ? samePersonAs(r, await repos.leadPass.sameDomain(slug, r.pageId, dom)) : null;
      const client = to.address ? await repos.clients.findByIdentity(slug, "email", to.address) : undefined;
      leads.push({ page: r.pageId, name: cut(r.name), email: r.email, reply_to: to.address, reply_why: to.why, same_as: person ? samePersonReason(person) : company ? samePersonReason(company, "company") : null, brand: r.brand, received_at: r.receivedAt, request: cut(r.preview, 120), site: r.site, country: r.country, segment: r.segment, volume: r.volume, has_card: r.hasClient, client: client ?? null });
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
    "Records your decision for one lead: reply (a real prospect; you wrote the first-reply draft), client (the reply address is exactly an existing client's, and you wrote the draft; or, with client and answered_in, the person already talks with us in that channel, so no draft), spam or not_now (a proposal the owner confirms with his Send click), hand_over (the owner decides). reason: one sentence the owner reads. You may change a decision until the owner's review click applied it. Nothing is sent and no Clients card is made.",
  input: z.object({
    lead: PAGE,
    decision: z.enum(LEAD_PASS_DECISIONS),
    reason: z.string().trim().min(3).max(LEAD_PASS_REASON_MAX).describe("one sentence, why (\"Enterprise volume, asks for VIN decode\")"),
    client: z.number().int().positive().optional().describe("client with answered_in: the client this person already talks with"),
    answered_in: z.enum(ANSWERED_IN).optional().describe("client only: the person already has a live conversation there (a linked chat, or a mail thread); no mail draft is written"),
  }),
  output: z.object({ project: z.string(), lead: z.string(), decision: z.enum(LEAD_PASS_DECISIONS), client: z.number().nullable(), draft: z.number().nullable(), notion: z.string(), hint: z.string().nullable(), changed: z.enum(LEAD_PASS_DECISIONS).nullable(), next: z.string() }),
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
    // F2 of 3d: a decision changes until the owner's review click applied it; after that only Redo clears it.
    if (lead.passDecision && leadDecisionApplied(lead)) throw new ToolError("lead_decided", `Lead ${lead.name} was decided and the owner applied it: ${lead.passDecision} (${lead.passReason ?? "no reason"}). Nothing was written.`, { decision: lead.passDecision });
    if ((i.answered_in !== undefined || i.client !== undefined) && i.decision !== "client") throw new ToolError("invalid", "client and answered_in go with decision client only. Nothing was written.");
    // D2: `client` only on an exact match of the reply address; any other likeness is the owner's.
    const to = replyAddressOf(lead).address;
    const exact = to ? ((await ctx.repos.clients.findByIdentity(slug, "email", to)) ?? null) : null;
    let client = exact;
    if (i.decision === "client" && i.answered_in !== undefined) {
      // F1 of 3d: answered in another channel: that client must have the conversation there; no mail draft is wanted.
      client = i.client ?? exact;
      if (client === null) throw new ToolError("invalid", "answered_in names the client this person already talks with: pass client: <id>. Nothing was written.");
      await ownLeadClient(ctx, slug, client);
      if (!(await ctx.repos.clients.get(slug, client))) throw new ToolError("not_found", `No client ${client} in project ${slug}. Nothing was written.`);
      if (!(await liveIn(ctx, slug, client, i.answered_in))) throw new ToolError("invalid", `Client ${client} has no ${i.answered_in === "mail" ? "mail thread (a sent mail)" : `linked ${i.answered_in} chat`}: decide reply with a draft, or hand_over. Nothing was written.`);
    } else if (i.decision === "client") {
      if (client === null) throw new ToolError("invalid", `No client's email is exactly ${to ?? "this lead's (it has no usable address)"}: decide reply, or hand_over with "possible match: <who>"; a person who talks with us in a chat is client with answered_in. Nothing was written.`);
      await ownLeadClient(ctx, slug, client);
    }
    const at = ctx.now().toISOString();
    const passId = ctx.env.leadPass ?? (await withRepos((w) => w.leadPass.dockDecision(slug, i.decision, at)));
    const r = await withRepos((w) => w.leadPass.decide({ project: slug, pageId: page, decision: i.decision, reason: i.reason, passId, clientId: i.decision === "client" ? client : null, at }));
    if (r.already) throw new ToolError("lead_decided", `Lead ${lead.name} was decided already: ${r.row.passDecision} (${r.row.passReason ?? "no reason"}). Nothing was written.`, { decision: r.row.passDecision });
    const drafted = (LEAD_PASS_DRAFTED as readonly string[]).includes(i.decision);
    // Verdict 2: a reply or client decision with no pass draft is answered with a hint, never refused.
    const hint = drafted && i.answered_in === undefined && r.row.passDraftId === null ? "No pass draft of this lead is recorded: write it now with draft_write kind new (record.skill lead-pass), or redo the decision as hand_over." : null;
    const notion = ctx.env.syncLeadDecision ? (await ctx.env.syncLeadDecision(slug, { pageId: page, decision: i.decision, reason: r.row.passReason ?? i.reason })).state : "off";
    return {
      project: slug,
      lead: page,
      decision: i.decision,
      client: i.decision === "client" ? client : null,
      draft: r.row.passDraftId,
      notion,
      hint,
      changed: r.changed,
      next: ctx.env.leadPage !== undefined ? "Stop here: the decision is recorded. Write nothing else." : "Go on with the next lead, then report: N drafted, M proposed, H for you, and the Review link (Mail ▸ Leads ▸ Review).",
    };
  },
});

/** F1 of 3d: whether this client already has a conversation in the channel: a linked chat's identifier, or a mail we sent. */
async function liveIn(ctx: { repos: Repos }, slug: string, client: number, channel: (typeof ANSWERED_IN)[number]): Promise<boolean> {
  if (channel === "mail") return (await ctx.repos.drafts.ofClient(slug, client)).some((d) => d.status === "sent");
  return (await ctx.repos.messengers.identifiersOf(slug, client)).some((x) => x.kind === channel);
}

/** F3 of 3d: the dock's "process the leads": the server's pass (one lead per turn, bound by page id), never a walk of its own. */
export const leadPassStartTool = defineTool({
  name: "lead_pass_start",
  title: "Start the project's lead pass on the server",
  description:
    "Starts the Hub server's lead pass (or, with pass mail, its mail pass) for this project now (the same as the owner's Run now; at most 3 a day each): one headless turn per open lead or inbound thread, each a draft and a decision, nothing sent. Use it for \"process the leads\" (or \"go through the mail\"); answer with the Review link. Decide one yourself only for \"this lead\" or when fewer than 3 are open.",
  input: z.object({ pass: z.enum(["lead", "mail"]).optional().describe("mail: the mail pass over Needs you (default lead)") }),
  output: z.object({ project: z.string(), started: z.boolean(), joined: z.boolean(), review: z.string(), next: z.string() }),
  effect: "draft",
  refusals: ["unavailable", "wrong_state"],
  handler: async ({ env, project }, i) => {
    const slug = project();
    if (!env.leadPassRun) throw new ToolError("unavailable", "This session cannot start the lead pass (the Hub server is not reachable here).");
    const a = await env.leadPassRun.run(slug, i.pass ?? "lead");
    if (!a.ok) throw a.status === 0 ? unavailableAnswer(a.error) : new ToolError(a.status === 409 ? "wrong_state" : "unavailable", a.error);
    return {
      project: slug,
      started: !a.joined,
      joined: a.joined,
      review: "Mail ▸ Leads: the banner's Review today's replies, once the pass has drafted",
      next: "Tell the owner in one line that the pass runs on the server (a few minutes) and that its drafts and proposals wait in Mail ▸ Leads ▸ Review; nothing is sent. Do not decide the leads yourself meanwhile.",
    };
  },
});

import { z } from "zod";
import { LEAD_PASS_REASON_MAX, MAIL_PASS_DECISIONS } from "@hub/config/lead-pass";
import { mailDecisionApplied } from "@hub/db";
import { defineTool } from "../define";
import { boundInbound } from "../ports";
import { ToolError } from "../result";

// P147 3h (decision 0055 point 9): the mail pass's decision tool. `mail_decide` writes the agent's decision for one inbound thread
// (its newest open message): reply or client (with the draft written first), no_reply (a notification, newsletter, receipt,
// automated mail, a thread that needs nothing), spam (phishing or junk: a proposal the owner's click moves to Mail's Junk, 3m
// item 1), hand_over. The decision is the agent's notes: it
// refuses only another message in a mail turn, a reply without its draft, or a decision the owner applied. Nothing is sent.

const DRAFTED = new Set(["reply", "client"]);

export const mailDecideTool = defineTool({
  name: "mail_decide",
  title: "Record the pass decision for one inbound mail",
  description:
    "Records your decision for one inbound thread (its newest open message, inbound:<id>): reply (you wrote the reply draft in its thread), client (they are or become ours; the draft written), no_reply (a notification, newsletter, receipt, automated mail, a thread that needs nothing), spam (phishing or junk: the owner's review click moves it to Mail's Junk; say which in the reason), hand_over (the owner decides). reason: one sentence the owner reads. You may change a decision until the owner's review click applied it. Nothing is sent.",
  input: z.object({
    message: z.number().int().positive().describe("the inbound id (inbound:<id>, the prompt)"),
    decision: z.enum(MAIL_PASS_DECISIONS),
    reason: z.string().trim().min(3).max(LEAD_PASS_REASON_MAX).describe("one sentence, why (\"Phishing: an 'Access Renewal' from a look-alike helpdesk address\")"),
  }),
  output: z.object({ project: z.string(), message: z.number(), decision: z.enum(MAIL_PASS_DECISIONS), draft: z.number().nullable(), changed: z.enum(MAIL_PASS_DECISIONS).nullable(), next: z.string() }),
  effect: "draft",
  refusals: ["not_found", "mail_other", "lead_decided", "unavailable"],
  handler: async (ctx, i) => {
    const slug = ctx.project();
    if (ctx.env.mailInbound !== undefined && i.message !== ctx.env.mailInbound) throw new ToolError("mail_other", `This mail turn serves message ${ctx.env.mailInbound} only: nothing else is decided here.`);
    const withRepos = ctx.env.withRepos;
    if (!withRepos) throw new ToolError("unavailable", "This hub MCP server cannot record mail decisions (no write connection).");
    const row = ctx.env.mailInbound !== undefined ? await boundInbound(ctx, slug) : await ctx.repos.inboundMail.get(slug, i.message);
    if (!row) throw new ToolError("not_found", `No inbound message ${i.message} in project ${slug}.`);
    if (row.passDecision && mailDecisionApplied(row)) throw new ToolError("lead_decided", `Message ${row.id} was decided and the owner applied it: ${row.passDecision} (${row.passReason ?? "no reason"}). Nothing was written.`, { decision: row.passDecision });
    if (DRAFTED.has(i.decision) && row.passDraftId === null) throw new ToolError("invalid", "reply and client come with their draft: write it first (draft_write kind reply), then decide. Nothing was written.");
    const at = ctx.now().toISOString();
    const r = await withRepos((w) => w.mailPass.decide({ project: slug, inboundId: row.id, decision: i.decision, reason: i.reason, passId: ctx.env.leadPass ?? null, at }));
    if (r.already) throw new ToolError("lead_decided", `Message ${row.id} was decided already: ${r.row.passDecision}. Nothing was written.`, { decision: r.row.passDecision });
    return {
      project: slug,
      message: row.id,
      decision: i.decision,
      draft: r.row.passDraftId,
      changed: r.changed,
      next: ctx.env.mailInbound !== undefined ? "Stop here: the decision is recorded. Write nothing else." : "Go on with the next thread, then report: N drafted, M proposed, H for you, and the Review link (Mail ▸ Leads ▸ Review).",
    };
  },
});

/**
 * P147 3m item 1: the owner's attended session moves one phishing or junk mail to Mail's Junk (recoverable, like Trash: not a
 * deletion). The server does it (the agent's shell has no Mail scripting): Mail first, then the sender's open rows leave Needs
 * you, with an Activity line. Only in the sessions the owner starts; the passes propose `spam` instead, applied by his review click.
 */
export const mailJunkTool = defineTool({
  name: "mail_junk",
  title: "Move one inbound mail to Mail's Junk",
  description:
    "Moves one inbound message (inbound:<id>, from message_show or mail_list) to its account's Junk mailbox in Mail and takes the sender out of Needs you; Activity records it. Only for phishing (a mail that impersonates a service to get a click, a sign-in, a code or a payment) or plain junk, and only when the owner asked or plainly agreed. Junk is recoverable in Mail. Never for a client, a lead or anything that needs an answer.",
  input: z.object({ message: z.number().int().positive().describe("the inbound id (inbound:<id>)") }),
  output: z.object({ project: z.string(), message: z.number(), moved: z.literal(true), closed: z.number(), next: z.string() }),
  effect: "draft",
  refusals: ["not_found", "wrong_state", "unavailable"],
  handler: async ({ env, project }, i) => {
    const slug = project();
    if (!env.mailJunk) throw new ToolError("unavailable", "This session cannot move mail (only the sessions the owner starts can; a pass proposes spam instead).");
    const a = await env.mailJunk.junk(slug, i.message);
    if (!a.ok) throw new ToolError(a.status === 404 ? "not_found" : a.status === 409 ? "wrong_state" : "unavailable", a.error);
    return { project: slug, message: i.message, moved: true as const, closed: a.closed, next: "Tell the owner in one line: moved to Junk in Mail (recoverable there), out of Needs you." };
  },
});

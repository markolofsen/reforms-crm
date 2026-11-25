import type { LeadPassBrain, LeadPassTurn, LeadPassTurnResult } from "@hub/config/lead-pass";
import { replyAddressOf } from "@hub/notion";
import { leadPassRequest } from "@hub/config/lead-pass";
import type { Repos } from "@hub/db";

// A lead brain with no model (P147 L4): the e2e run's `HUB_LEAD_BRAIN=fake` (the server wires it only with a throwaway `HUB_DB`)
// and the unit tests. By a fixed script, through the same writers as a real turn's tools (it writes no Mail):
// - a lead with no reply address is a hand_over ("no mail address");
// - a lead whose site is localhost, 127.0.0.1, github.com or a shortener is a spam proposal;
// - every other lead gets a recorded first-reply draft (the day's lead batch) and the decision reply.

export interface FakeLeadPassDeps {
  repos: Repos;
  now?: () => Date;
}

const JUNK = /(^|\/\/|\.)(localhost|127\.0\.0\.1|github\.com|bit\.ly|shrt\.sa)(\/|:|$)/i;

export function fakeLeadPassBrain(d: FakeLeadPassDeps): LeadPassBrain {
  const now = () => (d.now ?? (() => new Date()))();
  return {
    name: "fake",
    async turn(t: LeadPassTurn, signal): Promise<LeadPassTurnResult> {
      if (signal.aborted) return { kind: "failed", code: "failed", detail: "aborted" };
      const at = now().toISOString();
      if (t.kind === "mail") return mailTurn(d, t, at);
      const lead = await d.repos.leadRows.get(t.project, t.pageId);
      if (!lead) return { kind: "failed", code: "failed", detail: `no lead ${t.pageId}` };
      const decide = async (decision: "reply" | "spam" | "hand_over", reason: string): Promise<LeadPassTurnResult> => {
        await d.repos.leadPass.decide({ project: t.project, pageId: t.pageId, decision, reason, passId: t.passId, at });
        return { kind: "decided", decision, costUsd: 0 };
      };
      const to = replyAddressOf(lead).address;
      if (!to) return decide("hand_over", "no mail address: a phone or Telegram only");
      if (lead.site && JUNK.test(lead.site)) return decide("spam", `the site is ${lead.site}`);
      await d.repos.drafts.record({ project: t.project, email: to, name: lead.name, subject: `Your ${lead.brand ?? "API"} request`, mailRef: null, newThread: true, ownerRequest: leadPassRequest(at.slice(0, 10), lead.pageId), skill: "lead-pass", excerpt: "Thank you for your request.", brand: lead.brand, leadPass: { pageId: lead.pageId, passId: t.passId, day: at.slice(0, 10) } });
      return decide("reply", "a prospect: the fake brain answers every lead with a mail address");
    },
  };
}

// P147 3h: the fake mail turn. A sender that looks automated or a subject that asks to renew access, verify or reset is
// `no_reply` (phishing or a notification); every other thread gets a recorded reply draft in its thread and the decision reply.
const AUTOMATED = /(^|[._-])(no-?reply|notifications?|mailer-daemon|alerts?)@/i;
const PHISHING = /\b(access renewal|verify your|password reset|account suspended)\b/i;

async function mailTurn(d: FakeLeadPassDeps, t: LeadPassTurn, at: string): Promise<LeadPassTurnResult> {
  const id = Number(t.pageId);
  const row = await d.repos.inboundMail.get(t.project, id);
  if (!row) return { kind: "failed", code: "failed", detail: `no inbound ${t.pageId}` };
  const decide = async (decision: "reply" | "no_reply", reason: string): Promise<LeadPassTurnResult> => {
    await d.repos.mailPass.decide({ project: t.project, inboundId: id, decision, reason, passId: t.passId, at });
    return { kind: "decided", decision, costUsd: 0 };
  };
  if (AUTOMATED.test(row.email)) return decide("no_reply", "an automated notification: nothing to answer");
  if (PHISHING.test(row.subject)) return decide("no_reply", "phishing: it asks to renew access from a look-alike sender");
  await d.repos.drafts.record({ project: t.project, email: row.email, name: row.name, subject: /^re:/i.test(row.subject) ? row.subject : `Re: ${row.subject}`, mailRef: row.messageId, skill: "triage-mail", excerpt: "Thank you for your message.", mailPass: { inboundId: id, passId: t.passId, day: at.slice(0, 10) } });
  return decide("reply", "a client's question: the fake brain answers every human thread");
}

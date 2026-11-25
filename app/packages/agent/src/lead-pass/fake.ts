import type { LeadPassBrain, LeadPassTurn, LeadPassTurnResult } from "@hub/config/lead-pass";
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
      const lead = await d.repos.leadRows.get(t.project, t.pageId);
      if (!lead) return { kind: "failed", code: "failed", detail: `no lead ${t.pageId}` };
      const decide = async (decision: "reply" | "spam" | "hand_over", reason: string): Promise<LeadPassTurnResult> => {
        await d.repos.leadPass.decide({ project: t.project, pageId: t.pageId, decision, reason, passId: t.passId, at });
        return { kind: "decided", decision, costUsd: 0 };
      };
      if (!lead.email) return decide("hand_over", "no mail address: a phone or Telegram only");
      if (lead.site && JUNK.test(lead.site)) return decide("spam", `the site is ${lead.site}`);
      await d.repos.drafts.record({ project: t.project, email: lead.email, name: lead.name, subject: `Your ${lead.brand ?? "API"} request`, mailRef: null, newThread: true, ownerRequest: leadPassRequest(at.slice(0, 10), lead.pageId), skill: "lead-pass", excerpt: "Thank you for your request.", brand: lead.brand, leadPass: { pageId: lead.pageId, passId: t.passId, day: at.slice(0, 10) } });
      return decide("reply", "a prospect: the fake brain answers every lead with a mail address");
    },
  };
}

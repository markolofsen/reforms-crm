import type { StopReason } from "@hub/config";
import type { SequenceDefinition } from "./definition";

// The stop rule over what a session observed (P47). One order, in code, so "stop on reply" is a gate and not the agent's
// memory (guardrails rule 1). `hub sequences judge` applies it; the record path (`@hub/db`) applies the reply and
// opt-out rows by itself.

/** What a session read for one enrolled client. Every field is optional: an unread fact never stops anything. */
export type StopFacts = {
  /** The client asked us to stop writing, or the local `do_not_contact` mark is set. */
  optedOut?: boolean;
  /** Our last message bounced. */
  bounced?: boolean;
  /** Date of the client's newest inbound message, when there is one. A date after the anchor is a reply. */
  lastInboundAt?: string | null;
  /** An auto-reply after the anchor names this return date. */
  outOfOfficeUntil?: string | null;
  /** The Notion page's `Do not contact` and `Do not follow up` (people own them). */
  doNotContact?: boolean;
  doNotFollowUp?: boolean;
  /** The Clients `Relationship` (Lead, Client, ...), as the page shows it. */
  relationship?: string | null;
  /** The Leads `Status` (New, In progress, Won, Lost, Spam). */
  leadStatus?: string | null;
};

export type StopDecision = { action: "continue" } | { action: "finish"; reason: StopReason; why: string } | { action: "delay"; until: string; why: string };

const CLOSED_LEAD = ["won", "lost", "spam"];

/** First match wins: opted out, bounced, replied, lead closed, excluded by the profile, then an out-of-office. */
export function decideStop(f: StopFacts, def: Pick<SequenceDefinition, "appliesTo" | "stopOn">, anchorAt: string): StopDecision {
  if (f.optedOut) return { action: "finish", reason: "opted_out", why: "the client asked not to be written to" };
  if (f.bounced) return { action: "finish", reason: "bounced", why: "our last message bounced" };
  if (f.lastInboundAt && Date.parse(f.lastInboundAt) > Date.parse(anchorAt)) return { action: "finish", reason: "replied", why: `the client wrote on ${f.lastInboundAt}, after our message` };
  if (f.leadStatus && CLOSED_LEAD.includes(f.leadStatus.trim().toLowerCase())) return { action: "finish", reason: "closed", why: `the lead is ${f.leadStatus}` };
  if (f.doNotContact) return { action: "finish", reason: "excluded", why: "Do not contact is ticked on the profile" };
  if (f.doNotFollowUp) return { action: "finish", reason: "excluded", why: "Do not follow up is ticked on the profile" };
  const rel = f.relationship?.trim().toLowerCase();
  if (rel && !def.appliesTo.some((a) => a.toLowerCase() === rel)) return { action: "finish", reason: "excluded", why: `Relationship ${f.relationship} is outside ${def.appliesTo.join(", ")}` };
  if (f.outOfOfficeUntil) {
    if (def.stopOn.includes("out_of_office")) return { action: "finish", reason: "stopped", why: "an auto-reply, and this sequence stops on one" };
    return { action: "delay", until: f.outOfOfficeUntil, why: `away until ${f.outOfOfficeUntil}` };
  }
  return { action: "continue" };
}

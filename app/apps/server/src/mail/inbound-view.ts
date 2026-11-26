import { answeringDraft, type InboundRow, type LeadRow } from "@hub/db";
import { type InboundRowDto, type LeadRowDto } from "@hub/contract/inbound";
import { leadPassDisplay } from "@hub/config/lead-pass";

// P120 W4: an inbound row, a lead and the answering draft as the Inbox card shows them (route files import no @hub/db).
export const rowDto = (r: InboundRow & { messages?: number }): InboundRowDto => ({
  id: r.id,
  email: r.email,
  name: r.name,
  subject: r.subject,
  receivedAt: r.receivedAt,
  read: r.read,
  why: r.why,
  preview: r.preview,
  messages: r.messages ?? 1,
  threadDraftId: r.threadDraftId,
});

export const leadDto = (r: LeadRow & { requests?: number; draftStatus?: string | null }): LeadRowDto => ({
  pageId: r.pageId,
  name: r.name,
  email: r.email,
  accountEmail: r.accountEmail,
  brand: r.brand,
  receivedAt: r.receivedAt,
  preview: r.preview,
  requests: r.requests ?? 1,
  facts: { site: r.site, country: r.country, segment: r.segment, volume: r.volume },
  pass: r.passDecision ? { decision: r.passDecision, display: leadPassDisplay({ ...r, draftStatus: r.draftStatus ?? null }), reason: r.passReason, at: r.passAt, draftId: r.passDraftId, excludedAt: r.passExcludedAt } : null,
});
/** How much of the answering draft's text the card shows (the stored body; Mail holds the full draft). */
const ANSWER_EXCERPT = 600;

/** The draft that answers this message, as the card shows it (P96), or null. */
export const answerCard = <D extends { id: number; mailRef: string | null; createdAt: string; subject: string; status: string; body: string }>(row: InboundRow, all: readonly D[]) => {
  const answer = answeringDraft(row, all);
  return answer ? { id: answer.id, subject: answer.subject, status: answer.status, createdAt: answer.createdAt, excerpt: answer.body.replace(/\s+/g, " ").trim().slice(0, ANSWER_EXCERPT) } : null;
};

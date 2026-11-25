import { z } from "zod";
import { LEAD_PASS_DECISIONS, LEAD_PASS_DISPLAY, LEAD_PASS_SCHEDULES, LEAD_PASS_TRIGGERS } from "@hub/config/lead-pass";

// The daily lead pass (decision 0055, P147 L4 and L5): the requests the API accepts and the replies it sends. The pass's writes
// (Run now, Redo) only start a pass or clear one decision, behind the admin's exact Origin. The review's ticket is the owner's one
// click for exactly the ticked drafts and proposals (decision 0055 point 2): the hashes it binds are the server's, never sent by
// the browser (D10). Nothing here sends by itself.

const project = z.string().min(1).max(100);
const page = z.string().regex(/^[0-9a-fA-F-]{32,36}$/);

// ---- Requests

export const leadPageParam = z.object({ slug: project, pageId: page });
export const runLeadPassBody = z.strictObject({});
export const leadReviewParam = z.object({ slug: project, batchId: z.coerce.number().int().positive() });
/** The review's one click: the ticked drafts (each its id), the unticked ones (excluded, D7), and the ticked proposals. */
export const leadReviewTicketBody = z.strictObject({
  send: z.array(z.number().int().positive()).max(200),
  exclude: z.array(z.number().int().positive()).max(200).default([]),
  proposals: z.array(z.strictObject({ pageId: page, decision: z.enum(["spam", "not_now"]) })).max(200).default([]),
});
export type LeadReviewTicketBody = z.infer<typeof leadReviewTicketBody>;

// ---- Replies

export const leadPassRowDto = z.object({
  id: z.number(),
  trigger: z.enum(LEAD_PASS_TRIGGERS),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  listed: z.number(),
  turns: z.number(),
  replied: z.number(),
  clients: z.number(),
  spam: z.number(),
  notNow: z.number(),
  handedOver: z.number(),
  failed: z.number(),
  skipped: z.number(),
  batchId: z.number().nullable(),
  error: z.string().nullable(),
});
export type LeadPassRowDto = z.infer<typeof leadPassRowDto>;

/** Overview's line and the Leads banner (verdict 15): today's decisions in the window, the last pass, the next, the review. */
export const leadPassTodayDto = z.object({ drafted: z.number(), spam: z.number(), notNow: z.number(), forYou: z.number(), sent: z.number(), excluded: z.number() });
export type LeadPassTodayDto = z.infer<typeof leadPassTodayDto>;

export const leadPassDto = z.object({
  today: leadPassTodayDto,
  pass: z.object({
    schedule: z.enum(LEAD_PASS_SCHEDULES),
    at: z.string(),
    last: leadPassRowDto.nullable(),
    /** The next scheduled pass (ISO), null when `leads.pass` is off. */
    next: z.string().nullable(),
    running: z.boolean(),
    /** Why Run now is not offered (3 a day used, no model on this server), or null. */
    runNowOff: z.string().nullable(),
    /** Why the last pass stopped early (three failures in a row, the day's turns used up), shown as a Needs you item. */
    stopped: z.string().nullable(),
  }),
  /** The open lead batch to review (verdict 7), its drafts still waiting, and its proposals; null batch: nothing to review. */
  review: z.object({ batchId: z.number().nullable(), drafts: z.number(), proposals: z.number() }),
});
export type LeadPassDto = z.infer<typeof leadPassDto>;

export const runLeadPassDto = z.object({ ok: z.literal(true), joined: z.boolean() });
export const leadRedoneDto = z.object({ ok: z.literal(true), pageId: z.string() });

/** One drafted lead of the review (verdict 7): the request beside the draft's full text read fresh from Mail. */
export const leadReviewRowDto = z.object({
  pageId: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  brand: z.string().nullable(),
  receivedAt: z.string(),
  request: z.string(),
  decision: z.enum(LEAD_PASS_DECISIONS),
  reason: z.string().nullable(),
  display: z.enum(LEAD_PASS_DISPLAY),
  draftId: z.number(),
  /** The text as Mail holds it now (its hash is stored by the server at this read, D10), or null with `held`. */
  mail: z.object({ from: z.string(), to: z.array(z.string()), cc: z.array(z.string()), subject: z.string(), body: z.string() }).nullable(),
  /** Why this draft would not go out now (the door's `assess`, in words); empty: it can be sent. */
  held: z.array(z.string()),
  /** The tick's default (on, D10), off for a held or excluded draft. */
  ticked: z.boolean(),
});
export type LeadReviewRowDto = z.infer<typeof leadReviewRowDto>;

export const leadProposalDto = z.object({ pageId: z.string(), name: z.string(), email: z.string().nullable(), site: z.string().nullable(), request: z.string(), decision: z.enum(["spam", "not_now"]), reason: z.string().nullable() });
export const leadHandOverDto = z.object({ pageId: z.string(), name: z.string(), email: z.string().nullable(), request: z.string(), reason: z.string().nullable() });

export const leadReviewDto = z.object({
  batchId: z.number(),
  name: z.string(),
  rows: z.array(leadReviewRowDto),
  proposals: z.array(leadProposalDto),
  handOvers: z.array(leadHandOverDto),
  /** The batch cap (50 a day) and the spacing, as P85b's plan states them. */
  cap: z.object({ limit: z.number(), used: z.number(), room: z.number() }),
  spacingSeconds: z.number(),
});
export type LeadReviewDto = z.infer<typeof leadReviewDto>;

/** The click's answer: the run's ticket (P85b's batch run takes it), what goes out, what is held, and the applied proposals. */
export const leadReviewTicketDto = z.object({
  ticket: z.string().nullable(),
  items: z.array(z.object({ draftId: z.number(), name: z.string(), to: z.array(z.string()), subject: z.string() })),
  held: z.array(z.object({ draftId: z.number(), name: z.string(), reasons: z.array(z.string()) })),
  applied: z.object({ spam: z.number(), notNow: z.number(), excluded: z.number(), notion: z.array(z.string()) }),
});
export type LeadReviewTicketDto = z.infer<typeof leadReviewTicketDto>;

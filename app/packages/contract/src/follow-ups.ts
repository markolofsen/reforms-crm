import { z } from "zod";
import { FOLLOW_UP_CHANNELS, FOLLOW_UP_DECIDED_BY, FOLLOW_UP_DISPLAY, FOLLOW_UP_STATES, FOLLOW_UP_STOP_REASONS, FOLLOW_UP_TRIGGERS, FOLLOW_UP_WAITING_ON } from "@hub/config/follow-ups";

// The daily follow-up sweep (decision 0050, P142 F4 and F6): the requests the API accepts and the replies it sends. A plan is the
// agent's notes: the owner's writes only change its date, stop it or resume it (no ticket: they only delay or stop, verdict 15).
// Nothing here sends.

const project = z.string().min(1).max(100);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---- Requests

export const followUpParam = z.object({ slug: project, clientId: z.coerce.number().int().positive() });
export const runFollowUpsBody = z.strictObject({});
/** The owner's three moves on one plan (Activity ▸ Follow-ups, the conversation header). */
export const setFollowUpBody = z.discriminatedUnion("action", [z.strictObject({ action: z.literal("date"), nextAt: date }), z.strictObject({ action: z.literal("stop") }), z.strictObject({ action: z.literal("resume") })]);
export type SetFollowUpBody = z.infer<typeof setFollowUpBody>;

// ---- Replies

export const followUpDto = z.object({
  clientId: z.number(),
  name: z.string(),
  state: z.enum(FOLLOW_UP_STATES),
  display: z.enum(FOLLOW_UP_DISPLAY),
  nextAt: z.string().nullable(),
  waitingOn: z.enum(FOLLOW_UP_WAITING_ON).nullable(),
  nudgesSent: z.number(),
  lastNudgeAt: z.string().nullable(),
  channel: z.enum(FOLLOW_UP_CHANNELS).nullable(),
  reason: z.string().nullable(),
  stopReason: z.enum(FOLLOW_UP_STOP_REASONS).nullable(),
  line: z.string().nullable(),
  decidedBy: z.enum(FOLLOW_UP_DECIDED_BY),
  decidedAt: z.string(),
});
export type FollowUpDto = z.infer<typeof followUpDto>;

export const followUpSweepDto = z.object({
  id: z.number(),
  trigger: z.enum(FOLLOW_UP_TRIGGERS),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  listed: z.number(),
  turns: z.number(),
  nudged: z.number(),
  waited: z.number(),
  stopped: z.number(),
  handedOver: z.number(),
  failed: z.number(),
  skipped: z.number(),
  error: z.string().nullable(),
});
export type FollowUpSweepDto = z.infer<typeof followUpSweepDto>;

/** Overview's line (verdict 15): "Follow-ups today: 3 ready · 5 waiting · 1 stopped · 1 for you", the last sweep and the next. */
export const followUpTodayDto = z.object({ ready: z.number(), waiting: z.number(), due: z.number(), stopped: z.number(), forYou: z.number() });
export type FollowUpTodayDto = z.infer<typeof followUpTodayDto>;

export const followUpsDto = z.object({
  rows: z.array(followUpDto),
  today: followUpTodayDto,
  sweep: z.object({
    schedule: z.enum(["daily", "off"]),
    at: z.string(),
    last: followUpSweepDto.nullable(),
    /** The next scheduled sweep (ISO), null when the schedule is off. */
    next: z.string().nullable(),
    running: z.boolean(),
    /** Why Run now is not offered (the 3 a day are used, no brain on this server), or null. */
    runNowOff: z.string().nullable(),
    /** The reason the last sweep stopped early (three failures in a row), shown as an Overview item. */
    stopped: z.string().nullable(),
  }),
});
export type FollowUpsDto = z.infer<typeof followUpsDto>;

export const runFollowUpsDto = z.object({ ok: z.literal(true), joined: z.boolean(), sweep: followUpSweepDto.nullable() });
export const followUpChangedDto = z.object({ ok: z.literal(true), followUp: followUpDto });

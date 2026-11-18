import { z } from "zod";
import { RUN_STATUSES } from "@hub/config";

/**
 * Activity (P48 W5): what the agent did, one row per client decision, grouped by session. A session is one agent run: every
 * `hub record-draft` / `record-client` of one session joins the run of its `batchKey`, so one session is one group. The
 * outcome and the reason are in the row; nothing hides behind a Details click. Run numbers the hub does not know (model,
 * tokens, cost, duration) are null, never 0, so the screen shows them only when they are real.
 */

/** What happened to the client, in the owner's words. `other`: a step that is not a client decision (an error, a Notion write). */
export const ACTIVITY_OUTCOMES = ["drafted", "skipped", "escalated", "flagged", "other"] as const;
export type ActivityOutcome = (typeof ACTIVITY_OUTCOMES)[number];
export const ACTIVITY_OUTCOME_LABELS: Record<ActivityOutcome, string> = { drafted: "Drafted", skipped: "Skipped", escalated: "Escalated", flagged: "Flagged", other: "Note" };

export const activityRowDto = z.strictObject({
  /** The event id. */
  id: z.number(),
  runId: z.number(),
  at: z.string(),
  client: z.strictObject({ id: z.number(), name: z.string() }).nullable(),
  /** The name the agent recorded when no client row exists (a skipped sender). */
  who: z.string(),
  outcome: z.enum(ACTIVITY_OUTCOMES),
  /** The agent's reason, in its words; null when it gave none. */
  why: z.string().nullable(),
  /** The draft this row made or points at, when there is one (opens the card). */
  draftId: z.number().nullable(),
});
export type ActivityRowDto = z.infer<typeof activityRowDto>;

export const activitySessionDto = z.strictObject({
  runId: z.number(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  skill: z.string().nullable(),
  trigger: z.string(),
  status: z.enum(RUN_STATUSES),
  /** Null while unknown (a session the hub only saw through `record-*`): never shown as 0. */
  model: z.string().nullable(),
  tokens: z.strictObject({ in: z.number(), out: z.number() }).nullable(),
  costUsd: z.number().nullable(),
  durationS: z.number().nullable(),
  rows: z.array(activityRowDto),
});
export type ActivitySessionDto = z.infer<typeof activitySessionDto>;

export const activityDto = z.strictObject({
  sessions: z.array(activitySessionDto),
  /** Sessions per run status, plus `all`: the counts of the View menu. */
  counts: z.strictObject({ all: z.number(), ok: z.number(), needs_human: z.number(), failed: z.number() }),
});
export type ActivityDto = z.infer<typeof activityDto>;

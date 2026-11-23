import { z } from "zod";

/**
 * Activity (P73, decision 0037): one timeline of what the agent decided, newest first, one row per client decision. No
 * session: the run an event joined is not a session (one `record-*` call each, or one draft's lifetime across days), so the
 * timeline is not grouped by it. The outcome and the reason are in the row; nothing hides behind a Details click.
 */

/**
 * What happened to the client, in the owner's words. `updated`: a saved revision of an open draft (`action: "update"`). `linked`
 * (P84): the Hub linked the client's chat by itself on an exact identifier; the row's `why` says which ("phone matches the client").
 * `sent` (P87, decision 0037 as amended): a mail or a message went out through the send door; the row's `why` is the way it
 * went (Batch, By hand, Autosend, "By hand on Telegram"). In All only; Activity ▸ Sends lists every send.
 */
export const ACTIVITY_OUTCOMES = ["drafted", "updated", "skipped", "escalated", "flagged", "linked", "sent"] as const;
export type ActivityOutcome = (typeof ACTIVITY_OUTCOMES)[number];
export const ACTIVITY_OUTCOME_LABELS: Record<ActivityOutcome, string> = { drafted: "Drafted", updated: "Updated the draft", skipped: "Skipped", escalated: "Escalated", flagged: "Flagged", linked: "Linked a chat", sent: "Sent" };

/** The views of the View menu, by outcome: Needs you is escalated and flagged, Drafts is drafted and updated. */
export const ACTIVITY_VIEWS = ["all", "needs_you", "drafts", "skipped"] as const;
export type ActivityView = (typeof ACTIVITY_VIEWS)[number];

/** A page cursor: `<at>|<key>` of the last row of the page before (`event:12` or `send:3`, P87). */
export const ACTIVITY_CURSOR = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\|(?:event|send):\d{1,12}$/;

const clientRef = z.strictObject({ id: z.number(), name: z.string() });

export const activityRowDto = z.strictObject({
  /** The source row's id: the event's, or the send's (`send_log`) for outcome `sent`. */
  id: z.number(),
  /** Unique across both sources (`event:12`, `send:3`, P87): the list key; the cursor ends with it. */
  key: z.string().regex(/^(?:event|send):\d{1,12}$/),
  at: z.string(),
  client: clientRef.nullable(),
  /** The name the agent recorded when no client row exists (a skipped sender). */
  who: z.string(),
  outcome: z.enum(ACTIVITY_OUTCOMES),
  /** The agent's reason, in its words; null when it gave none. */
  why: z.string().nullable(),
  /** The draft this row made or points at, when there is one (opens the card). */
  draftId: z.number().nullable(),
  /** The skill the event itself names; never the run's, never the hub's own writer (`draft_write`). */
  skill: z.string().nullable(),
  /** The reply preparation provider, when this activity row came from Messenger drafting. */
  provider: z.enum(["hub_llm", "runtime_agent"]).nullable(),
});
export type ActivityRowDto = z.infer<typeof activityRowDto>;

export const activityDto = z.strictObject({
  /** Newest first: at most one page. */
  rows: z.array(activityRowDto),
  /** Rows per view over the whole timeline (of the one client, when narrowed): the counts of the View menu. */
  counts: z.strictObject({ all: z.number(), needs_you: z.number(), drafts: z.number(), skipped: z.number() }),
  /** The cursor of the next, older page; null on the last one. */
  next: z.string().regex(ACTIVITY_CURSOR).nullable(),
  /** The client the timeline is narrowed to (`client=`), when it exists. */
  client: clientRef.nullable(),
});
export type ActivityDto = z.infer<typeof activityDto>;

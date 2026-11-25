import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { FollowUpChannel, FollowUpDecidedBy, FollowUpState, FollowUpStopReason, FollowUpTrigger, FollowUpWaitingOn } from "@hub/config/follow-ups";
import { clients } from "./clients";

// The daily follow-up sweep (decision 0050, P142, migration 0046). A plan is the agent's notes on one silent client (verdict 3):
// the next date, the state, who owes the next message, the reason and the count of nudges sent. No tool, door or draft check reads
// it to refuse anything. "Ready" (an open nudge draft) and "due" (waiting with its date passed) are derived, never stored.
// `nudges_sent` and `last_nudge_at` move only when a draft with `follow_up_n` is sent (verdict 11); the client writing resets the
// plan to `answered`; our own new message after a stop or a hand-over reopens it.
export const followUps = sqliteTable(
  "follow_ups",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    state: text("state").$type<FollowUpState>().notNull(),
    nextAt: text("next_at"),
    waitingOn: text("waiting_on").$type<FollowUpWaitingOn>(),
    nudgesSent: integer("nudges_sent").notNull().default(0),
    lastNudgeAt: text("last_nudge_at"),
    channel: text("channel").$type<FollowUpChannel>(),
    reason: text("reason"),
    stopReason: text("stop_reason").$type<FollowUpStopReason>(),
    tz: text("tz"),
    /** The newest profile line (verdict 13); every line is also an Activity event. */
    line: text("line"),
    decidedBy: text("decided_by").$type<FollowUpDecidedBy>().notNull(),
    decidedAt: text("decided_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [uniqueIndex("follow_ups_client").on(t.project, t.clientId), index("follow_ups_due").on(t.project, t.state, t.nextAt)],
);

// One row per sweep (verdict 10): its trigger, its counts and its error. "Last swept" and the day's turn budget survive a restart.
export const followUpSweeps = sqliteTable(
  "follow_up_sweeps",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    trigger: text("trigger").$type<FollowUpTrigger>().notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    listed: integer("listed").notNull().default(0),
    turns: integer("turns").notNull().default(0),
    nudged: integer("nudged").notNull().default(0),
    waited: integer("waited").notNull().default(0),
    stopped: integer("stopped").notNull().default(0),
    handedOver: integer("handed_over").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    error: text("error"),
  },
  (t) => [index("follow_up_sweeps_project").on(t.project, t.startedAt)],
);

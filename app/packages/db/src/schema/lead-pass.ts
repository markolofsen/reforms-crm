import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { LeadPassTrigger, PassKind } from "@hub/config/lead-pass";
import { batches } from "./drafts";

// The daily lead pass (decision 0055, P147, migration 0047). One row per pass (verdict 4): its trigger, its counts per decision,
// its day's lead batch and its error, so "last pass" and the day's turn budget survive a restart. Each lead's decision is on its
// own `lead_rows` row (`pass_*`, verdict 2): the agent's notes, never a gate.
export const leadPasses = sqliteTable(
  "lead_passes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    trigger: text("trigger").$type<LeadPassTrigger>().notNull(),
    /** P147 3h (migration 0049): which pass of the one runner; the day's turn budget counts both. */
    kind: text("kind").$type<PassKind>().notNull().default("lead"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    listed: integer("listed").notNull().default(0),
    turns: integer("turns").notNull().default(0),
    replied: integer("replied").notNull().default(0),
    clients: integer("clients").notNull().default(0),
    spam: integer("spam").notNull().default(0),
    notNow: integer("not_now").notNull().default(0),
    handedOver: integer("handed_over").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    noReply: integer("no_reply").notNull().default(0),
    batchId: integer("batch_id").references(() => batches.id, { onDelete: "set null" }),
    error: text("error"),
  },
  (t) => [index("lead_passes_project").on(t.project, t.startedAt)],
);

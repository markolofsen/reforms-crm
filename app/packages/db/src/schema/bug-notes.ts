import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { clients } from "./clients";
import { drafts } from "./drafts";
import { messengerDrafts } from "./messengers";

// P145 B4 (P147 3m item 6, migration 0050): a fixed bug's note to one client. One row per (report, client): what keeps the sweep
// from drafting it twice, its draft, when the client was told (the send's time) and when Notion's `Client told` was written.
export const BUG_NOTE_CHANNELS = ["mail", "telegram", "whatsapp"] as const;
export type BugNoteChannel = (typeof BUG_NOTE_CHANNELS)[number];

export const bugFixedNotes = sqliteTable(
  "bug_fixed_notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    reportPageId: text("report_page_id").notNull(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    channel: text("channel").$type<BugNoteChannel>().notNull(),
    draftId: integer("draft_id").references(() => drafts.id, { onDelete: "set null" }),
    messengerDraftId: integer("messenger_draft_id").references(() => messengerDrafts.id, { onDelete: "set null" }),
    draftedAt: text("drafted_at"),
    toldAt: text("told_at"),
    notionToldAt: text("notion_told_at"),
    createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [uniqueIndex("bug_fixed_notes_report_client").on(t.project, t.reportPageId, t.clientId)],
);

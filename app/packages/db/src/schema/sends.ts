import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { drafts } from "./drafts";
import { messengerDrafts } from "./messengers";

// The send audit (decision 0011, plan P23): one row per send attempt, with the full text. `queued` is an autosend
// waiting out its cancel window (`dueAt`); `sending` is the moment around the Mail call (a crash leaves it behind on
// purpose: nobody can tell whether the mail left, so it blocks a second send until a person resolves it).
// A draft has at most one row that is queued, sending or sent.
export const SEND_STATUSES = ["queued", "sending", "sent", "failed", "cancelled"] as const;

/** The door of one send (P71 M4): Mail, or a messenger channel. */
export const SEND_CHANNELS = ["mail", "telegram_user", "telegram_bot", "whatsapp"] as const;

export type SendChannel = (typeof SEND_CHANNELS)[number];

export type SendStatus = (typeof SEND_STATUSES)[number];

export const sendLog = sqliteTable(
  "send_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    draftId: integer("draft_id").references(() => drafts.id, { onDelete: "set null" }),
    mode: text("mode").$type<"manual" | "auto">().notNull(),
    status: text("status").$type<SendStatus>().notNull(),
    actor: text("actor").notNull(), // who asked: "cli", "admin", "auto"
    createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    dueAt: text("due_at"), // queued: the earliest moment it may be sent
    doneAt: text("done_at"), // sent, failed or cancelled
    sender: text("sender"),
    toAddr: text("to_addr").notNull(),
    ccAddr: text("cc_addr"),
    bccAddr: text("bcc_addr"),
    subject: text("subject").notNull(),
    body: text("body").notNull(), // the full text that was (or is to be) sent
    mailRef: text("mail_ref"),
    sentMessageId: text("sent_message_id"),
    error: text("error"), // failed: why; cancelled: who or what cancelled it
    // P71 M4 (migration 0027): the door a send went through. A messenger row has `messenger_draft_id`, `to_addr` = `<channel>:<chat
    // id>`, `sender` = the account id, `subject` = who it went to; `draft_id` stays Mail's.
    channel: text("channel").$type<SendChannel>().notNull().default("mail"),
    messengerDraftId: integer("messenger_draft_id").references((): AnySQLiteColumn => messengerDrafts.id, { onDelete: "set null" }),
    // Decision 0046 (migration 0034): the session-log reference of the owner's word an agent send went out on
    // (`<session>@<ts>`), null for every other send. Unique: one send per word.
    ownerWord: text("owner_word"),
  },
  (t) => [
    uniqueIndex("send_log_owner_word").on(t.ownerWord).where(sql`${t.ownerWord} is not null`),
    uniqueIndex("send_log_draft_live").on(t.draftId).where(sql`${t.status} in ('queued','sending','sent')`),
    uniqueIndex("send_log_messenger_draft_live").on(t.messengerDraftId).where(sql`${t.status} in ('queued','sending','sent')`),
    index("send_log_project_created").on(t.project, t.createdAt),
    index("send_log_due").on(t.status, t.dueAt),
    index("send_log_channel_sender").on(t.channel, t.sender, t.createdAt),
  ],
);

// Stop all: `project` is a slug or `*` (every project). While `stopped`, nothing is queued or sent for the scope.
export const sendControl = sqliteTable("send_control", {
  project: text("project").primaryKey(),
  stopped: integer("stopped", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
});

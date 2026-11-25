import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { EnrollmentState, FinishReason, InboxAction, InboxKind, NotionKind } from "@hub/config";
import { clients } from "./clients";
import { drafts } from "./drafts";
import { leadPasses } from "./lead-pass";
import type { LeadPassDecision, MailPassDecision } from "@hub/config/lead-pass";

// Follow-up sequences (P47, `@docs/core/23-sequences.md`). One row per time the owner enrolled a client in a project's sequence.
// `step` is the NEXT step to draft; `schedule` is the copy of the file's waits taken at enrolment (JSON {delays, businessDays}),
// so an edited file applies to new enrolments only and `sequence_hash` says which text it was. Every change goes through
// `transition()` of `@hub/sequences` (repos/enrollments.ts). `waiting`, `due` and `draft ready` are derived, never stored.
// One OPEN enrollment per client per project (partial unique index); finished ones stay as history.
export const enrollments = sqliteTable(
  "enrollments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    sequence: text("sequence").notNull(), // the file id: projects/<slug>/sequences/<sequence>.md
    sequenceHash: text("sequence_hash").notNull(),
    schedule: text("schedule").notNull(),
    step: integer("step").notNull().default(1),
    state: text("state").$type<EnrollmentState>().notNull().default("active"),
    nextDueAt: text("next_due_at"),
    anchorAt: text("anchor_at").notNull(), // our last outbound message: what the next wait counts from
    enrolledAt: text("enrolled_at").notNull(),
    enrolledBy: text("enrolled_by").notNull(), // "owner" (his terminal) or "agent" (a session, on the owner's phrase: D1, P48)
    enrolledPhrase: text("enrolled_phrase"), // the owner's words that asked for it in a session; null when he enrolled it himself
    finishedAt: text("finished_at"),
    finishReason: text("finish_reason").$type<FinishReason>(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("enrollments_client_open").on(t.project, t.clientId).where(sql`${t.state} in ('active','paused')`),
    index("enrollments_project_state").on(t.project, t.state, t.nextDueAt),
  ],
);

// The inbox (P26, decision 0009 amended): one row per client the agent TOUCHED in a triage, drafted or not, so the
// admin can say who is owed a reply and why no draft exists. Local state only: no client record is copied from Notion
// and no mail text is stored (decision 0013): `reason` is the agent's own line, `subject` is a header.
// One row per (project, email): a later triage of the same client updates it; `firstSeenAt` keeps the first time.
export const inboxRows = sqliteTable(
  "inbox_rows",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    subject: text("subject"),
    mailRef: text("mail_ref"), // Message-ID of the newest inbound message, for "Open in Mail"
    lastInboundAt: text("last_inbound_at"),
    mailClass: text("mail_class"),
    action: text("action").$type<InboxAction>().notNull(),
    reason: text("reason"),
    kind: text("kind").$type<InboxKind>(), // null = an ordinary triage row; set = "Not by email"
    phone: text("phone"), // free text the agent copied from the mail, only ever shown
    repliesOwed: integer("replies_owed", { mode: "boolean" }).notNull().default(false),
    notionKind: text("notion_kind").$type<NotionKind>(),
    notionPageId: text("notion_page_id"),
    notionUrl: text("notion_url"),
    skill: text("skill"),
    firstSeenAt: text("first_seen_at").notNull(),
    recordedAt: text("recorded_at").notNull(),
  },
  (t) => [uniqueIndex("inbox_rows_project_email").on(t.project, t.email), index("inbox_rows_project_recorded").on(t.project, t.recordedAt)],
);

// The Mail reader (P96, migration 0031): one row per inbound message the server judged a client's (strict rules, no LLM:
// a reply in a thread the Hub knows, a known client, or the owner's test address in test mode). Read-only toward Mail.
// Never the body (decision 0013): `preview` is at most 120 characters of the client's own text; the whole text is read
// from Mail when the row is opened. A row leaves the Inbox view by work (a draft or an agent record after it) or by the
// owner's No reply needed (`dismissedAt`, undone by Undo); it is never deleted by the reader.
export const inboundMail = sqliteTable(
  "inbound_mail",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    account: text("account").notNull(),
    mailbox: text("mailbox").notNull(),
    messageId: text("message_id").notNull(), // bare, lower case
    email: text("email").notNull(), // the sender, lower case
    name: text("name").notNull(),
    subject: text("subject").notNull().default(""),
    receivedAt: text("received_at").notNull(),
    read: integer("read", { mode: "boolean" }).notNull().default(false),
    // Why the reader took it: `thread` (it answers a message of ours), `client` (a known client), `test` (allow_list in test mode).
    why: text("why").$type<"thread" | "client" | "test">().notNull(),
    threadDraftId: integer("thread_draft_id").references((): AnySQLiteColumn => drafts.id, { onDelete: "set null" }),
    threadRef: text("thread_ref"), // the Message-ID of ours it answers, bare
    preview: text("preview").notNull().default(""),
    dismissedAt: text("dismissed_at"),
    // P97: why the row left Inbox without work: null is the owner's No reply needed; `lead_notice` is the reader's re-judge (a site's notification of a lead).
    dismissedReason: text("dismissed_reason").$type<"lead_notice" | "answered">(), // P97: answered = the owner replied by hand in Mail
    storedAt: text("stored_at").notNull(),
    // P147 3h (decision 0055 point 9, migration 0049): the daily mail pass's decision on this thread (its newest open message),
    // the agent's notes; its draft (stamped by the record of that draft) and the owner's untick in the review.
    passDecision: text("pass_decision").$type<MailPassDecision>(),
    passReason: text("pass_reason"),
    passAt: text("pass_at"),
    passId: integer("pass_id").references((): AnySQLiteColumn => leadPasses.id, { onDelete: "set null" }),
    passDraftId: integer("pass_draft_id").references((): AnySQLiteColumn => drafts.id, { onDelete: "set null" }),
    passExcludedAt: text("pass_excluded_at"),
  },
  (t) => [uniqueIndex("inbound_mail_project_message").on(t.project, t.messageId), index("inbound_mail_project_email").on(t.project, t.email, t.receivedAt)],
);

// P97 S2 (decision 0044, migration 0033): the Leads reader's rows, one per Notion Leads page read as New in the project's window.
// Decision 0013: only the page id, name, reply address, account email, brand, when, the Status as read and 120 characters of the
// Message; the card reads the rest from Notion. `dismissedReason`: the owner's Not now or Spam; `converted*`: the first send (S4).
export const LEAD_DISMISS_REASONS = ["not_now", "spam"] as const;

export type LeadDismissReason = (typeof LEAD_DISMISS_REASONS)[number];

export const leadRows = sqliteTable(
  "lead_rows",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    pageId: text("page_id").notNull(), // normalised, 32 hex
    name: text("name").notNull(),
    email: text("email"), // the reply address: the email typed on the form, else the Leads Email; null: none (phone, Telegram)
    accountEmail: text("account_email"), // the Leads `Email` (the site account)
    brand: text("brand"),
    receivedAt: text("received_at").notNull().default(""),
    preview: text("preview").notNull().default(""),
    // P138 E1 (migration 0039): four short facts of the form for the list row (decision 0013 widened by these, 60 characters each).
    site: text("site"),
    country: text("country"),
    segment: text("segment"),
    volume: text("volume"),
    // P147 E4 (migration 0048): the phone or messenger number, digits only; rows sharing it (or an email) are one person.
    phone: text("phone"),
    notionStatus: text("notion_status"), // as last read; null: the Status cell is empty (handled as New)
    hasClient: integer("has_client", { mode: "boolean" }).notNull().default(false),
    dismissedAt: text("dismissed_at"),
    dismissedReason: text("dismissed_reason").$type<LeadDismissReason>(),
    convertedAt: text("converted_at"),
    clientPageId: text("client_page_id"),
    convertNote: text("convert_note"),
    readAt: text("read_at").notNull(),
    storedAt: text("stored_at").notNull(),
    // P147 (decision 0055, migration 0047): the daily lead pass's decision on this request (verdict 2), the agent's notes. The
    // draft it wrote (`pass_draft_id`, stamped by the record of that draft), the client it matched by the exact reply address
    // (`pass_client_id`, D3: the send converts onto that card), and the owner's untick in the review (`pass_excluded_at`, D7).
    passDecision: text("pass_decision").$type<LeadPassDecision>(),
    passReason: text("pass_reason"),
    passAt: text("pass_at"),
    passId: integer("pass_id").references((): AnySQLiteColumn => leadPasses.id, { onDelete: "set null" }),
    passDraftId: integer("pass_draft_id").references((): AnySQLiteColumn => drafts.id, { onDelete: "set null" }),
    passClientId: integer("pass_client_id").references((): AnySQLiteColumn => clients.id, { onDelete: "set null" }),
    passExcludedAt: text("pass_excluded_at"),
  },
  (t) => [uniqueIndex("lead_rows_project_page").on(t.project, t.pageId), index("lead_rows_project_email").on(t.project, t.email), index("lead_rows_project_pass").on(t.project, t.passDecision)],
);

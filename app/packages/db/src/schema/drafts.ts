import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { BatchStatus, DraftStatus, NotionKind } from "@hub/config";
import { clients } from "./clients";
import { agentRuns } from "./agent";
import { enrollments } from "./mail";

// Drafts. A client has at most one *open* draft (ready or hold); finished ones (done, skipped, sent) stay as history,
// and the newest draft of a client is the one the Clients list shows. `batchId` ties a draft to a bulk batch (P9).
// `prevStatus`/`prevChecked`/`actedAt` are the one-step undo: the state before the last human action.
// Nothing in the app writes `sent` (see SETTABLE_STATUSES in @hub/config).
export const drafts = sqliteTable(
  "drafts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    runId: integer("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    batchId: integer("batch_id").references(() => batches.id, { onDelete: "set null" }),
    subject: text("subject").notNull(),
    toAddr: text("to_addr").notNull(),
    ccAddr: text("cc_addr"), // comma separated
    body: text("body").notNull(), // the shown tone
    tone: text("tone").notNull().default("standard"),
    tones: text("tones"), // JSON {short?, standard?, warm?}: bodies of the tones that exist
    reason: text("reason"), // "Why this email", two sentences
    mailRef: text("mail_ref"), // Message-ID of the thread, or of the draft the agent made in Mail
    notionUrl: text("notion_url"), // the client's Notion profile, set by the draft record (`draft_write`)
    notionKind: text("notion_kind").$type<NotionKind>(), // client | lead | none; null = never reported (a row from before P26)
    notionPageId: text("notion_page_id"), // the page id the link is built from when `notionUrl` is empty
    // The context block of the draft record (`draft_write`): what the agent says the draft was based on, shown on the card, never
    // judged (P140 K2). JSON, no body text beyond 120-char excerpts of the INCOMING thread (decision 0013). Null on a batch draft.
    context: text("context"),
    findings: text("findings"), // JSON [{code, text, amber}]: the record's checks (P60 fact-other-brand)
    batchKey: text("batch_key"), // one per triage or bulk run
    safety: text("safety"), // the agent's one-line "check before sending"
    acked: text("acked").notNull().default("[]"), // JSON: safety kinds the person acknowledged
    // Set by the draft record (`draft_write`): the mail the draft answers carried a prompt-injection hint, so the hub never sends it.
    injectionSuspected: integer("injection_suspected", { mode: "boolean" }).notNull().default(false),
    // Mail class of the kind (`hub/<class>`), set by the draft record (`draft_write`); autosend sends only the classes a project lists.
    mailClass: text("mail_class"),
    skipReason: text("skip_reason"), // why the person skipped it ("not interested", "wrong person"); set only with status skipped
    status: text("status").$type<DraftStatus>().notNull().default("ready"),
    checked: integer("checked", { mode: "boolean" }).notNull().default(false),
    // Hash of the Mail draft the person had read when they ticked Checked (P27 M2.4): Send refuses when Mail no longer matches.
    checkedHash: text("checked_hash"),
    prevStatus: text("prev_status").$type<DraftStatus>(),
    prevChecked: integer("prev_checked", { mode: "boolean" }),
    actedAt: text("acted_at"),
    // Written only by `drafts.markSent`, i.e. by a mail reader that saw the message in the Sent folder.
    sentAt: text("sent_at"), // the sent message's own date
    // P58/P60: the project's address the client wrote to (`resolveBrand` step 1) and its `## Brands` row, from the
    // writer's header read at `draft_write`. Null: not resolved (no table, no header, or a draft written before 0020).
    wroteTo: text("wrote_to"),
    brand: text("brand"),
    // `message-id` (Sent detection: one of the draft's own `mail_versions`, P90) or `hub` (the send door). Rows from before
    // P90 may say `thread` or `subject-recipient`: history, no longer written.
    sentVia: text("sent_via"),
    sentMessageId: text("sent_message_id"),
    // P90: the newest Sent message of the project's accounts that answers this draft's `mailRef` and is not the Hub's (a
    // teammate in a shared mailbox, or the owner from another device). Informational: it never marks, moves or edits.
    elsewhereAt: text("elsewhere_at"),
    elsewhereFrom: text("elsewhere_from"),
    elsewhereMessageId: text("elsewhere_message_id"),
    // A step of a follow-up sequence (P47): the enrollment it belongs to and which step it is. `@hub/send` never sends such a draft.
    enrollmentId: integer("enrollment_id").references((): AnySQLiteColumn => enrollments.id, { onDelete: "set null" }),
    sequenceStep: integer("sequence_step"),
    createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [
    uniqueIndex("drafts_client_open").on(t.clientId).where(sql`${t.status} in ('ready','hold')`),
    index("drafts_client").on(t.clientId),
    index("drafts_project_status").on(t.project, t.status),
    index("drafts_batch").on(t.batchId),
  ],
);

// The Mail versions the Hub wrote (P65, decision 0031): one row per draft the writer saved in Mail (the agent's
// `draft_write`, a person's Save, a Restore; `migration` rows are the one-time rewrite of the marked drafts, P65 S3,
// whose command S4 deleted). Mail's text is never kept (decision
// 0013): `hash` is the sha256 of the text Mail returned after the save. A Mail draft is the Hub's to move to Trash only
// when its account and `message id` match a row here. `draftId` is null between `draft_write` of a new reply and its
// the draft record (`draft_write`), which links the rows of its `mailRef` (bare, lowercased). `signatureFallback`: the language the
// project had no sign-off or signature line for, so the writer signed in English (P65 S2, the amber check).
export const mailVersions = sqliteTable(
  "mail_versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    mailRef: text("mail_ref").notNull(),
    draftId: integer("draft_id").references((): AnySQLiteColumn => drafts.id, { onDelete: "set null" }),
    account: text("account").notNull(),
    mailId: integer("mail_id").notNull(),
    messageId: text("message_id").notNull(),
    hash: text("hash").notNull(),
    // `adopted` (P65 S5, 0031 addendum): a late save of the Hub's own write, recognised by its text's hash and recorded after the fact.
    source: text("source").$type<"agent" | "save" | "restore" | "migration" | "adopted">().notNull(),
    signatureFallback: text("signature_fallback"),
    // P140 R3: the brand and the address the client wrote to that the signer resolved for this version; the record of an
    // adopted version takes them from here, never from another write. Null on a version written before 0043 or unsigned.
    brand: text("brand"),
    wroteTo: text("wrote_to"),
    writtenAt: text("written_at").notNull(),
    trashedAt: text("trashed_at"),
  },
  (t) => [index("mail_versions_project_ref").on(t.project, t.mailRef), index("mail_versions_draft").on(t.draftId)],
);

// The Mail writes the Hub started (P65 S5, decision 0031 addendum): one row before every save, so a draft Mail saves after
// the writer stopped waiting is still known as the Hub's. Never the text (0013): the hash and length of the written text
// with whitespace collapsed (`textKey`), and the hash of Mail's reply shell when the writer saw it. `settled_at`: the save
// was found (or adopted later); an open row is what a late draft is matched against.
export const mailWrites = sqliteTable(
  "mail_writes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    mailRef: text("mail_ref").notNull(),
    draftId: integer("draft_id").references((): AnySQLiteColumn => drafts.id, { onDelete: "set null" }),
    textHash: text("text_hash").notNull(),
    textLen: integer("text_len").notNull(),
    shellHash: text("shell_hash"),
    startedAt: text("started_at").notNull(),
    settledAt: text("settled_at"),
    mailId: integer("mail_id"),
    messageId: text("message_id"),
  },
  (t) => [index("mail_writes_project_ref").on(t.project, t.mailRef)],
);

export const batches = sqliteTable(
  "batches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    name: text("name").notNull(),
    intent: text("intent").notNull(), // follow_up | notice | custom
    status: text("status").$type<BatchStatus>().notNull().default("ready"),
    audience: text("audience").notNull(), // the chip the person started from
    silentDays: integer("silent_days"),
    clientIds: text("client_ids").notNull().default("[]"), // JSON: the eligible clients this batch is for
    total: integer("total").notNull().default(0),
    excluded: text("excluded").notNull().default("{}"), // JSON {reason: count}
    brief: text("brief"), // the owner's purpose and tone: what the agent is asked to write (null on a batch made before 2026-11-15)
    runId: integer("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    closedAt: text("closed_at"),
  },
  (t) => [index("batches_project_created").on(t.project, t.createdAt)],
);

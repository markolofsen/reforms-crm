import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type { ReplyMode, TriageVerdict } from "@hub/config/chat-rules";
import type { LlmOutcome } from "@hub/config/llm";
import type { AdvisorModel, AgentModel, BatchStatus, DraftStatus, EnrollmentState, EventKind, EvidenceLevel, EvidenceSource, FinishReason, InboxAction, InboxKind, Mark, NotionKind, RunStatus, SafetyKind, SafetyLevel } from "@hub/config";

// Every table carries `project`: one database serves several projects (owner decision).
// Timestamps are ISO-8601 UTC text.

// A client row exists only because the agent made a draft for that client (decision 0009): Notion holds the record,
// this table holds the key the local state (marks, drafts, log) hangs on. Never delete a row: marks cascade.
export const clients = sqliteTable(
  "clients",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    repliesOwed: integer("replies_owed", { mode: "boolean" }).notNull().default(false),
    lastContactAt: text("last_contact_at"),
    // P90: the client's Notion stamp (`Last sent at` / `Last sent by`, P89) as Sent detection last read it, when another
    // person wrote it (never this Mac's own name). The open card says so when it is newer than the client's last message.
    teamSentAt: text("team_sent_at"),
    teamSentBy: text("team_sent_by"),
    createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    // Last time the agent (or a test) refreshed this row: repliesOwed and lastContactAt are "as of" this moment.
    // The migration gives existing rows a constant default; every insert fills it in code.
    updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()),
  },
  (t) => [uniqueIndex("clients_project_email").on(t.project, t.email)],
);

export const marks = sqliteTable(
  "marks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    mark: text("mark").$type<Mark>().notNull(),
    createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [uniqueIndex("marks_client_mark").on(t.clientId, t.mark), index("marks_project").on(t.project)],
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    trigger: text("trigger").notNull(), // schedule | owner | skill name
    skill: text("skill"),
    model: text("model"),
    status: text("status").$type<RunStatus>().notNull().default("ok"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    // The session's `batchKey` (P48 W5): every `hub record-draft` / `record-client` of one session joins this run.
    batchKey: text("batch_key"),
  },
  (t) => [index("agent_runs_project_started").on(t.project, t.startedAt), index("agent_runs_project_batch_key").on(t.project, t.batchKey)],
);

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
    notionUrl: text("notion_url"), // the client's Notion profile, set by `hub record-draft`
    notionKind: text("notion_kind").$type<NotionKind>(), // client | lead | none; null = never reported (a row from before P26)
    notionPageId: text("notion_page_id"), // the page id the link is built from when `notionUrl` is empty
    // The evidence block of `hub record-draft` (P28): what the draft was based on. JSON, no body text beyond 120-char
    // excerpts of the INCOMING thread (decision 0013). Null on a draft recorded before it, and on a batch draft.
    context: text("context"),
    evidence: text("evidence").$type<EvidenceLevel>(),
    evidenceSource: text("evidence_source").$type<EvidenceSource>(),
    evidenceFindings: text("evidence_findings"), // JSON [{code, text, amber}]
    similarTo: text("similar_to"), // the closest other draft of the batch, by address, when the sketches say so
    fingerprint: text("fingerprint"), // JSON ints: the sketch of the reply. A hash set, never the text
    batchKey: text("batch_key"), // one per triage or bulk run: the set similarity is judged against
    safety: text("safety"), // the agent's one-line "check before sending"
    acked: text("acked").notNull().default("[]"), // JSON: safety kinds the person acknowledged
    // Set by `hub record-draft`: the mail the draft answers carried a prompt-injection hint, so the hub never sends it.
    injectionSuspected: integer("injection_suspected", { mode: "boolean" }).notNull().default(false),
    // Mail class of the kind (`hub/<class>`), set by `hub record-draft`; autosend sends only the classes a project lists.
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
// `hub record-draft`, which links the rows of its `mailRef` (bare, lowercased). `signatureFallback`: the language the
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
    storedAt: text("stored_at").notNull(),
  },
  (t) => [uniqueIndex("inbound_mail_project_message").on(t.project, t.messageId), index("inbound_mail_project_email").on(t.project, t.email, t.receivedAt)],
);

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
  },
  (t) => [
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

export const agentEvents = sqliteTable(
  "agent_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    runId: integer("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    at: text("at").notNull(),
    kind: text("kind").$type<EventKind>().notNull(),
    tool: text("tool"),
    summary: text("summary").notNull(), // one line, shown; never a mail body
    detail: text("detail"), // JSON, collapsed in the UI; message ids, not bodies
    clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("agent_events_run_seq").on(t.runId, t.seq), index("agent_events_project").on(t.project)],
);

// ---- Projects and knowledge (P7, doc 16). The files under <instance>/projects/<slug>/ are the source of truth; these
// tables are an index rebuilt from them (`pnpm hub project sync`, `knowledge index`). Nothing edits them by hand.

export const projects = sqliteTable("projects", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"), // draft | active | paused | archived
  kind: text("kind").notNull().default("generic"), // a key of the kind registry (@hub/projects kinds.ts), derived from project.md
  archived: integer("archived", { mode: "boolean" }).notNull().default(false), // status = archived, kept as a column to filter on
  settingsJson: text("settings_json").notNull(),
  hash: text("hash").notNull(), // sha256 of project.md
  syncedAt: text("synced_at").notNull(),
});

// One row per address or Mail account a project claims. An *address* is claimed by one project (unique index
// below: a duplicate is a hard error at sync, not a coin flip at run time). An *account* may be shared by several
// projects that receive through aliases, so accounts are not unique.
export const projectAddresses = sqliteTable(
  "project_addresses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    address: text("address").notNull(), // lower-case, +tag stripped
    project: text("project").notNull(),
    kind: text("kind").$type<"account" | "address" | "domain">().notNull(), // domain: a `mail.domains` entry (P60), one project each
  },
  (t) => [
    uniqueIndex("project_addresses_address").on(t.address).where(sql`${t.kind} = 'address'`),
    uniqueIndex("project_addresses_domain").on(t.address).where(sql`${t.kind} = 'domain'`),
    uniqueIndex("project_addresses_claim").on(t.project, t.address, t.kind),
  ],
);

// At most one open question per project (partial unique index): the owner is asked one thing at a time.
export const projectQuestions = sqliteTable(
  "project_questions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    field: text("field").notNull(),
    question: text("question").notNull(),
    optionsJson: text("options_json"),
    defaultValue: text("default_value"),
    status: text("status").$type<"open" | "answered">().notNull().default("open"),
    askedAt: text("asked_at").notNull(),
    answeredAt: text("answered_at"),
    answer: text("answer"),
  },
  (t) => [
    uniqueIndex("project_questions_one_open").on(t.project).where(sql`${t.status} = 'open'`),
    index("project_questions_project").on(t.project, t.status),
  ],
);

// The knowledge index. `knowledge_fts` (FTS5, external content over this table) is created by a hand-written
// migration with its triggers: drizzle cannot model virtual tables.
export const knowledgeDocs = sqliteTable(
  "knowledge_docs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    path: text("path").notNull(), // relative to the project folder
    title: text("title").notNull(),
    use: text("use").$type<"STATE" | "MARKER">().notNull().default("STATE"),
    approved: integer("approved", { mode: "boolean" }).notNull().default(true),
    audiences: text("audiences").notNull().default("[]"), // JSON array
    brands: text("brands").notNull().default("[]"), // JSON array of `## Brands` names or ANY (P60); read only in a knowledge.scope by-brand project
    category: text("category"),
    kind: text("kind"),
    validUntil: text("valid_until"),
    body: text("body").notNull().default(""),
    phrasings: text("phrasings").notNull().default(""),
    frontMatter: text("front_matter").notNull().default("{}"), // JSON, as read from the file
    contentHash: text("content_hash").notNull(),
    updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [uniqueIndex("knowledge_docs_project_path").on(t.project, t.path)],
);

// ---- Messengers (P8). Messages are stored locally because the Bot API has no history call. Text is kept
// in full (the owner's own machine) and every row carries `retain_until` (90 days); a purge job deletes past it.

export type MessengerChannel = "telegram_bot" | "telegram_user" | "whatsapp";
export type MessengerDirection = "in" | "out";
export type MessengerDraftStatus = "draft" | "confirmed" | "sent" | "copied" | "discarded";
export type IdentifierKind = "email" | "telegram" | "phone" | "whatsapp";

// One polled account (one bot). `cursor` is the adapter's opaque position (Telegram: next update offset), written
// only after the batch it covers is stored. `last_*` feed `status` and the stale-poll warning.
export const messengerAccounts = sqliteTable(
  "messenger_accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    channel: text("channel").$type<MessengerChannel>().notNull(),
    account: text("account").notNull(), // bot id, never the token
    cursor: text("cursor"),
    lastOkAt: text("last_ok_at"),
    lastError: text("last_error"),
    lastErrorAt: text("last_error_at"),
    updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [uniqueIndex("messenger_accounts_key").on(t.project, t.channel, t.account)],
);

// The inbound allow-list: only chats the owner listed are stored. Everything else is dropped at ingest.
export const messengerChats = sqliteTable(
  "messenger_chats",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    channel: text("channel").$type<MessengerChannel>().notNull(),
    chatId: text("chat_id").notNull(),
    title: text("title"),
    createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    // The chat's rules (P71 M2b, migration 0025; bounds and defaults in `@hub/config/chat-rules`), set only by the owner.
    replyMode: text("reply_mode").$type<ReplyMode>().notNull().default("draft"),
    mayNudge: integer("may_nudge", { mode: "boolean" }).notNull().default(false),
    nudgeAfterDays: integer("nudge_after_days").notNull().default(3),
    instruction: text("instruction"),
    language: text("language"),
    prefilter: integer("prefilter", { mode: "boolean" }).notNull().default(false),
    rulesUpdatedAt: text("rules_updated_at"),
    // P84 (migration 0028): null when the owner linked the chat, else why the Hub's autolink did ("phone matches the client").
    autolinked: text("autolinked"),
  },
  (t) => [uniqueIndex("messenger_chats_key").on(t.project, t.channel, t.chatId)],
);

export const messengerMessages = sqliteTable(
  "messenger_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    channel: text("channel").$type<MessengerChannel>().notNull(),
    account: text("account").notNull(),
    chatId: text("chat_id").notNull(),
    remoteMessageId: text("remote_message_id").notNull(),
    direction: text("direction").$type<MessengerDirection>().notNull(),
    kind: text("kind").notNull().default("text"), // text | photo | voice | ... (media bytes are never stored)
    text: text("text").notNull().default(""),
    sentAt: text("sent_at").notNull(), // ISO-8601 UTC
    retainUntil: text("retain_until").notNull(),
    createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [
    uniqueIndex("messenger_messages_remote").on(t.project, t.channel, t.chatId, t.remoteMessageId),
    index("messenger_messages_chat").on(t.project, t.channel, t.chatId, t.sentAt),
    index("messenger_messages_retain").on(t.retainUntil),
  ],
);

// The pre-analysis' verdict on one inbound message (P71 M-P, migration 0029): a label and the model, deleted with its message.
export const messengerTriage = sqliteTable(
  "messenger_triage",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    messageId: integer("message_id")
      .notNull()
      .references(() => messengerMessages.id, { onDelete: "cascade" }),
    verdict: text("verdict").$type<TriageVerdict>().notNull(),
    model: text("model"),
    promptVersion: integer("prompt_version").notNull(),
    createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [uniqueIndex("messenger_triage_message").on(t.messageId), index("messenger_triage_project").on(t.project, t.verdict)],
);

// Links a client to a mail address, a chat or a number. Written only by the owner (never by ingest).
export const clientIdentifiers = sqliteTable(
  "client_identifiers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    clientId: integer("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    kind: text("kind").$type<IdentifierKind>().notNull(),
    value: text("value").notNull(), // normalised by @hub/messengers (lower-case e-mail, digits, +E.164)
    createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [
    uniqueIndex("client_identifiers_key").on(t.project, t.kind, t.value),
    index("client_identifiers_client").on(t.clientId),
  ],
);

// "Never link this chat" (P84): the HMAC of (project, channel, chat id), never the chat itself; the autolink skips a listed hash.
export const messengerLinkRefusals = sqliteTable(
  "messenger_link_refusals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    channel: text("channel").$type<MessengerChannel>().notNull(),
    hash: text("hash").notNull(),
    createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [uniqueIndex("messenger_link_refusals_key").on(t.project, t.channel, t.hash)],
);

// Outbound replies. An agent can only insert status `draft`; `confirmed` is written by the human path.
export const messengerDrafts = sqliteTable(
  "messenger_drafts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    channel: text("channel").$type<MessengerChannel>().notNull(),
    chatId: text("chat_id").notNull(),
    clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
    text: text("text").notNull(),
    status: text("status").$type<MessengerDraftStatus>().notNull().default("draft"),
    createdBy: text("created_by").notNull(), // agent run or "owner"
    confirmedBy: text("confirmed_by"),
    confirmedAt: text("confirmed_at"),
    sentAt: text("sent_at"),
    remoteMessageId: text("remote_message_id"),
    createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
    // What admitted an agent's draft (0025): the owner's words in an `on_request` chat; a follow-up after our own last message.
    ownerRequest: text("owner_request"),
    nudge: integer("nudge", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("messenger_drafts_project_status").on(t.project, t.status)],
);

// ---- Bulk send (P9, doc 14). A batch is one audience and one intent; its drafts are made by a template (the app) or
// by the agent. `agent_runs` / `agent_events` carry its action log. Nothing here sends mail.

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

// The owner's edits to the safety rules, per project. Absent row = the default in @hub/config.
export const safetyRules = sqliteTable(
  "safety_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    kind: text("kind").$type<SafetyKind>().notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    level: text("level").$type<SafetyLevel>().notNull(),
    params: text("params").notNull().default("{}"), // JSON {words?, days?}
    updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [uniqueIndex("safety_rules_key").on(t.project, t.kind)],
);

// The agent's model and its advisor per project (P55), set in Settings ▸ Agent; read by `hub agent` when it writes the Claude
// session's settings.json. Absent row = `DEFAULT_AGENT_SETTINGS` in @hub/config.
export const agentSettings = sqliteTable(
  "agent_settings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    model: text("model").$type<AgentModel>().notNull(),
    advisor: integer("advisor", { mode: "boolean" }).notNull().default(false),
    advisorModel: text("advisor_model").$type<AdvisorModel>().notNull(),
    updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [uniqueIndex("agent_settings_project").on(t.project)],
);

// P78 (decision 0039): one row per attempt of an LLM call made through `@hub/llm`, failed and refused attempts included, so the
// month's spend and the wasted share are sums over this table. Counts and money only: no prompt, no answer, no client text
// (the owner: "not junk"). Cost is OpenRouter's `usage.cost` as whole micro-dollars; a refusal (`budget`, `no_key`) costs 0.
export const llmCalls = sqliteTable(
  "llm_calls",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    task: text("task").notNull(),
    model: text("model"),
    attempt: integer("attempt").notNull(),
    outcome: text("outcome").$type<LlmOutcome>().notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    tokensCached: integer("tokens_cached").notNull().default(0),
    costMicroUsd: integer("cost_micro_usd").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    generationId: text("generation_id"),
    sourceKind: text("source_kind"),
    createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [index("llm_calls_created").on(t.createdAt), index("llm_calls_project_created").on(t.project, t.createdAt)],
);

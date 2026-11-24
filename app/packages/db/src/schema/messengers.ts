import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { ReplyMode, TriageVerdict } from "@hub/config/chat-rules";
import { clients } from "./clients";

export type MessengerChannel = "telegram_bot" | "telegram_user" | "whatsapp";

export type MessengerDirection = "in" | "out";

/** Where a cached message came from when it was not the receiver (decision 0049 point 5): the Mac's WhatsApp app. */
export type MessageSource = "wa_app";

export type MessengerDraftStatus = "draft" | "confirmed" | "sent" | "copied" | "discarded";

/** P141 C1: `telegram` is a Telegram user id, `telegram_username` its username (lower-case, no `@`), `phone` and `whatsapp` +E.164. */
export type IdentifierKind = "email" | "telegram" | "telegram_username" | "phone" | "whatsapp";

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

// The known chats (decision 0049 point 6, P141 U2): a private chat that wrote, and every chat the owner linked. A row is "known";
// the chat is "linked" when a `client_identifiers` row names it (`isLinked`). Ingest makes the row of a chat that wrote.
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
    instruction: text("instruction"),
    language: text("language"),
    prefilter: integer("prefilter", { mode: "boolean" }).notNull().default(false),
    rulesUpdatedAt: text("rules_updated_at"),
    // P84 (migration 0028): null when the owner linked the chat, else why the Hub's autolink did ("phone matches the client").
    autolinked: text("autolinked"),
    // P131 O5 (migration 0035): the chat's own Telegram username (no `@`) and phone (digits) as the account saw them when it was
    // linked or on a later dialog scan, so "Open in Telegram" works for a linked chat without the Notion card. Null when unknown.
    username: text("username"),
    phone: text("phone"),
    // Decision 0048, P139 A1 (migration 0041): the chat's autopilot pause. Set means paused, with a `PAUSING_REASONS` code; the
    // owner's switch clears it. The switches that turn autopilot on are protected files, never a column here.
    autopilotPausedAt: text("autopilot_paused_at"),
    autopilotPausedReason: text("autopilot_paused_reason"),
    // Decision 0049, P141 (migration 0042): "the person wrote" as a fact the server observed, which outlives the message cache: the
    // newest inbound message stored and the account that read the chat, written by ingest and on link, never pruned. `jid` is a
    // WhatsApp chat's real address (the `@lid` one when WhatsApp gives it), named by the history request and the send.
    jid: text("jid"),
    lastInboundAt: text("last_inbound_at"),
    account: text("account"),
    // P141 U3 (migration 0044): the name the person gave themselves (WhatsApp's push name, Telegram's display name), shown as theirs;
    // never written to Notion without the owner's click.
    profileName: text("profile_name"),
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
    // Decision 0049 point 5 (migration 0042): `wa_app` for a row only the Mac's WhatsApp app supplied, else null.
    source: text("source").$type<MessageSource>(),
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

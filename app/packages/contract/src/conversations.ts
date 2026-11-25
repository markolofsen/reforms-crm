import { z } from "zod";
import { reviewDraftDto } from "./review";
import { contactLinksDto } from "./local";
import { notionIdentityDto } from "./notion";

// P99 (one conversation per client): Mail lists people, not drafts. The list and its state words come from the Hub's own rows
// (drafts, the Mail reader's messages, sends); the history of one person is read from Mail when the conversation opens and never
// stored (decision 0013), and each body is fetched separately as the conversation renders.

/** The state word of a row (verdict 2): Wrote you, Draft ready, On hold, Waiting for them, Done. */
export const CONVERSATION_STATES = ["wrote", "draft", "hold", "waiting", "done"] as const;
export type ConversationState = (typeof CONVERSATION_STATES)[number];
export const CONVERSATION_STATE_LABELS: Readonly<Record<ConversationState, string>> = { wrote: "Wrote you", draft: "Draft ready", hold: "On hold", waiting: "Waiting for them", done: "Done" };

/** The server's views (verdict 3): Needs you, Waiting, All, and Follow-ups as a filter of All. */
export const CONVERSATION_VIEWS = ["needs_you", "waiting", "all", "sequences"] as const;
export type ConversationViewDto = (typeof CONVERSATION_VIEWS)[number];

export const conversationsQuery = z.object({
  project: z.string().min(1).max(100),
  view: z.enum(CONVERSATION_VIEWS).default("needs_you"),
  search: z.string().trim().max(200).default(""),
  batch: z.coerce.number().int().positive().optional(),
  /** P134 verdict 4: only the people with a draft of this brand (the counts of the views are never narrowed by it). */
  brand: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const conversationRowDto = z.strictObject({
  client: z.strictObject({ id: z.number().int(), name: z.string(), email: z.string() }),
  notion: notionIdentityDto,
  state: z.enum(CONVERSATION_STATES),
  at: z.string(),
  subject: z.string(),
  preview: z.string(),
  brands: z.array(z.string()),
  /** Their newest open message (Prepare reply and No reply needed act on it). */
  inboundId: z.number().int().nullable(),
  /** The open draft, the unsent message at the bottom of the conversation; at most one. */
  draft: reviewDraftDto.nullable(),
  theirLastAt: z.string().nullable(),
  ourLastAt: z.string().nullable(),
  /** P131 O5: the client's Telegram and WhatsApp from their Notion card, for Open in Telegram / Open in WhatsApp. */
  contact: contactLinksDto,
  /** P128 X2: the agent's judgement of a Wrote you person with no draft (it escalated or skipped their mail), in its words; else null. */
  agent: z.strictObject({ action: z.enum(["escalated", "skipped"]), reason: z.string().nullable(), at: z.string() }).nullable(),
  /** P147 3n N6: the mail pass judged their open message phishing or junk (its reason, "" without one); Spam is then the primary. */
  junk: z.string().nullable().default(null),
});
export type ConversationRowDto = z.infer<typeof conversationRowDto>;

export const conversationsDto = z.strictObject({
  rows: z.array(conversationRowDto),
  total: z.number().int(),
  nextOffset: z.number().int().nullable(),
  counts: z.strictObject({ needs_you: z.number().int(), waiting: z.number().int(), all: z.number().int(), sequences: z.number().int() }),
  /** P134 verdict 4: the brands of the view's people (no search, no brand applied) with how many people each, most first; the filter shows them only with two or more. */
  brands: z.array(z.strictObject({ name: z.string(), count: z.number().int() })),
});
export type ConversationsDto = z.infer<typeof conversationsDto>;

/** One message of the history, its header and preview (the body is fetched through `conversationTextDto`). */
export const conversationMessageDto = z.strictObject({
  messageId: z.string(),
  ours: z.boolean(),
  fromName: z.string(),
  fromEmail: z.string(),
  date: z.string(),
  subject: z.string(),
  /** The Hub's draft this message is (one of ours) or answers, when it knows one. */
  draftId: z.number().int().nullable(),
  /** Their stored 120 characters, when the Mail reader kept the message; else empty. */
  preview: z.string(),
});
export type ConversationMessageDto = z.infer<typeof conversationMessageDto>;

/** A thread of the history: References first, else the subject without Re: and Fwd:. The divider names its subject and our brand and From there. */
export const conversationThreadDto = z.strictObject({
  key: z.string(),
  subject: z.string(),
  brand: z.string().nullable(),
  ourFrom: z.string().nullable(),
  messages: z.array(conversationMessageDto),
});
export type ConversationThreadDto = z.infer<typeof conversationThreadDto>;

/**
 * The history of one person, threads by the mail headers, newest activity last (P140), oldest message first in each. `source`: `mail` (read from Mail now, `ms`
 * long), or `hub` (Mail could not be read: the Hub's own rows, the reason in `note`). `earlier`: older messages left out (the last
 * `CONVERSATION_MAX` show).
 */
export const conversationMailDto = z.strictObject({
  source: z.enum(["mail", "hub"]),
  note: z.string().nullable(),
  ms: z.number().int().nullable(),
  threads: z.array(conversationThreadDto),
  earlier: z.number().int(),
});
export type ConversationMailDto = z.infer<typeof conversationMailDto>;
export const CONVERSATION_MAX = 30;

export const mailComposerBrandDto = z.strictObject({
  name: z.string(),
  wroteTo: z.string().nullable(),
  from: z.string().nullable(),
  technicalAddress: z.string().nullable(),
  signatureLines: z.array(z.string()),
  signatureFallback: z.enum(["en", "ru"]).nullable(),
  signatureLinesByLanguage: z.strictObject({ en: z.array(z.string()), ru: z.array(z.string()) }),
  signatureFallbackByLanguage: z.strictObject({ en: z.enum(["en", "ru"]).nullable(), ru: z.enum(["en", "ru"]).nullable() }),
  status: z.enum(["ready", "missing_signature"]),
});
export type MailComposerBrandDto = z.infer<typeof mailComposerBrandDto>;

export const mailComposerContextDto = z.strictObject({
  brand: z.string().nullable(),
  wroteTo: z.string().nullable(),
  from: z.string().nullable(),
  technicalAddress: z.string().nullable(),
  language: z.enum(["en", "ru"]),
  signatureLines: z.array(z.string()),
  signatureFallback: z.enum(["en", "ru"]).nullable(),
  signatureLinesByLanguage: z.strictObject({ en: z.array(z.string()), ru: z.array(z.string()) }),
  signatureFallbackByLanguage: z.strictObject({ en: z.enum(["en", "ru"]).nullable(), ru: z.enum(["en", "ru"]).nullable() }),
  status: z.enum(["resolved", "needs_brand", "needs_mail", "missing_signature"]),
  reason: z.string().nullable(),
  brands: z.array(mailComposerBrandDto),
});
export type MailComposerContextDto = z.infer<typeof mailComposerContextDto>;

/** The pane's header and its unsent message, from SQLite only (a live topic refreshes it without a Mail read). */
export const conversationDto = z.strictObject({
  row: conversationRowDto,
  composer: mailComposerContextDto,
});
export type ConversationDto = z.infer<typeof conversationDto>;

/** One message's own words, read from Mail now (quoted history is represented by its own messages), or why it cannot show. */
export const conversationTextDto = z.strictObject({ text: z.string().nullable(), quoted: z.boolean(), note: z.string().nullable() });
export type ConversationTextDto = z.infer<typeof conversationTextDto>;
export const conversationTextQuery = z.object({ m: z.string().min(3).max(998) });

/**
 * P140 R5: Refresh in the conversation header. One Mail reader pass and one Sent reconciler pass ran, this person's Mail locations
 * and bodies left the server's memory, and their linked WhatsApp chats were refilled from the Mac's WhatsApp app (a Telegram chat
 * has no catch-up of its own: new messages arrive live). `mailRead`: the reader read every mailbox without an error. `stored`: the
 * chat messages the refill added. The admin then re-reads Mail, the Inbox, the sends, the drafts and the chats.
 */
export const conversationRefreshedDto = z.strictObject({ ok: z.literal(true), ms: z.number().int().nonnegative(), mailRead: z.boolean(), chats: z.number().int().nonnegative(), stored: z.number().int().nonnegative() });
export type ConversationRefreshedDto = z.infer<typeof conversationRefreshedDto>;
export const conversationsListQuery = conversationsQuery.omit({ project: true });

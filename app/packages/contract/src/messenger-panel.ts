import { CHAT_INSTRUCTION_MAX, MESSENGER_TEXT_MAX, NUDGE_DAYS_MAX, NUDGE_DAYS_MIN, REPLY_MODES } from "@hub/config/chat-rules";
import { z } from "zod";

/**
 * The Messengers section (P71 M3, decision 0036 point 6): the panel's linked chats with what is owed and the agent's open draft of
 * each, and the rules the owner sets per chat. It reads only `messenger_drafts` and `messenger_chats` (with their stored messages
 * and the client a chat is linked to); Mail drafts never appear here. Every reply is a `strictObject`.
 */

export const MESSENGER_CHANNELS = ["telegram_bot", "telegram_user", "whatsapp"] as const;
export type MessengerChannelDto = (typeof MESSENGER_CHANNELS)[number];

/**
 * The panel's View menu: `waiting`, the chats with an open draft or whose newest stored message is the client's (what the
 * messengers owe), and `all`, every linked chat. The default is `waiting`, so a bare `/messengers` shows what needs the owner.
 */
export const MESSENGER_VIEWS = ["waiting", "all"] as const;
export type MessengerView = (typeof MESSENGER_VIEWS)[number];

export const chatRulesDto = z.strictObject({
  replyMode: z.enum(REPLY_MODES),
  mayNudge: z.boolean(),
  nudgeAfterDays: z.number().int(),
  instruction: z.string().nullable(),
  language: z.string().nullable(),
  prefilter: z.boolean(),
});
export type ChatRulesDto = z.infer<typeof chatRulesDto>;

/** One open draft of the agent (status `draft`): the text the owner reads, edits or skips. */
export const messengerDraftDto = z.strictObject({
  id: z.number().int(),
  text: z.string(),
  /** A follow-up after our own last message (the chat's `may_nudge`). */
  nudge: z.boolean(),
  /** The owner's words that admitted it in an `on_request` chat, else null. */
  ownerRequest: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MessengerDraftDto = z.infer<typeof messengerDraftDto>;

/** The newest stored message of the chat, either side: what the owner reads before the draft (a non-text one is its kind). */
export const chatMessageDto = z.strictObject({ direction: z.enum(["in", "out"]), kind: z.string(), text: z.string(), at: z.string() });

export const messengerChatDto = z.strictObject({
  /** `messenger_chats.id`: the `chat:<id>` ref. */
  id: z.number().int(),
  channel: z.enum(MESSENGER_CHANNELS),
  chatId: z.string(),
  title: z.string().nullable(),
  /** The client the chat is linked to (by `client_identifiers`), else null. */
  client: z.strictObject({ id: z.number().int(), name: z.string(), email: z.string() }).nullable(),
  rules: chatRulesDto,
  inbound: z.number().int(),
  last: chatMessageDto.nullable(),
  /** The newest stored message is the client's: a reply is owed. */
  owed: z.boolean(),
  draft: messengerDraftDto.nullable(),
  /** P84: why the Hub linked the chat by itself ("phone matches the client"), or null when the owner linked it. */
  autolinked: z.string().nullable(),
});
export type MessengerChatDto = z.infer<typeof messengerChatDto>;

export const messengerChatsDto = z.strictObject({
  chats: z.array(messengerChatDto),
  /** The View menu's counts, over every linked chat of the project. */
  counts: z.strictObject({ waiting: z.number().int(), all: z.number().int() }),
});
export type MessengerChatsDto = z.infer<typeof messengerChatsDto>;

/** Skip: the draft is set aside (status `discarded`); its Undo is the restore route. */
export const messengerSkippedDto = z.strictObject({ ok: z.literal(true), id: z.number().int() });

/** Edit: the owner's own words for a draft that still waits (Telegram's message limit). */
export const messengerDraftTextBody = z.strictObject({ text: z.string().trim().min(1, "the text is empty").max(MESSENGER_TEXT_MAX) });

/** A change of one chat's rules: only the fields he changed. Bounds as in `@hub/config/chat-rules`; the server checks them again. */
export const chatRulesBody = z
  .strictObject({
    replyMode: z.enum(REPLY_MODES).optional(),
    mayNudge: z.boolean().optional(),
    nudgeAfterDays: z.number().int().min(NUDGE_DAYS_MIN).max(NUDGE_DAYS_MAX).optional(),
    instruction: z.string().max(CHAT_INSTRUCTION_MAX).nullable().optional(),
    language: z.string().trim().max(35).nullable().optional(),
    prefilter: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "no rule given");
export type ChatRulesBody = z.infer<typeof chatRulesBody>;

/** A client the owner can link a chat to: found by name or address (at least two characters), never a list of every client. */
export const clientMatchDto = z.strictObject({ id: z.number().int(), name: z.string(), email: z.string() });
export const clientMatchesDto = z.strictObject({ clients: z.array(clientMatchDto) });
export type ClientMatchDto = z.infer<typeof clientMatchDto>;

/**
 * The send door for one messenger draft (P71 M4, decision 0036 point 7), `POST /api/projects/:slug/messengers/drafts/:id/send`.
 * The dry run sends nothing and answers exactly what would go out: the chat, the account it goes from, who it is and the text. The
 * apply carries the chat and the text the person saw and a single-use ticket (`POST /api/sends/tickets` with `kind: "messenger"`);
 * the server refuses it when the draft's text changed since. Refusals are the 409 `wrong_state` reply with `refused`, in words.
 */
export const messengerSendPreviewDto = z.strictObject({
  ok: z.literal(true),
  dryRun: z.literal(true),
  channel: z.enum(MESSENGER_CHANNELS),
  chatId: z.string(),
  /** The account it goes from (its id, never a secret). */
  account: z.string(),
  /** Who it goes to: the linked client, else the chat's title. */
  to: z.string(),
  text: z.string(),
});
export type MessengerSendPreviewDto = z.infer<typeof messengerSendPreviewDto>;

export const messengerSendBody = z.discriminatedUnion("apply", [
  z.strictObject({ apply: z.literal(false) }),
  // Not trimmed: the text must equal the draft's, character for character. `ticket` optional so a missing one is the route's 403.
  z.strictObject({ apply: z.literal(true), confirm: z.strictObject({ chatId: z.string().min(1).max(64), text: z.string().min(1).max(MESSENGER_TEXT_MAX) }), ticket: z.string().min(1).max(200).optional() }),
]);
export type MessengerSendBody = z.infer<typeof messengerSendBody>;

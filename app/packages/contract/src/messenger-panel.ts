import { CHAT_INSTRUCTION_MAX, HIDDEN_LABELS, MESSENGER_TEXT_MAX, NUDGE_DAYS_MAX, NUDGE_DAYS_MIN, REPLY_MODES } from "@hub/config/chat-rules";
import { z } from "zod";
import { notionIdentityDto, type NotionIdentityDto } from "./notion";
import { MESSENGER_CHANNELS, type MessengerChannelDto } from "./messenger";
export { MESSENGER_CHANNELS, messengerSendBody, messengerSendPreviewDto } from "./messenger";
export type { MessengerChannelDto, MessengerSendBody, MessengerSendPreviewDto } from "./messenger";

/**
 * The Messengers section (P71 M3, decision 0036 point 6): the panel's linked chats with what is owed and the agent's open draft of
 * each, and the rules the owner sets per chat. It reads only `messenger_drafts` and `messenger_chats` (with their stored messages
 * and the client a chat is linked to); Mail drafts never appear here. Every reply is a `strictObject`.
 */

/**
 * The panel's View menu (P84c, owner 2026-11-20): `todo`, the linked chats with an open draft or whose newest stored message is the
 * client's (what the messengers owe), plus, on the admin, the fresh unlinked chats nobody decided on yet; `linked`, every linked
 * chat; `unlinked` (P102), every unlinked chat the autolink's memory holds, of any age; `hidden`, the chats the owner said are not
 * clients (never linked, so the server's list is empty on both and the admin reads the autolink's memory). The default is `todo`, so a bare `/messengers` shows what needs the owner.
 */
export const MESSENGER_VIEWS = ["todo", "linked", "unlinked", "hidden"] as const;
export type MessengerView = (typeof MESSENGER_VIEWS)[number];

/** P84c: the channel as a filter of the same page (`?channel=`), not a page per channel: the job is the same on both. */
export const MESSENGER_CHANNEL_FILTERS = ["all", "telegram", "whatsapp"] as const;
export type MessengerChannelFilter = (typeof MESSENGER_CHANNEL_FILTERS)[number];
/** A chat's channel under a filter: the Telegram bot's chats are Telegram's. */
export const inChannel = (channel: MessengerChannelDto, f: MessengerChannelFilter): boolean => f === "all" || (f === "whatsapp" ? channel === "whatsapp" : channel !== "whatsapp");

/** The list projection's URL inputs. Defaults keep a bare `/messengers` request on the owner's Todo view. */
export const messengerChatsQuery = z.object({
  filter: z.enum(MESSENGER_VIEWS).default("todo"),
  channel: z.enum(MESSENGER_CHANNEL_FILTERS).default("all"),
  q: z.string().trim().max(200).default(""),
});
export type MessengerChatsQuery = z.infer<typeof messengerChatsQuery>;

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
  createdBy: z.string(),
  /** A follow-up after our own last message (the chat's `may_nudge`). */
  nudge: z.boolean(),
  /** The owner's words that admitted it in an `on_request` chat, else null. */
  ownerRequest: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MessengerDraftDto = z.infer<typeof messengerDraftDto>;

/** The newest stored message of the chat, either side: what the owner reads before the draft (a non-text one is its kind). */
export const chatMessageDto = z.strictObject({
  direction: z.enum(["in", "out"]),
  kind: z.string(),
  text: z.string(),
  at: z.string(),
  /** P71 M-P: the pre-analysis hid it from the agent, and why; null when it reaches the agent (unjudged included). */
  hidden: z.enum(HIDDEN_LABELS).nullable(),
});

/** P71 M-P: one chat's pre-analysis verdicts by reason, over its stored messages (all zero while the switch was never on). */
export const chatTriageDto = z.strictObject({
  judged: z.number().int(),
  hidden: z.strictObject(Object.fromEntries(HIDDEN_LABELS.map((l) => [l, z.number().int()])) as Record<(typeof HIDDEN_LABELS)[number], z.ZodNumber>),
  /** Asked twice and never answered usably: it reaches the agent unlabelled (fail open). */
  unjudged: z.number().int(),
});
export type ChatTriageDto = z.infer<typeof chatTriageDto>;

/**
 * P71 M-P: whether the pre-analysis can run on this instance. `no_key`: no OpenRouter key, so nothing runs and `fix` says where the
 * key goes; `fake`: `HUB_LLM=fake`, nothing leaves the process; `ready`: a key is there (the monthly cap of P78 still applies).
 */
export const PREANALYSIS_STATES = ["ready", "fake", "no_key"] as const;
export const preanalysisDto = z.strictObject({ state: z.enum(PREANALYSIS_STATES), fix: z.string().nullable() });
export type PreanalysisDto = z.infer<typeof preanalysisDto>;

export const messengerNotionIdentityDto = notionIdentityDto;
export type MessengerNotionIdentityDto = NotionIdentityDto;

export const messengerChatDto = z.strictObject({
  /** `messenger_chats.id`: the `chat:<id>` ref. */
  id: z.number().int(),
  channel: z.enum(MESSENGER_CHANNELS),
  chatId: z.string(),
  title: z.string().nullable(),
  /** The client the chat is linked to (by `client_identifiers`), else null. */
  client: z
    .strictObject({
      id: z.number().int(),
      name: z.string(),
      email: z.string(),
      notionPageId: z.string().nullable(),
      notionUrl: z.string().nullable(),
      notion: messengerNotionIdentityDto,
    })
    .nullable(),
  rules: chatRulesDto,
  inbound: z.number().int(),
  /** P102: every stored message of the chat, either side: what Unlink deletes, said in its sentence. */
  stored: z.number().int(),
  last: chatMessageDto.nullable(),
  /** The newest stored message is the client's and the pre-analysis did not hide it: a reply is owed. */
  owed: z.boolean(),
  draft: messengerDraftDto.nullable(),
  /** P84: why the Hub linked the chat by itself ("phone matches the client"), or null when the owner linked it. */
  autolinked: z.string().nullable(),
  triage: chatTriageDto,
});
export type MessengerChatDto = z.infer<typeof messengerChatDto>;

/** The selected linked chat's full stored conversation, oldest first. Hidden triage messages remain visible to the owner and are marked. */
export const messengerConversationMessageDto = z.strictObject({
  id: z.number().int(),
  direction: z.enum(["in", "out"]),
  kind: z.string(),
  text: z.string(),
  format: z.enum(["plain", "markdown"]).default("plain"),
  at: z.string(),
  hidden: z.enum(HIDDEN_LABELS).nullable(),
});
export type MessengerConversationMessageDto = z.infer<typeof messengerConversationMessageDto>;

export const messengerConversationDto = z.strictObject({
  chat: messengerChatDto,
  messages: z.array(messengerConversationMessageDto),
  earlier: z.number().int().min(0),
});
export type MessengerConversationDto = z.infer<typeof messengerConversationDto>;

export const messengerChatsDto = z.strictObject({
  chats: z.array(messengerChatDto),
  /** The View menu's counts over the linked chats of the project in the channel asked: `todo` those that wait, `linked` all of them. */
  counts: z.strictObject({ todo: z.number().int(), linked: z.number().int() }),
  preanalysis: preanalysisDto,
});
export type MessengerChatsDto = z.infer<typeof messengerChatsDto>;

/** Skip: the draft is set aside (status `discarded`); its Undo is the restore route. */
export const messengerSkippedDto = z.strictObject({ ok: z.literal(true), id: z.number().int() });

/** Owner-authored text for editing or creating an unsent draft (the Messenger provider's message limit). */
export const messengerDraftTextBody = z.strictObject({ text: z.string().trim().min(1, "the text is empty").max(MESSENGER_TEXT_MAX) });

/** Owner-triggered preparation of one unsent reply. The server creates the draft; it never sends it. */
export const messengerPrepareBody = z.strictObject({ ownerRequest: z.string().trim().max(CHAT_INSTRUCTION_MAX).optional() });
export type MessengerPrepareBody = z.infer<typeof messengerPrepareBody>;

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

import { CHAT_INSTRUCTION_MAX, HIDDEN_LABELS, MESSENGER_TEXT_MAX, REPLY_MODES } from "@hub/config/chat-rules";
import { z } from "zod";
import { contactLinksDto } from "./local";
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
 * The panel's views (P123 U3b, the words of Mail, decision 0045): `needs_you`, the linked chats with an open draft or whose newest
 * stored message is the client's, plus, on the admin, the fresh unlinked chats nobody decided on yet; `waiting`, the linked chats
 * whose newest message is ours (Waiting for them); `all`, every chat. The default is `needs_you`, so a bare `/messengers` shows what
 * needs the owner.
 */
export const MESSENGER_VIEWS = ["needs_you", "waiting", "all"] as const;
export type MessengerView = (typeof MESSENGER_VIEWS)[number];

/**
 * P123 U3b: the link state is a filter beside the view (`?link=`), not a view of its own. `any` is the linked and the unlinked
 * chats; `linked` only those linked to a client; `unlinked` (P102) every unlinked chat the autolink's memory holds, of any age;
 * `hidden` the chats the owner said are not clients, shown only when asked. P141 U2 (decision 0049): the server lists every known
 * chat, so `unlinked` is its known chats that no client identifier names; `hidden` stays the autolink's memory (a hidden chat has no
 * row).
 */
export const MESSENGER_LINK_FILTERS = ["any", "linked", "unlinked", "hidden"] as const;
export type MessengerLinkFilter = (typeof MESSENGER_LINK_FILTERS)[number];

/** P84c: the channel as a filter of the same page (`?channel=`), not a page per channel: the job is the same on both. */
export const MESSENGER_CHANNEL_FILTERS = ["all", "telegram", "whatsapp"] as const;
export type MessengerChannelFilter = (typeof MESSENGER_CHANNEL_FILTERS)[number];
/** A chat's channel under a filter: the Telegram bot's chats are Telegram's. */
export const inChannel = (channel: MessengerChannelDto, f: MessengerChannelFilter): boolean => f === "all" || (f === "whatsapp" ? channel === "whatsapp" : channel !== "whatsapp");

/**
 * The list projection's URL inputs. A missing or unknown view is Needs you, a missing or unknown link state or channel is all of
 * them (an address typed by hand lists, it does not answer 400).
 */
export const messengerChatsQuery = z.object({
  filter: z.enum(MESSENGER_VIEWS).catch("needs_you"),
  link: z.enum(MESSENGER_LINK_FILTERS).catch("any"),
  channel: z.enum(MESSENGER_CHANNEL_FILTERS).catch("all"),
  q: z.string().trim().max(200).default(""),
});
export type MessengerChatsQuery = z.infer<typeof messengerChatsQuery>;

export const chatRulesDto = z.strictObject({
  replyMode: z.enum(REPLY_MODES),
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
  /** Written after our own last message (a follow-up), not in answer to an inbound one. */
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
/**
 * P144 W1: where the OpenRouter key in use is read from, first found wins (never its value): `env` (OPENROUTER_API_KEY), `machine`
 * (one file every instance on this Mac reads), `instance` (this instance's own file). Null when no key is read (fake, none).
 */
export const PREANALYSIS_KEY_SOURCES = ["env", "machine", "instance"] as const;
export const preanalysisDto = z.strictObject({ state: z.enum(PREANALYSIS_STATES), fix: z.string().nullable(), keySource: z.enum(PREANALYSIS_KEY_SOURCES).nullable() });
export type PreanalysisDto = z.infer<typeof preanalysisDto>;

export const messengerNotionIdentityDto = notionIdentityDto;
export type MessengerNotionIdentityDto = NotionIdentityDto;

/** One client record the autolink suggests for a chat (P84): its Notion card key, name, email (null when the card has none) and Relationship. */
export const chatSuggestionDto = z.strictObject({ key: z.string(), name: z.string(), email: z.string().nullable(), relationship: z.string().nullable() });
export type ChatSuggestionDto = z.infer<typeof chatSuggestionDto>;

/**
 * P141 U3: who the person of a chat is: their number (`+E.164`, null when WhatsApp hides it), their Telegram username, the name they
 * set themselves (WhatsApp push name, Telegram display name; shown as theirs), when the Hub first saw the chat, the account that reads
 * it, and the autolink's suggestions (in memory; an exact match links by itself when the autolink is on).
 */
export const chatIdentityDto = z.strictObject({
  phone: z.string().nullable(),
  username: z.string().nullable(),
  profileName: z.string().nullable(),
  firstSeen: z.string(),
  account: z.string().nullable(),
  suggestions: z.array(chatSuggestionDto),
});
export type ChatIdentityDto = z.infer<typeof chatIdentityDto>;

export const messengerChatDto = z.strictObject({
  /** `messenger_chats.id`: the `chat:<id>` ref. */
  id: z.number().int(),
  channel: z.enum(MESSENGER_CHANNELS),
  chatId: z.string(),
  title: z.string().nullable(),
  /** The client the chat is linked to (by `client_identifiers`), else null: a known chat that is not linked (decision 0049). */
  client: z
    .strictObject({
      id: z.number().int(),
      name: z.string(),
      /** Null for a client known only by a chat (P141 C1). */
      email: z.string().nullable(),
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
  /** The newest stored message is the client's, the pre-analysis did not hide it and nobody marked the chat done: a reply is owed. */
  owed: z.boolean(),
  /**
   * P143 D1: the owner or the agent marked the chat "no reply needed" through its newest inbound message; null when not done, or
   * when a newer message of theirs reopened it. It removes attention only (Needs you), never the follow-up.
   */
  done: z.strictObject({ at: z.string(), by: z.enum(["owner", "agent"]), reason: z.string().nullable() }).nullable(),
  draft: messengerDraftDto.nullable(),
  /** P84: why the Hub linked the chat by itself ("phone matches the client"), or null when the owner linked it. */
  autolinked: z.string().nullable(),
  triage: chatTriageDto,
  /** P131 O5: what Open in Telegram / Open in WhatsApp opens: the chat's own number, else the client's Notion card. */
  contact: contactLinksDto,
  /** P141 U3 (verdict 11): who the person is, as the messenger shows it, and the autolink's suggested client records. */
  identity: chatIdentityDto,
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
  /** Decision 0049 point 5: `wa_app` when only the Mac's WhatsApp app supplied it (it arrived while the Hub was off), else null. */
  source: z.enum(["wa_app"]).nullable().default(null),
});
export type MessengerConversationMessageDto = z.infer<typeof messengerConversationMessageDto>;

export const messengerConversationDto = z.strictObject({
  chat: messengerChatDto,
  messages: z.array(messengerConversationMessageDto),
  earlier: z.number().int().min(0),
  /** P141 U1: `live` when opening read the chat through from the messenger in time, `saved` when the cache answered (the pane says "Showing the saved copy"), null when the channel has no read-through. */
  copy: z.enum(["live", "saved"]).nullable().default(null),
});
export type MessengerConversationDto = z.infer<typeof messengerConversationDto>;

export const messengerChatsDto = z.strictObject({
  chats: z.array(messengerChatDto),
  /** The View menu's counts over the linked chats of the project in the channel asked: those that need the owner, those that wait for the client, all of them; and the known chats that are not linked (P141 U2). */
  counts: z.strictObject({ needs_you: z.number().int(), waiting: z.number().int(), all: z.number().int(), unlinked: z.number().int() }),
  preanalysis: preanalysisDto,
});
export type MessengerChatsDto = z.infer<typeof messengerChatsDto>;

/** P143 D2: Done and its Undo: the chat's id and whether it is done now. */
export const messengerChatDoneDto = z.strictObject({ ok: z.literal(true), id: z.number().int(), done: z.boolean() });
export type MessengerChatDoneDto = z.infer<typeof messengerChatDoneDto>;

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
    instruction: z.string().max(CHAT_INSTRUCTION_MAX).nullable().optional(),
    language: z.string().trim().max(35).nullable().optional(),
    prefilter: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "no rule given");
export type ChatRulesBody = z.infer<typeof chatRulesBody>;

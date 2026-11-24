import { z } from "zod";

/**
 * The Telegram user account (P71 M1, decision 0036): its state in `/api/health`, the login steps, the dialog picker and the link.
 * Every reply is a `strictObject` and none has a field for a session, an api_hash, a code or a password, so no value can come
 * back by accident. A dialog's title, username and phone are the owner's own contacts, read on demand for his screen and never
 * stored or logged by the server.
 */

/** A user account's parks (0036 point 2): never retried by itself; a new login clears it. Same words as `@hub/messengers`. */
export const PARKED_CODES = ["logged_out", "banned", "flood_wait"] as const;
export type ParkedCode = (typeof PARKED_CODES)[number];

export const USER_ACCOUNT_STATES = ["starting", "running", "error", "parked", "stopped"] as const;

export const telegramUserAccountDto = z.strictObject({
  /** The signed-in user's Telegram id (the session folder's name): an id, never a secret. */
  account: z.string(),
  state: z.enum(USER_ACCOUNT_STATES),
  parked: z.enum(PARKED_CODES).nullable(),
  /** The one line that clears a park or an error, else null. */
  fix: z.string().nullable(),
  lastPollAt: z.string().optional(),
  lastError: z.string().optional(),
  failures: z.number(),
  stored: z.number(),
});
export type TelegramUserAccountDto = z.infer<typeof telegramUserAccountDto>;

/** `off` with a reason (no session, `HUB_MESSENGERS=off`, several projects); `on` with one row per account. */
export const telegramUserStatusDto = z.strictObject({
  state: z.enum(["off", "on"]),
  reason: z.string().optional(),
  project: z.string().optional(),
  accounts: z.array(telegramUserAccountDto),
});
export type TelegramUserStatusDto = z.infer<typeof telegramUserStatusDto>;

// ---- the login (each step one call; nothing but the final session is kept)

const flow = z.string().min(16).max(64);
export const userLoginStartBody = z.strictObject({
  apiId: z.number().int().positive().max(2 ** 31),
  apiHash: z.string().trim().regex(/^[a-f0-9]{32}$/i, "api_hash is 32 hex characters from my.telegram.org"),
  phone: z.string().trim().regex(/^\+?[\d\s\-().]{7,24}$/, "a phone number in international format"),
});
export const userLoginCodeBody = z.strictObject({ flow, code: z.string().trim().regex(/^[\d\s]{4,12}$/, "the digits Telegram sent") });
export const userLoginPasswordBody = z.strictObject({ flow, password: z.string().min(1).max(256) });
export const userLoginCancelBody = z.strictObject({ flow });
export type UserLoginStartBody = z.infer<typeof userLoginStartBody>;

export const userLoginStepDto = z.discriminatedUnion("step", [
  z.strictObject({ step: z.literal("code"), flow }),
  z.strictObject({ step: z.literal("password"), flow }),
  /** `name` is the owner's own display name, so he sees which account was connected. */
  z.strictObject({ step: z.literal("done"), account: z.string(), name: z.string() }),
]);
export type UserLoginStepDto = z.infer<typeof userLoginStepDto>;

export const userLoginCancelledDto = z.strictObject({ ok: z.literal(true) });
export const userDisconnectedDto = z.strictObject({ ok: z.literal(true), account: z.string(), removed: z.boolean() });

// ---- the dialogs of a client's chat picker (0036 point 3; P102: one picker, the autolink's)

export const userDialogDto = z.strictObject({
  chatId: z.string(),
  title: z.string(),
  username: z.string().nullable(),
  phone: z.string().nullable(),
  /** Its phone or Telegram username is one of the picked client record's identifiers: a suggestion, which the owner confirms (never auto-linked). */
  suggested: z.boolean(),
  /** Already linked in this project (to this or another client). */
  linked: z.boolean(),
});
export const userDialogsDto = z.strictObject({ dialogs: z.array(userDialogDto) });
export type UserDialogDto = z.infer<typeof userDialogDto>;

// ---- WhatsApp as a linked device (P71 M5): the same account rows, the pairing by QR code, the same picker and link

/**
 * P141 W3 (decision 0049 points 3 and 4): the WhatsApp app's database on this Mac as the read-only refill of a chat, as the
 * server's own process found it (the owner's shell can read it when the server cannot). `cacheDays` is WhatsApp's cache TTL: 30
 * while the app refills a chat, 90 when it cannot. `fix` is the one line the owner acts on (Full Disk Access), else null.
 */
export const waAppHistoryDto = z.strictObject({
  state: z.enum(["on", "off"]),
  reason: z.enum(["missing", "refused", "schema", "error"]).nullable(),
  detail: z.string().nullable(),
  fix: z.string().nullable(),
  cacheDays: z.number().int().positive(),
});
export type WaAppHistoryDto = z.infer<typeof waAppHistoryDto>;

/** The WhatsApp linked devices, one row per session (the account is the number's digits): the Telegram accounts' shape, and the Mac app's refill. */
export const whatsappStatusDto = telegramUserStatusDto.extend({ appHistory: waAppHistoryDto.optional() });
export type WhatsAppStatusDto = z.infer<typeof whatsappStatusDto>;

/** Connect: the pairing's id. Nothing else: the QR code comes with the state. */
export const waConnectStartedDto = z.strictObject({ flow });
export const waConnectFlowBody = z.strictObject({ flow });

/** QR rows hold `0` and `1` only: a module matrix the admin draws; never the QR string itself. */
const qrRow = z.string().regex(/^[01]{21,177}$/);
export const waConnectStepDto = z.discriminatedUnion("step", [
  z.strictObject({ step: z.literal("waiting") }),
  z.strictObject({ step: z.literal("qr"), size: z.number().int().min(21).max(177), rows: z.array(qrRow).max(177) }),
  /** `name` is the owner's own WhatsApp name, so he sees which number was linked. */
  z.strictObject({ step: z.literal("done"), account: z.string(), name: z.string() }),
  z.strictObject({ step: z.literal("failed"), reason: z.string() }),
]);
export type WaConnectStepDto = z.infer<typeof waConnectStepDto>;

// ---- P84: chats link themselves (decision 0036 point 3 as amended 2026-11-20)

const userChannel = z.enum(["telegram_user", "whatsapp"]);

/** A client record of the directory (Notion, read only, in memory): its key is the Notion page id. */
export const autolinkRecordDto = z.strictObject({ key: z.string(), name: z.string(), email: z.string().nullable(), relationship: z.string().nullable() });
export type AutolinkRecordDto = z.infer<typeof autolinkRecordDto>;

/** Why an unlinked dialog was not linked by itself. */
export const AUTOLINK_WHY = ["none", "ambiguous", "no_email", "off", "failed"] as const;

/** An unlinked private dialog the Hub saw since the server started, in memory only (its name and the records it matched; never a text). */
export const recentDialogDto = z.strictObject({
  channel: userChannel,
  account: z.string(),
  chatId: z.string(),
  title: z.string(),
  seenAt: z.string(),
  why: z.enum(AUTOLINK_WHY),
  by: z.enum(["phone", "username"]).nullable(),
  candidates: z.array(autolinkRecordDto),
  /** P84c: when its newest message was and whether it was theirs (never its text); the state lists only fresh ones. */
  last: z.strictObject({ at: z.string(), inbound: z.boolean() }).nullable(),
  /** P100: the chat's own identity as the messenger gives it (memory only): prefilled into Create and written to an empty Notion field on Link. */
  username: z.string().nullable(),
  phone: z.string().nullable(),
});
export type RecentDialogDto = z.infer<typeof recentDialogDto>;

/** P84c: a chat the owner hid ("not a client"), known by name only while the server's memory holds it; the store keeps its HMAC only. */
export const hiddenDialogDto = z.strictObject({
  channel: userChannel,
  /** P102: the account that saw it, so Link on a hidden chat can name it; null when the memory never learned it (Link is then not offered). */
  account: z.string().nullable(),
  chatId: z.string(),
  title: z.string(),
  hiddenAt: z.string(),
});
export type HiddenDialogDto = z.infer<typeof hiddenDialogDto>;

export const directoryStatusDto = z.strictObject({
  state: z.enum(["off", "loading", "ready", "error"]),
  reason: z.string().nullable(),
  entries: z.number().int(),
  withIdentifier: z.number().int(),
  byRelationship: z.record(z.string(), z.number().int()),
  readAt: z.string().nullable(),
});

/** P128 X5 ("sort the chats"): one unlinked chat the agent proposes to hide ("Hide: not a client"), with its reason. */
export const hideProposalDto = z.strictObject({ channel: userChannel, account: z.string(), chatId: z.string(), title: z.string(), reason: z.string(), at: z.string() });
export type HideProposalDto = z.infer<typeof hideProposalDto>;
/** `POST /api/projects/:slug/messengers/autolink/state`: the setting, the directory, the in-memory suggestions and the count. */
export const autolinkStateDto = z.strictObject({
  enabled: z.boolean(),
  directory: directoryStatusDto,
  /** Distinct unlinked chats that wrote since the server started: in memory, never stored. */
  unlinkedActive: z.number().int(),
  /** Only the fresh ones (newest message at most `freshDays` old), newest first: To do's unlinked chats. */
  recent: z.array(recentDialogDto),
  /** P102: every unlinked chat the memory holds, of any age (up to 200), newest first: the Not linked view. A superset of `recent`. */
  unlinked: z.array(recentDialogDto),
  freshDays: z.number().int(),
  /** P84c: the hidden chats the memory can name, and how many more are hidden by a fingerprint the Hub cannot name back. */
  hidden: z.array(hiddenDialogDto),
  hiddenUnnamed: z.number().int(),
  /** P128 X5: the agent's proposed hides of unlinked chats, each with its reason (memory only); the owner confirms them in one dialog. */
  proposals: z.array(hideProposalDto),
});
export type AutolinkStateDto = z.infer<typeof autolinkStateDto>;

/** The dry run: counts only (no name, no number, no text), per live account. */
export const autolinkPreviewDto = z.strictObject({
  enabled: z.boolean(),
  directory: directoryStatusDto,
  accounts: z.array(
    z.strictObject({
      channel: userChannel,
      dialogs: z.number().int(),
      linked: z.number().int(),
      unique: z.number().int(),
      ambiguous: z.number().int(),
      noEmail: z.number().int(),
      byRelationship: z.record(z.string(), z.number().int()),
    }),
  ),
});
export type AutolinkPreviewDto = z.infer<typeof autolinkPreviewDto>;

/** The owner's Link of a seen dialog to a directory record (`key`). */
/** A user account's chat id: a Telegram user id, a WhatsApp number, or `lid:<digits>` for a WhatsApp chat whose number is hidden (P141 W1). */
const userChatId = z.string().regex(/^(\+?\d{1,20}|lid:\d{1,20})$/);
export const autolinkLinkBody = z.strictObject({ channel: userChannel, account: z.string().regex(/^\d{1,20}$/), chatId: userChatId, key: z.string().min(1).max(64), title: z.string().trim().max(200).optional() });
export const autolinkRecordsBody = z.strictObject({ q: z.string().trim().min(2).max(100) });
export const autolinkRecordsDto = z.strictObject({
  records: z.array(autolinkRecordDto),
  /** P100: whether Notion was asked live too (false: only the copy read at start and every 6 h; `liveError` says why). */
  live: z.boolean(),
  liveError: z.string().nullable(),
});
/** P100: Create a client in Notion from an unlinked chat (Name, Email, its Telegram username or WhatsApp number), then link the chat. */
export const autolinkCreateBody = z.strictObject({
  channel: userChannel,
  account: z.string().regex(/^\d{1,20}$/),
  chatId: userChatId,
  title: z.string().trim().max(200).optional(),
  name: z.string().trim().min(1).max(200),
  email: z.email().max(254),
});
/** P100: a link from the Chats screen: the import's count and what the Hub did to the client's Notion field (null: nothing to say). */
export const autolinkLinkedDto = z.strictObject({
  ok: z.literal(true),
  chatId: z.string(),
  imported: z.number(),
  importError: z.string().nullable(),
  /** The import's window in days (30). */
  days: z.number().int(),
  /** "Telegram set to suenot", "Telegram already filled", or the fix when Notion refused; null when there was nothing to write. */
  notion: z.string().nullable(),
});
export type AutolinkLinkedDto = z.infer<typeof autolinkLinkedDto>;
/** P84c: Hide ("not a client") and Unhide of a chat the Hub saw; a linked chat is hidden by `/chats/:id/never`, which unlinks it first. */
export const autolinkHideBody = z.strictObject({ channel: userChannel, chatId: userChatId });
export const autolinkHiddenDto = z.strictObject({ ok: z.literal(true), channel: userChannel, chatId: z.string(), hidden: z.boolean() });
/** P102: the dialogs of one account for the Link a chat box, marked against the picked client record (`key`); read on demand, never stored. */
export const autolinkDialogsBody = z.strictObject({ channel: userChannel, account: z.string().regex(/^\d{1,20}$/), key: z.string().min(1).max(64) });
/** P102: Change client moves a linked chat to another client record; its stored messages stay. */
export const autolinkMoveBody = z.strictObject({ key: z.string().min(1).max(64) });
export const chatMovedDto = z.strictObject({
  ok: z.literal(true),
  id: z.number().int(),
  /** The client row the chat was on, for the Undo (the Hub's own id, never a Notion fact). */
  fromClientId: z.number().int(),
  fromName: z.string(),
  toName: z.string(),
  /** The open draft written for the old client, set aside; null when there was none. */
  skippedDraftId: z.number().int().nullable(),
  /** What the Hub did to the new card's Telegram or WhatsApp field in Notion (null: nothing to say). */
  notion: z.string().nullable(),
});
export type ChatMovedDto = z.infer<typeof chatMovedDto>;
/** P102: the Undo of a move: the chat goes back to the client row it left and the draft that was set aside waits again. */
export const chatMoveUndoBody = z.strictObject({ clientId: z.number().int().positive(), draftId: z.number().int().positive().nullable() });
export const chatMoveUndoneDto = z.strictObject({ ok: z.literal(true), id: z.number().int(), draftRestored: z.boolean() });
/** Unlink and Never link answer which chat went and how many of its stored messages. */
export const chatUnlinkedDto = z.strictObject({ ok: z.literal(true), id: z.number().int(), never: z.boolean() });

const proposalChat = z.strictObject({ channel: userChannel, chatId: userChatId });
/** The agent's proposal (`hub mcp`'s loopback call with its token): at most 200 chats, a reason each. */
export const autolinkProposeBody = z.strictObject({ items: z.array(proposalChat.extend({ reason: z.string().trim().min(1).max(200) })).min(1).max(200) });
export const autolinkProposedDto = z.strictObject({ ok: z.literal(true), kept: z.number().int(), skipped: z.number().int() });
/** The owner's Keep of proposed chats (or the end of a confirmed hide): their proposals are dropped. */
export const autolinkProposalsDropBody = z.strictObject({ items: z.array(proposalChat).min(1).max(200) });
export const autolinkProposalsDroppedDto = z.strictObject({ ok: z.literal(true) });
/** What the agent reads to sort the chats: the unlinked chats the memory holds (identity, why, the newest message's time; never text). */
export const agentUnlinkedDto = z.strictObject({
  chats: z.array(z.strictObject({ channel: userChannel, chatId: z.string(), title: z.string(), why: z.string(), lastAt: z.string().nullable(), inbound: z.boolean().nullable(), proposed: z.boolean() })),
});
export type AgentUnlinkedDto = z.infer<typeof agentUnlinkedDto>;

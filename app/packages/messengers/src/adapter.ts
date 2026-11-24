import { HubError } from "@hub/config/errors";
import type { MessageSource, MessengerChannel } from "@hub/db";
import type { ConfirmedDraft } from "./confirmed";

/** One received message, already reduced to what is stored. */
export interface InboundMessage {
  channel: MessengerChannel;
  account: string;
  chatId: string;
  chatTitle?: string;
  remoteMessageId: string;
  kind: string; // "text" or the media type; bytes are never kept
  text: string;
  /** `out` for a message the account itself wrote (a user account sees both sides; a bot only `in`). Default `in`. */
  direction?: "in" | "out";
  sentAt: string; // ISO-8601 UTC
  /** WhatsApp: the chat's real address (`…@lid` when WhatsApp gives one), kept on the chat's row for the history request and the send. */
  chatJid?: string;
  /** Who the chat is, as the messenger shows it (P141 U3; never a text): its username (Telegram) and phone, and the name the person set. */
  chatUsername?: string | null;
  chatPhone?: string | null;
  profileName?: string | null;
  /** Decision 0049 point 5: `wa_app` when only the Mac's WhatsApp app supplied the row. */
  source?: MessageSource;
  /** An edit of the stored message with this remote id: its text replaces the stored one; nothing new is stored. */
  editOf?: string;
  /** History (a sync or an import), not a new message: stored, but it wakes neither the pre-analysis nor the autopilot. */
  backfill?: boolean;
}

export interface PollOptions {
  /** Opaque position from the previous batch (null on first run). */
  cursor: string | null;
  timeoutSec: number;
  limit: number;
  signal?: AbortSignal;
}

export interface PollBatch {
  messages: InboundMessage[];
  /** Where the next poll starts. Persisted only after `messages` are stored. */
  cursor: string | null;
}

export interface SentReceipt {
  remoteMessageId: string;
  at: string;
}

export interface MessengerAdapter {
  readonly channel: MessengerChannel;
  /** Account id, never a secret (Telegram: the bot id). */
  readonly account: string;
  /** The cache's TTL of this account's rows (decision 0049), when the server set one; absent, `RETENTION_DAYS`. */
  readonly cacheDays?: number;
  /** Once before polling: verify credentials, clear a webhook. */
  start?(): Promise<void>;
  poll(opts: PollOptions): Promise<PollBatch>;
}

/** An adapter with `send`, which takes only a `ConfirmedDraft`. */
export interface SendingAdapter extends MessengerAdapter {
  send(draft: ConfirmedDraft): Promise<SentReceipt>;
  /**
   * Decision 0048 (P139 A4, verdict 13): the channel's typing status in a chat the Hub knows, before an autopilot send. Sends
   * no message; best-effort (the caller logs a failure and sends anyway). Absent on a channel without one.
   */
  typing?(chatId: string): Promise<void>;
}

/**
 * The read side of an adapter and nothing else: a fresh object with `channel`, `account`, `start` and `poll`. A process
 * that only receives (the server's poller) is handed this, so no send path exists in it even if the adapter has one.
 */
export function pollOnly(a: MessengerAdapter): MessengerAdapter {
  return { channel: a.channel, account: a.account, ...(a.start ? { start: () => a.start!() } : {}), poll: (o) => a.poll(o) };
}

export const isSending = (a: MessengerAdapter): a is SendingAdapter => typeof (a as Partial<SendingAdapter>).send === "function";

export type AdapterErrorCode = "unauthorized" | "conflict" | "rate_limited" | "network" | "unknown" | ParkedCode;

/**
 * A user account's states that park it (decision 0036 point 2): the session was revoked (`logged_out`), the account is banned, or
 * Telegram asked for a wait over an hour (`flood_wait`; WhatsApp has none). Parked is never retried by itself: only a new login clears it.
 */
export const PARKED_CODES = ["logged_out", "banned", "flood_wait"] as const;
export type ParkedCode = (typeof PARKED_CODES)[number];
export const isParkedCode = (c: string): c is ParkedCode => (PARKED_CODES as readonly string[]).includes(c);

/** How a park is written to `messenger_accounts.last_error`, so a server restart finds it and does not reconnect. */
export const parkedLine = (code: ParkedCode, message: string): string => `parked ${code}: ${message}`;
/** The park a stored `last_error` records, or null. */
export function parkedOf(lastError: string | null | undefined): ParkedCode | null {
  const code = /^parked ([a-z_]+):/.exec(lastError ?? "")?.[1];
  return code && isParkedCode(code) ? code : null;
}

/**
 * `unauthorized` (bad token) and `conflict` (another consumer or a webhook) stop the poller: retrying cannot fix them. So do
 * the parked codes of a user account.
 */
export class AdapterError extends HubError {
  declare readonly code: AdapterErrorCode;
  /** Telegram or WhatsApp failed: `upstream` (502). */
  constructor(
    code: AdapterErrorCode,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super("upstream", code, message);
    this.name = "AdapterError";
  }
  get fatal(): boolean {
    return this.code === "unauthorized" || this.code === "conflict" || isParkedCode(this.code);
  }
  get parked(): boolean {
    return isParkedCode(this.code);
  }
}

/** The Telegram bot as a receive-only adapter (grammY is loaded only here). What a long-running poller, like the server, uses: it has no `send`. */
export async function telegramPollAdapter(token: string): Promise<MessengerAdapter> {
  return pollOnly((await import("./telegram-api")).telegramAdapterFromToken(token));
}

/**
 * The real mtcute clients of a Telegram user account (P71), loaded only when the server has a session or a login starts, so a
 * process without one never loads MTProto.
 */
export async function mtcuteClients() {
  const m = await import("./telegram-user-api");
  return { login: m.mtcuteLoginClient, session: m.mtcuteSessionClient };
}

/**
 * The real Baileys socket of a WhatsApp linked device (P71 M5), loaded only when the server has a session or a pairing starts.
 * The current WhatsApp Web version is fetched here once (up to 5 s, from GitHub), and every socket of the process announces it.
 */
export async function baileysSocketFactory() {
  const m = await import("./whatsapp-api");
  const version = await m.latestWaVersion();
  return (auth: Parameters<typeof m.baileysSocket>[0]) => m.baileysSocket(auth, version);
}

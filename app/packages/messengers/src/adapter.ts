import type { MessengerChannel } from "@hub/db";
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
  /** Once before polling: verify credentials, clear a webhook. */
  start?(): Promise<void>;
  poll(opts: PollOptions): Promise<PollBatch>;
}

/** An adapter with `send`, which takes only a `ConfirmedDraft`. */
export interface SendingAdapter extends MessengerAdapter {
  send(draft: ConfirmedDraft): Promise<SentReceipt>;
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
export class AdapterError extends Error {
  constructor(
    readonly code: AdapterErrorCode,
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
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

/** The real Baileys socket of a WhatsApp linked device (P71 M5), loaded only when the server has a session or a pairing starts. */
export async function baileysSocketFactory() {
  return (await import("./whatsapp-api")).baileysSocket;
}

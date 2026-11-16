import type { MessengerChannel } from "@hub/db";
import type { ConfirmedDraft } from "./confirmed";
import type { SendableChannel } from "./types";

/** One received message, already reduced to what is stored. */
export interface InboundMessage {
  channel: MessengerChannel;
  account: string;
  chatId: string;
  chatTitle?: string;
  remoteMessageId: string;
  kind: string; // "text" or the media type; bytes are never kept
  text: string;
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

/** Only adapters of a sendable channel have `send`, and it takes only a `ConfirmedDraft`. */
export interface SendingAdapter extends MessengerAdapter {
  readonly channel: SendableChannel;
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

export type AdapterErrorCode = "unauthorized" | "conflict" | "rate_limited" | "network" | "unknown";

/** `unauthorized` (bad token) and `conflict` (another consumer or a webhook) stop the poller: retrying cannot fix them. */
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
    return this.code === "unauthorized" || this.code === "conflict";
  }
}

/** The Telegram bot as a receive-only adapter (grammY is loaded only here). What a long-running poller, like the server, uses: it has no `send`. */
export async function telegramPollAdapter(token: string): Promise<MessengerAdapter> {
  return pollOnly((await import("./telegram-api")).telegramAdapterFromToken(token));
}

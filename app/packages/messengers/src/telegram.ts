import { AdapterError, type InboundMessage, type PollBatch, type PollOptions, type SendingAdapter, type SentReceipt } from "./adapter";
import { isConfirmed, type ConfirmedDraft } from "./confirmed";
import { redact } from "./poller";

// The part of the Bot API this adapter uses. grammY's `Api` satisfies it; tests pass a fake.
export interface TgChat {
  id: number;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}
export interface TgMessage {
  message_id: number;
  date: number;
  chat: TgChat;
  text?: string;
  caption?: string;
  [media: string]: unknown;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}
export interface TelegramApi {
  getMe(): Promise<{ id: number; username?: string }>;
  deleteWebhook(other?: { drop_pending_updates?: boolean }): Promise<unknown>;
  getUpdates(other: { offset?: number; limit?: number; timeout?: number; allowed_updates?: string[] }, signal?: AbortSignal): Promise<TgUpdate[]>;
  sendMessage(chatId: number | string, text: string): Promise<{ message_id: number; date: number }>;
}

const MEDIA = ["photo", "voice", "video", "video_note", "audio", "document", "sticker", "animation", "location", "contact", "poll"];

const chatTitle = (c: TgChat): string | undefined => c.title ?? ([c.first_name, c.last_name].filter(Boolean).join(" ") || c.username);

/** Maps a Bot API message to a stored one; service messages (joins, pins) carry nothing to keep and map to null. */
export function toInbound(m: TgMessage, account: string): InboundMessage | null {
  const kind = typeof m.text === "string" ? "text" : MEDIA.find((k) => m[k] !== undefined);
  if (!kind) return null;
  const title = chatTitle(m.chat);
  return {
    channel: "telegram_bot",
    account,
    chatId: String(m.chat.id),
    ...(title ? { chatTitle: title } : {}),
    remoteMessageId: String(m.message_id),
    kind,
    text: m.text ?? m.caption ?? "",
    sentAt: new Date(m.date * 1000).toISOString(),
  };
}

/** Maps a grammY or fetch failure to an `AdapterError`; the message is scrubbed of anything token-shaped. */
export function toAdapterError(err: unknown): AdapterError {
  if (err instanceof AdapterError) return err;
  const e = err as { error_code?: number; description?: string; message?: string; name?: string; parameters?: { retry_after?: number } };
  const msg = redact(e.description ?? e.message ?? String(err));
  if (e.error_code === 401) return new AdapterError("unauthorized", `telegram 401: ${msg}`);
  if (e.error_code === 409) return new AdapterError("conflict", `telegram 409: ${msg} (another getUpdates consumer or a webhook holds this bot)`);
  if (e.error_code === 429) return new AdapterError("rate_limited", `telegram 429: ${msg}`, (e.parameters?.retry_after ?? 5) * 1000);
  if (e.name === "HttpError") return new AdapterError("network", msg);
  return new AdapterError("unknown", msg);
}

export interface TelegramOptions {
  api: TelegramApi;
  /** The bot id (before the colon of the token). */
  botId: string;
}

/**
 * Telegram bot on long polling. `start()` verifies the token and removes any webhook (getUpdates fails while one is
 * set). Only `message` updates are requested. The cursor is the next `offset`: last update_id + 1, advanced over
 * updates that carry no storable message too, so a service message is not re-fetched forever.
 */
export function createTelegramAdapter(opts: TelegramOptions): SendingAdapter {
  const { api, botId } = opts;
  return {
    channel: "telegram_bot",
    account: botId,

    async start() {
      try {
        const me = await api.getMe();
        if (String(me.id) !== botId) throw new AdapterError("unauthorized", "token does not belong to the bot id it was configured with");
        await api.deleteWebhook({ drop_pending_updates: false });
      } catch (err) {
        throw toAdapterError(err);
      }
    },

    async poll(o: PollOptions): Promise<PollBatch> {
      try {
        const updates = await api.getUpdates(
          { ...(o.cursor ? { offset: Number(o.cursor) } : {}), limit: o.limit, timeout: o.timeoutSec, allowed_updates: ["message"] },
          o.signal,
        );
        const messages: InboundMessage[] = [];
        let next = o.cursor;
        for (const u of updates) {
          next = String(Math.max(Number(next ?? 0), u.update_id + 1));
          const m = u.message ? toInbound(u.message, botId) : null;
          if (m) messages.push(m);
        }
        return { messages, cursor: next };
      } catch (err) {
        throw toAdapterError(err);
      }
    },

    async send(draft: ConfirmedDraft): Promise<SentReceipt> {
      if (!isConfirmed(draft)) throw new Error("not_confirmed: send accepts only a ConfirmedDraft");
      try {
        const chat = /^-?\d+$/.test(draft.chatId) ? Number(draft.chatId) : draft.chatId;
        const r = await api.sendMessage(chat, draft.text);
        return { remoteMessageId: String(r.message_id), at: new Date(r.date * 1000).toISOString() };
      } catch (err) {
        throw toAdapterError(err);
      }
    },
  };
}

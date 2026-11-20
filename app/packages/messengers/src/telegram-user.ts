import { AdapterError, type InboundMessage, type MessengerAdapter, type PollBatch, type PollOptions, type SendingAdapter, type SentReceipt } from "./adapter";
import { isConfirmed, type ConfirmedDraft } from "./confirmed";
import type { DialogIdentity } from "./autolink";
import { redact } from "./poller";

/**
 * The Telegram USER account (P71 M1, decision 0036): the owner's own account over MTProto. mtcute pushes new messages over a
 * socket; this adapter buffers them in a bounded in-memory queue that `poll` drains, so `runPoller`, the persisted cursor and the
 * backoff stay the one path the bot uses. mtcute itself is loaded only in `telegram-user-api.ts`; everything here works over the
 * small `MtClient` interface below, which tests satisfy with a fake.
 *
 * Privacy (0036 point 3): a message from a chat that is not on the allow-list is dropped in the event handler, before the queue:
 * it leaves no row, no counter and no log line. Only private chats with a person are read (no groups, channels, bots or Saved
 * Messages). `send` (P71 M4) takes only a `ConfirmedDraft` the server's send door minted, to a chat on the allow-list; the poller
 * is handed `pollOnly(adapter)`, so the receiving side holds no send path.
 */

/** A peer as the hub sees it: a person (`user`) or anything else (`other`: a group, a channel), which is never read. */
export type MtPeer =
  | { type: "user"; id: number; displayName: string; username: string | null; phoneNumber: string | null; isBot: boolean; isSelf: boolean }
  | { type: "other"; id: number; displayName: string };

export interface MtMessage {
  id: number;
  date: Date;
  text: string;
  /** The media's kind (`photo`, `voice`, ...) or null; bytes are never fetched. */
  mediaType: string | null;
  isOutgoing: boolean;
  isService: boolean;
  chat: MtPeer;
}

export interface MtMe {
  id: number;
  displayName: string;
}

/** What the adapter needs of a connected, signed-in client. `telegram-user-api.ts` maps mtcute onto it. */
export interface MtClient {
  /** Connects with the imported session and returns who is signed in (throws an RpcError-shaped error when the session is dead). */
  connect(): Promise<MtMe>;
  /** Starts the updates loop; `onMessage` gets every new message, `onError` every error of the connection. */
  listen(onMessage: (m: MtMessage) => void, onError: (e: unknown) => void): Promise<void>;
  /** The dialog list, newest first, at most `limit`. Read on demand, never stored. */
  dialogs(limit: number): Promise<MtPeer[]>;
  /** A chat's messages newer than `minId` and not older than `since`, newest first, at most `limit`. */
  history(chatId: number, o: { since: Date; minId: number; limit: number }): Promise<MtMessage[]>;
  /** Sends one plain text to a private chat (P71 M4): only the adapter's `send` calls it, with a confirmed draft. */
  sendText(chatId: number, text: string): Promise<{ id: number; date: Date }>;
  close(): Promise<void>;
}

/** The bounded queue: past it the queue is cleared and the next poll reads the linked chats' history from the cursor instead. */
export const QUEUE_MAX = 1000;
/** A flood wait longer than this parks the account (0036 point 2); a shorter one is waited out by the poller. Seconds. */
export const FLOOD_PARK_SECONDS = 3600;
/** How far back a link imports (0036 point 3). Days. */
export const IMPORT_DAYS = 30;
/** At most this many messages per chat in one import or one catch-up. */
export const IMPORT_LIMIT = 500;

const LOGGED_OUT = ["AUTH_KEY_UNREGISTERED", "AUTH_KEY_INVALID", "SESSION_REVOKED", "SESSION_EXPIRED", "AUTH_KEY_DUPLICATED", "USER_DEACTIVATED"];
const BANNED = ["USER_DEACTIVATED_BAN", "PHONE_NUMBER_BANNED", "USER_BANNED_IN_CHANNEL"];
const NETWORK = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH|socket|timed? ?out|connection/i;

/** The fields of mtcute's `RpcError` the mapping reads, by shape (this file never imports mtcute). */
const rpcOf = (err: unknown): { code: number; text: string; seconds?: number } | null => {
  if (typeof err !== "object" || err === null) return null;
  const code: unknown = Reflect.get(err, "code");
  const text: unknown = Reflect.get(err, "text");
  const seconds: unknown = Reflect.get(err, "seconds");
  if (typeof code !== "number" || typeof text !== "string") return null;
  return { code, text, ...(typeof seconds === "number" ? { seconds } : {}) };
};

/**
 * Maps an mtcute failure to an `AdapterError`. The message carries only Telegram's error code word or the error's class, never a
 * chat, a name or a text: the line reaches `messenger_accounts.last_error` and `/api/health`.
 */
export function toUserAdapterError(err: unknown): AdapterError {
  if (err instanceof AdapterError) return err;
  const rpc = rpcOf(err);
  if (rpc) {
    const word = rpc.text.replace(/[^A-Z0-9_%]/g, "").slice(0, 60);
    if (BANNED.includes(rpc.text)) return new AdapterError("banned", `telegram ${rpc.code}: ${word}`);
    if (rpc.code === 401 || LOGGED_OUT.includes(rpc.text)) return new AdapterError("logged_out", `telegram ${rpc.code}: ${word}`);
    if (rpc.code === 420 || rpc.text.startsWith("FLOOD_")) {
      const s = rpc.seconds ?? Number(/(\d+)$/.exec(rpc.text)?.[1] ?? 60);
      if (s > FLOOD_PARK_SECONDS) return new AdapterError("flood_wait", `telegram 420: ${word}, wait ${Math.ceil(s / 60)} min`, s * 1000);
      return new AdapterError("rate_limited", `telegram 420: ${word}`, s * 1000);
    }
    return new AdapterError("unknown", `telegram ${rpc.code}: ${word}`);
  }
  const name = err instanceof Error ? err.name : "Error";
  const msg = err instanceof Error ? err.message : String(err);
  if (NETWORK.test(`${name} ${msg}`)) return new AdapterError("network", redact(`${name}: ${msg}`).slice(0, 200));
  return new AdapterError("unknown", name.slice(0, 60));
}

/** A private chat with a person, the only kind the hub reads. */
const isPerson = (p: MtPeer): p is Extract<MtPeer, { type: "user" }> => p.type === "user" && !p.isBot && !p.isSelf;

/** Maps an mtcute message to a stored one; a service message, or one outside a private chat with a person, is null. */
export function toUserInbound(m: MtMessage, account: string): InboundMessage | null {
  if (m.isService || !isPerson(m.chat)) return null;
  const kind = m.mediaType ?? (m.text ? "text" : null);
  if (!kind) return null;
  return {
    channel: "telegram_user",
    account,
    chatId: String(m.chat.id),
    remoteMessageId: String(m.id),
    kind,
    text: m.text,
    sentAt: m.date.toISOString(),
    direction: m.isOutgoing ? "out" : "in",
  };
}

/** One dialog the picker shows: a person's private chat. Read on demand, never stored or logged. */
export interface UserDialog {
  chatId: string;
  title: string;
  username: string | null;
  phone: string | null;
}

export interface TelegramUserOptions {
  client: MtClient;
  /** The signed-in user's id (the session folder's name): `start` refuses a session that belongs to someone else. */
  account: string;
  /** The chat ids on the allow-list of this channel, read before each poll so a link or unlink applies within one poll. */
  allowedChats: () => Promise<string[]>;
  /**
   * P84: told the identity (chat id, name, phone, username; never the text) of each inbound message of a private chat that is not
   * linked, before it is dropped. The autolink matcher listens here; nothing of the chat is kept by the adapter.
   */
  onUnlinked?: (d: DialogIdentity, inbound: boolean) => void;
  queueMax?: number;
}

/** Telegram gives a phone as international digits without `+`. */
export const telegramPhone = (p: string | null): string | null => (p ? (p.startsWith("+") ? p : `+${p}`) : null);

export interface TelegramUserAdapter extends MessengerAdapter {
  readonly channel: "telegram_user";
  /** The picker's list (0036 point 3): private chats with people, newest first. */
  dialogs(limit: number): Promise<UserDialog[]>;
  /** The last `days` of one chat, for the import on link; only that chat, which the caller has just allowed. */
  history(chatId: string, o: { since: Date; limit?: number }): Promise<InboundMessage[]>;
  /** Re-reads the allow-list now (after a link), instead of at the next poll. */
  refreshAllowed(): Promise<void>;
  close(): Promise<void>;
}

/** The same adapter with its send (P71 M4): what the server's send door is handed, and nothing else. */
export type TelegramUserSendingAdapter = TelegramUserAdapter & SendingAdapter & { readonly channel: "telegram_user"; send(draft: ConfirmedDraft): Promise<SentReceipt> };

const wait = (ms: number, wake: { fn: (() => void) | null }, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(t);
      wake.fn = null;
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const t = setTimeout(done, ms);
    wake.fn = done;
    signal?.addEventListener("abort", done, { once: true });
  });

export function createTelegramUserAdapter(o: TelegramUserOptions): TelegramUserSendingAdapter {
  const { client, account } = o;
  const max = o.queueMax ?? QUEUE_MAX;
  let allowed = new Set<string>();
  let queue: InboundMessage[] = [];
  let failure: AdapterError | null = null;
  let catchUp = true;
  const wake: { fn: (() => void) | null } = { fn: null };

  const refreshAllowed = async () => {
    allowed = new Set(await o.allowedChats());
  };
  const onMessage = (m: MtMessage) => {
    const msg = toUserInbound(m, account);
    if (msg && !allowed.has(msg.chatId) && msg.direction === "in" && m.chat.type === "user") {
      // P84: only who wrote (never what) goes to the autolink matcher, which keeps it in memory.
      try {
        o.onUnlinked?.({ chatId: msg.chatId, title: m.chat.displayName, phone: telegramPhone(m.chat.phoneNumber), username: m.chat.username }, true);
      } catch {
        // The matcher's failure never stops the receiver.
      }
    }
    // An unlinked chat stops here: nothing is counted, kept or written (0036 point 3).
    if (!msg || !allowed.has(msg.chatId)) return;
    if (queue.length >= max) {
      queue = [];
      catchUp = true;
    } else queue.push(msg);
    wake.fn?.();
  };
  const onError = (e: unknown) => {
    const err = toUserAdapterError(e);
    // A dead session or a ban is kept until the poller reads it; a passing network error is mtcute's to reconnect.
    if (err.fatal || !failure) failure = err;
    wake.fn?.();
  };
  const history = async (chatId: string, h: { since: Date; minId?: number; limit?: number }) => {
    const rows = await client.history(Number(chatId), { since: h.since, minId: h.minId ?? 0, limit: h.limit ?? IMPORT_LIMIT });
    return rows.map((m) => toUserInbound(m, account)).filter((m): m is InboundMessage => m !== null && m.chatId === chatId);
  };

  return {
    channel: "telegram_user",
    account,

    async start() {
      try {
        const me = await client.connect();
        if (String(me.id) !== account) throw new AdapterError("logged_out", "the session belongs to another Telegram account than its folder");
        await refreshAllowed();
        await client.listen(onMessage, onError);
      } catch (err) {
        throw toUserAdapterError(err);
      }
    },

    async poll(p: PollOptions): Promise<PollBatch> {
      try {
        await refreshAllowed();
        const out: InboundMessage[] = [];
        // After a restart or an overflowed queue, the linked chats are read from the cursor: nothing between is lost.
        if (catchUp && p.cursor) {
          const since = new Date(Date.now() - IMPORT_DAYS * 86_400_000);
          for (const chat of allowed) out.push(...(await history(chat, { since, minId: Number(p.cursor), limit: IMPORT_LIMIT })));
        }
        catchUp = false;
        if (out.length === 0 && queue.length === 0 && !failure) await wait(p.timeoutSec * 1000, wake, p.signal);
        if (failure) {
          const f = failure;
          failure = null;
          throw f;
        }
        // Drained against the allow-list read above: a chat unlinked since its message was queued never reaches ingest.
        out.push(...queue.splice(0, Math.max(0, p.limit - out.length)).filter((m) => allowed.has(m.chatId)));
        const top = out.reduce((n, m) => Math.max(n, Number(m.remoteMessageId)), Number(p.cursor ?? 0));
        return { messages: out, cursor: top > 0 ? String(top) : p.cursor };
      } catch (err) {
        throw toUserAdapterError(err);
      }
    },

    async dialogs(limit: number) {
      try {
        return (await client.dialogs(limit)).filter(isPerson).map((d) => ({ chatId: String(d.id), title: d.displayName, username: d.username, phone: telegramPhone(d.phoneNumber) }));
      } catch (err) {
        throw toUserAdapterError(err);
      }
    },

    async history(chatId, h) {
      try {
        return await history(chatId, h);
      } catch (err) {
        throw toUserAdapterError(err);
      }
    },

    refreshAllowed,

    // Once, no retry (decision 0036 point 7): a failure is the door's to record; the owner presses Send again if he wants.
    async send(draft: ConfirmedDraft): Promise<SentReceipt> {
      if (!isConfirmed(draft)) throw new AdapterError("unknown", "not_confirmed: send accepts only a ConfirmedDraft");
      if (draft.channel !== "telegram_user") throw new AdapterError("unknown", `adapter_mismatch: the draft is ${draft.channel}`);
      try {
        await refreshAllowed();
        if (!allowed.has(draft.chatId)) throw new AdapterError("unknown", "chat_not_allowed: the chat is not linked");
        const m = await client.sendText(Number(draft.chatId), draft.text);
        return { remoteMessageId: String(m.id), at: m.date.toISOString() };
      } catch (err) {
        throw toUserAdapterError(err);
      }
    },

    async close() {
      wake.fn?.();
      await client.close();
    },
  };
}

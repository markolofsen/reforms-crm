import { AdapterError, type InboundMessage, type MessengerAdapter, type PollBatch, type PollOptions, type SendingAdapter, type SentReceipt } from "./adapter";
import { isConfirmed, type ConfirmedDraft } from "./confirmed";
import type { DialogIdentity } from "./autolink";
import { redact } from "./poller";
import { IMPORT_LIMIT, QUEUE_MAX, type UserDialog } from "./telegram-user";
import type { WaAuthFiles } from "./whatsapp-auth";

/**
 * WhatsApp as a linked device (P71 M5, decision 0036): the owner's own number, linked like WhatsApp Web by a QR code he scans
 * with his phone. Baileys pushes events over a socket; this adapter buffers the linked chats' messages in a bounded in-memory
 * queue that `poll` drains, so `runPoller`, the persisted cursor and the backoff stay the one path the Telegram accounts use.
 * Baileys is loaded only in `whatsapp-api.ts`; everything here works over the small `WaSocket` interface, which tests satisfy
 * with `FakeWaSocket`.
 *
 * Privacy (0036 point 3): a message of a chat that is not on the allow-list is dropped in the event handler, before the queue. Of
 * such a chat only its number, its name and the key and time of its newest message (never a text) are held in this process's
 * memory, for the picker and as the anchor of the import's history request; nothing of it is written, counted or logged, and the
 * directory goes with the process or the disconnect. Only private chats with a person are read (no groups, broadcasts,
 * newsletters, status). Unlike mtcute, Baileys does not reconnect by itself: a closed socket is rebuilt by the next poll, one
 * socket at a time (a connect in flight is shared, never doubled), and a 515 restart is rebuilt at once over the same auth store.
 */

/** Who is signed in: the account is the number's digits (the session folder's name), `name` the owner's WhatsApp name. */
export interface WaMe {
  account: string;
  name: string;
}

/** A message as the hub reads it; `whatsapp-api.ts` maps Baileys' `WAMessage` onto it (null there for anything not a person's chat). */
export interface WaMessage {
  id: string;
  /** The chat's number, `+` and digits (`normalizeIdentifier("whatsapp")`). */
  chatId: string;
  fromMe: boolean;
  at: Date;
  text: string;
  /** `text` or the media's kind (`image`, `audio`, ...); null for a message with nothing to keep (a reaction, a protocol message). */
  kind: string | null;
}

export interface WaChat {
  chatId: string;
  name: string | null;
}

export type WaConnection =
  | { state: "qr"; qr: string }
  /** The phone has just scanned the code: the creds hold the account now (Baileys then closes with 515, restart required). */
  | { state: "paired"; me: WaMe }
  | { state: "open"; me: WaMe }
  /** `reason`: Baileys' own words and the closing node's tag and attributes (`Stream Errored (conflict): conflict type=device_removed`), redacted; it reaches `last_error`. */
  | { state: "close"; code: number | null; reason?: string | null };

export interface WaEvents {
  connection(u: WaConnection): void;
  /** `history` for a history sync (the first after pairing, or the answer to `requestHistory`), `live` for everything else. */
  messages(ms: WaMessage[], source: "live" | "history"): void;
  chats(cs: WaChat[]): void;
}

/** What the hub needs of one Baileys socket. A socket connects on creation; `listen` is called right after. */
export interface WaSocket {
  listen(e: WaEvents): void;
  /** One plain text to a private chat (P71 M5): only the adapter's `send` calls it, with a confirmed draft. */
  sendText(chatId: string, text: string): Promise<{ id: string; at: Date }>;
  /** Asks the phone for up to `count` messages older than `anchor` in this chat; they arrive as a `history` batch. */
  requestHistory(chatId: string, anchor: WaAnchor, count: number): Promise<void>;
  /** Unlinks the device on WhatsApp's side (it leaves the phone's Linked devices list). */
  logout(): Promise<void>;
  close(): Promise<void>;
}

/** Builds a socket over an auth store: the real one in `whatsapp-api.ts`, `FakeWaSocket` in tests. */
export type WaSocketFactory = (auth: WaAuthFiles) => WaSocket;

/** The key and time of a chat's newest message: no text. */
export interface WaAnchor {
  id: string;
  fromMe: boolean;
  at: Date;
}

/** How long `start` waits for the socket to open, and the import for the phone's history answer. */
export const WA_OPEN_MS = 60_000;
export const WA_HISTORY_MS = 15_000;
/** The directory of private chats the picker reads, newest first; past it the oldest entries go. */
export const WA_DIRECTORY_MAX = 2000;

/** Baileys' `DisconnectReason` codes the mapping reads (`@hapi/boom` status codes). */
export const WA_CODES = { loggedOut: 401, forbidden: 403, connectionReplaced: 440, multideviceMismatch: 411, badSession: 500, restartRequired: 515, timedOut: 408, connectionClosed: 428, unavailable: 503, rateLimited: 429 } as const;

const NETWORK = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH|socket|timed? ?out|connection/i;

/** A Boom error's status code, by shape (this file never imports Baileys or Boom). */
const statusOf = (err: unknown): number | null => {
  if (typeof err !== "object" || err === null) return null;
  const output: unknown = Reflect.get(err, "output");
  const code: unknown = typeof output === "object" && output !== null ? Reflect.get(output, "statusCode") : Reflect.get(err, "statusCode");
  return typeof code === "number" ? code : null;
};

/**
 * Maps a close code or a thrown error to an `AdapterError`. The message carries the code only, never a chat, a name or a text: the
 * line reaches `messenger_accounts.last_error` and `/api/health`. 401 (logged out on the phone), 411 and 500 (a session WhatsApp no
 * longer accepts) park the account as `logged_out`; 403 parks it as `banned`; 440 (the session was opened elsewhere) stops it
 * without a park; 429 waits; the rest is the network's, retried with the backoff.
 */
export function toWaAdapterError(err: unknown, closeCode?: number | null, detail?: string | null): AdapterError {
  if (err instanceof AdapterError) return err;
  const code = closeCode ?? statusOf(err);
  if (code !== null && code !== undefined) {
    // WhatsApp's own reason, when the close carried one: what the next 401 says about why.
    const why = detail ? ` [${detail}]` : "";
    if (code === WA_CODES.loggedOut) return new AdapterError("logged_out", `whatsapp 401: logged out (the device was removed or the session ended)${why}`);
    if (code === WA_CODES.multideviceMismatch || code === WA_CODES.badSession) return new AdapterError("logged_out", `whatsapp ${code}: the session is no longer valid${why}`);
    if (code === WA_CODES.forbidden) return new AdapterError("banned", `whatsapp 403: the number is banned or restricted${why}`);
    if (code === WA_CODES.connectionReplaced) return new AdapterError("conflict", `whatsapp 440: the session was opened in another place (connection replaced)${why}`);
    if (code === WA_CODES.rateLimited) return new AdapterError("rate_limited", `whatsapp 429: rate limited${why}`, 60_000);
    return new AdapterError("network", `whatsapp ${code}: the connection closed${why}`);
  }
  const name = err instanceof Error ? err.name : "Error";
  const msg = err instanceof Error ? err.message : String(err);
  if (NETWORK.test(`${name} ${msg}`)) return new AdapterError("network", redact(`${name}: ${msg}`).slice(0, 200));
  return new AdapterError("unknown", name.slice(0, 60));
}

/** Maps a hub message to a stored one; a message with nothing to keep is null. */
export function toWaInbound(m: WaMessage, account: string): InboundMessage | null {
  if (!m.kind) return null;
  return { channel: "whatsapp", account, chatId: m.chatId, remoteMessageId: m.id, kind: m.kind, text: m.text, sentAt: m.at.toISOString(), direction: m.fromMe ? "out" : "in" };
}

export interface WhatsAppOptions {
  /** Builds a socket over the account's stored auth state; called by `start` and again after each close the poll recovers from. */
  socket: () => WaSocket;
  /** The number's digits (the session folder's name): `start` refuses a session that belongs to another number. */
  account: string;
  /** The chat ids on the allow-list of this channel, read before each poll so a link or unlink applies within one poll. */
  allowedChats: () => Promise<string[]>;
  /** P84: told the identity (number, name; never the text) of each private chat seen that is not linked, and whether the message was the client's. See `TelegramUserOptions`. */
  onUnlinked?: (d: DialogIdentity, inbound: boolean) => void;
  queueMax?: number;
  openMs?: number;
  historyMs?: number;
}

export interface WhatsAppAdapter extends MessengerAdapter {
  readonly channel: "whatsapp";
  /** The picker's list (0036 point 3): the private chats seen since the socket opened, newest first. Memory only. */
  dialogs(limit: number): Promise<UserDialog[]>;
  /** The import on link: asks the phone for the chat's history before its newest message and waits for the answer. */
  history(chatId: string, o: { since: Date; limit?: number }): Promise<InboundMessage[]>;
  refreshAllowed(): Promise<void>;
  /** Unlinks the device on WhatsApp's side (Disconnect); nothing when not connected. */
  logout(): Promise<void>;
  close(): Promise<void>;
}

/** The same adapter with its send: what the server's send door is handed, and nothing else. */
export type WhatsAppSendingAdapter = WhatsAppAdapter & SendingAdapter & { readonly channel: "whatsapp"; send(draft: ConfirmedDraft): Promise<SentReceipt> };

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

interface Entry {
  name: string | null;
  newest: WaAnchor | null;
}

export function createWhatsAppAdapter(o: WhatsAppOptions): WhatsAppSendingAdapter {
  const { account } = o;
  const self = `+${account}`;
  const max = o.queueMax ?? QUEUE_MAX;
  let allowed = new Set<string>();
  let queue: InboundMessage[] = [];
  let failure: AdapterError | null = null;
  let sock: WaSocket | null = null;
  /** The connect in flight: `poll` and `history` share it, so two sockets over one auth state never exist at once. */
  let connecting: Promise<void> | null = null;
  let closed = false;
  const wake: { fn: (() => void) | null } = { fn: null };
  const directory = new Map<string, Entry>();
  const waiters = new Map<string, (ms: InboundMessage[]) => void>();

  const refreshAllowed = async () => {
    allowed = new Set(await o.allowedChats());
  };
  const note = (chatId: string, patch: Partial<Entry>) => {
    const cur = directory.get(chatId) ?? { name: null, newest: null };
    directory.delete(chatId);
    directory.set(chatId, { name: patch.name ?? cur.name, newest: patch.newest && (!cur.newest || patch.newest.at >= cur.newest.at) ? patch.newest : cur.newest });
    while (directory.size > WA_DIRECTORY_MAX) directory.delete(directory.keys().next().value ?? "");
  };

  const onMessages = (ms: WaMessage[], source: "live" | "history") => {
    const byChat = new Map<string, InboundMessage[]>();
    for (const m of ms) {
      // The owner's chat with himself ("Message yourself") is not a client's.
      if (m.chatId === self) continue;
      note(m.chatId, { newest: { id: m.id, fromMe: m.fromMe, at: m.at } });
      const msg = toWaInbound(m, account);
      if (msg && !allowed.has(msg.chatId)) {
        // P84: the chat's number and name (never its text) go to the autolink matcher.
        try {
          o.onUnlinked?.({ chatId: msg.chatId, title: directory.get(msg.chatId)?.name ?? msg.chatId, phone: msg.chatId, username: null }, !m.fromMe);
        } catch {
          // The matcher's failure never stops the receiver.
        }
      }
      // An unlinked chat stops here: its text is not kept, counted or written (0036 point 3).
      if (!msg || !allowed.has(msg.chatId)) continue;
      const list = byChat.get(msg.chatId) ?? [];
      list.push(msg);
      byChat.set(msg.chatId, list);
    }
    for (const [chatId, list] of byChat) {
      const waiter = source === "history" ? waiters.get(chatId) : undefined;
      if (waiter) {
        waiters.delete(chatId);
        waiter(list);
        continue;
      }
      for (const msg of list) {
        if (queue.length >= max) queue = [];
        queue.push(msg);
      }
    }
    if (byChat.size) wake.fn?.();
  };
  const onChats = (cs: WaChat[]) => {
    for (const c of cs) if (c.chatId !== self) note(c.chatId, { name: c.name });
  };

  /** Opens a socket and waits for `open`; the close that comes instead is mapped. Later closes become the next poll's failure. */
  const connectOnce = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const s = o.socket();
      let opened = false;
      const timer = setTimeout(() => {
        if (opened) return;
        void s.close().catch(() => undefined);
        reject(new AdapterError("network", "whatsapp: the connection did not open in time"));
      }, o.openMs ?? WA_OPEN_MS);
      s.listen({
        connection(u) {
          if (u.state === "open") {
            if (opened) return;
            opened = true;
            clearTimeout(timer);
            if (closed) {
              // The adapter closed while this socket was opening: it is not kept.
              void s.close().catch(() => undefined);
              reject(new AdapterError("network", "whatsapp: closed while connecting"));
              return;
            }
            if (u.me.account !== account) {
              void s.close().catch(() => undefined);
              reject(new AdapterError("logged_out", "the session belongs to another WhatsApp number than its folder"));
              return;
            }
            sock = s;
            resolve();
          } else if (u.state === "close") {
            const err = toWaAdapterError(null, u.code ?? WA_CODES.connectionClosed, u.reason);
            if (!opened) {
              clearTimeout(timer);
              void s.close().catch(() => undefined);
              // 515 right at the start is Baileys' own restart: one more socket over the same store, not a failure.
              if (u.code === WA_CODES.restartRequired && !closed) connectOnce().then(resolve, reject);
              else reject(err);
              return;
            }
            // A socket already replaced says nothing about the live one.
            if (sock !== s) return;
            sock = null;
            if (closed) return;
            // A restart is not an error: the next poll opens a new socket. Anything else is the next poll's failure.
            if (u.code !== WA_CODES.restartRequired && (err.fatal || !failure)) failure = err;
            wake.fn?.();
          } else if (u.state === "qr") {
            // A stored session that asks for a QR code was unlinked: it needs a new scan (the QR itself is never kept here).
            if (opened) return;
            clearTimeout(timer);
            void s.close().catch(() => undefined);
            reject(new AdapterError("logged_out", "whatsapp: the session asks for a new QR code"));
          }
        },
        messages: onMessages,
        chats: onChats,
      });
    });

  const connect = (): Promise<void> => {
    connecting ??= connectOnce().finally(() => {
      connecting = null;
    });
    return connecting;
  };
  const ensure = async () => {
    if (!sock && !closed) await connect();
  };

  return {
    channel: "whatsapp",
    account,

    async start() {
      try {
        await refreshAllowed();
        if (!sock) await connect();
      } catch (err) {
        throw toWaAdapterError(err);
      }
    },

    async poll(p: PollOptions): Promise<PollBatch> {
      try {
        await refreshAllowed();
        if (failure) {
          const f = failure;
          failure = null;
          throw f;
        }
        await ensure();
        if (queue.length === 0) await wait(p.timeoutSec * 1000, wake, p.signal);
        if (failure) {
          const f = failure;
          failure = null;
          throw f;
        }
        // Drained against the allow-list read above: a chat unlinked since its message was queued never reaches ingest.
        const out = queue.splice(0, p.limit).filter((m) => allowed.has(m.chatId));
        // WhatsApp ids are not ordered: the cursor is the newest message time (seconds). After a restart WhatsApp itself delivers
        // what arrived while the device was offline; the hub does not read history from it.
        const top = out.reduce((n, m) => Math.max(n, Math.floor(Date.parse(m.sentAt) / 1000)), Number(p.cursor ?? 0));
        return { messages: out, cursor: top > 0 ? String(top) : p.cursor };
      } catch (err) {
        throw toWaAdapterError(err);
      }
    },

    async dialogs(limit: number) {
      return [...directory.entries()]
        .sort((a, b) => (b[1].newest?.at.getTime() ?? 0) - (a[1].newest?.at.getTime() ?? 0))
        .slice(0, limit)
        .map(([chatId, e]) => ({ chatId, title: e.name ?? chatId, username: null, phone: chatId, last: e.newest ? { at: e.newest.at.toISOString(), inbound: !e.newest.fromMe } : null }));
    },

    async history(chatId, h) {
      const anchor = directory.get(chatId)?.newest;
      if (!anchor) return [];
      try {
        await ensure();
        if (!sock) return [];
        const s = sock;
        const answer = new Promise<InboundMessage[]>((resolve) => {
          const t = setTimeout(() => {
            waiters.delete(chatId);
            resolve([]);
          }, o.historyMs ?? WA_HISTORY_MS);
          waiters.set(chatId, (ms) => {
            clearTimeout(t);
            resolve(ms);
          });
        });
        await s.requestHistory(chatId, anchor, h.limit ?? IMPORT_LIMIT);
        return (await answer).filter((m) => Date.parse(m.sentAt) >= h.since.getTime());
      } catch (err) {
        waiters.delete(chatId);
        throw toWaAdapterError(err);
      }
    },

    refreshAllowed,

    // Once, no retry (decision 0036 point 7): a failure is the door's to record; the owner presses Send again if he wants.
    async send(draft: ConfirmedDraft): Promise<SentReceipt> {
      if (!isConfirmed(draft)) throw new AdapterError("unknown", "not_confirmed: send accepts only a ConfirmedDraft");
      if (draft.channel !== "whatsapp") throw new AdapterError("unknown", `adapter_mismatch: the draft is ${draft.channel}`);
      try {
        await refreshAllowed();
        if (!allowed.has(draft.chatId)) throw new AdapterError("unknown", "chat_not_allowed: the chat is not linked");
        if (!sock) throw new AdapterError("network", "whatsapp: not connected right now");
        const m = await sock.sendText(draft.chatId, draft.text);
        return { remoteMessageId: m.id, at: m.at.toISOString() };
      } catch (err) {
        throw toWaAdapterError(err);
      }
    },

    async logout() {
      await sock?.logout();
    },

    async close() {
      closed = true;
      wake.fn?.();
      directory.clear();
      const s = sock;
      sock = null;
      await s?.close();
    },
  };
}

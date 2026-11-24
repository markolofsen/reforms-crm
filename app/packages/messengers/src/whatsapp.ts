import { ops } from "@hub/log/ops";
import { AdapterError, type InboundMessage, type MessengerAdapter, type PollBatch, type PollOptions, type SendingAdapter, type SentReceipt } from "./adapter";
import { isConfirmed, type ConfirmedDraft } from "./confirmed";
import type { DialogIdentity } from "./autolink";
import { IMPORT_LIMIT, QUEUE_MAX, type UserDialog } from "./telegram-user";
import { createWaDirectory, historyAnchor } from "./whatsapp-directory";
import { toWaAdapterError, WA_CODES, WA_HISTORY_MS, WA_OPEN_MS, type WaAddress, type WaAnchor, type WaChat, type WaMessage, type WaSocket } from "./whatsapp-socket";

/**
 * WhatsApp as a linked device (P71 M5, decision 0036): the owner's own number, linked like WhatsApp Web by a QR code he scans
 * with his phone. Baileys pushes events over a socket; this adapter buffers the chats' messages in a bounded in-memory queue that
 * `poll` drains, so `runPoller`, the persisted cursor and the backoff stay the one path the Telegram accounts use. Baileys is
 * loaded only in `whatsapp-api.ts`; everything here works over the small `WaSocket` interface, which tests satisfy with
 * `FakeWaSocket` (the socket's interface and its error mapping are `whatsapp-socket.ts`, the chats' memory `whatsapp-directory.ts`).
 *
 * Privacy (decision 0049, which amends 0036 point 3): messages are a 30-day cache. With `cacheUnlinked` every private chat's
 * messages reach ingest, which keeps those of a linked chat and of a chat that wrote and is not hidden ("not a client"), and drops
 * the rest; without it a chat that is not linked stops in the event handler, as before. The directory (a chat's number, its real
 * address, its name and the key and time of its newest message; never a text) lives in this process's memory for the picker and
 * goes with the process or the disconnect. Only private chats with a person are read (no groups, broadcasts, newsletters,
 * status). Unlike mtcute, Baileys does not reconnect by itself: a closed socket is rebuilt by the next poll, one socket at a time
 * (a connect in flight is shared, never doubled), and a 515 restart is rebuilt at once over the same auth store.
 */

const log = ops("whatsapp");

/** Maps a hub message to a stored one; a message with nothing to keep is null. */
export function toWaInbound(m: WaMessage, account: string, backfill = false): InboundMessage | null {
  if (!m.kind) return null;
  return {
    channel: "whatsapp",
    account,
    chatId: m.chatId,
    remoteMessageId: m.id,
    kind: m.kind,
    text: m.text,
    sentAt: m.at.toISOString(),
    direction: m.fromMe ? "out" : "in",
    ...(m.jid ? { chatJid: m.jid } : {}),
    // Who the chat is (P141 U3), for its known row: its number (a `lid:` chat hides it) and the name the person set. Never logged.
    ...(m.chatId.startsWith("lid:") ? {} : { chatPhone: m.chatId }),
    ...(m.pushName && !m.fromMe ? { profileName: m.pushName } : {}),
    ...(m.editOf ? { editOf: m.editOf } : {}),
    ...(backfill ? { backfill: true } : {}),
  };
}

/** A known chat as the adapter reads it before each poll: its chat id, the real address stored on its row, and whether it is linked. */
export interface WaKnownChat {
  chatId: string;
  jid: string | null;
  linked: boolean;
}

export interface WhatsAppOptions {
  /** Builds a socket over the account's stored auth state; called by `start` and again after each close the poll recovers from. */
  socket: () => WaSocket;
  /** The number's digits (the session folder's name): `start` refuses a session that belongs to another number. */
  account: string;
  /** The known chats of this channel, read before each poll so a link or a hide applies within one poll. */
  knownChats: () => Promise<WaKnownChat[]>;
  /** P84: told the identity (number, name; never the text) of each private chat seen that is not linked, and whether the message was the client's. See `TelegramUserOptions`. */
  onUnlinked?: (d: DialogIdentity, inbound: boolean) => void;
  /**
   * Decision 0049 (P141 W2): every private chat's messages are handed to ingest, which caches the unlinked ones that wrote and are
   * not hidden. Off: an unlinked chat's messages stop here.
   */
  cacheUnlinked?: boolean;
  /** The cache's window in days: a history message older than this is not queued (it would get a fresh TTL; decision 0049 point 1). */
  cacheDays?: number;
  /** P141 W3: the chat's messages since a time, from the Mac's WhatsApp app (read only), or none when that source is off. */
  appHistory?: (chat: WaAddress, since: Date) => InboundMessage[];
  queueMax?: number;
  openMs?: number;
  historyMs?: number;
}

export interface WhatsAppAdapter extends MessengerAdapter {
  readonly channel: "whatsapp";
  /** The cache's TTL of this account's rows (decision 0049), when the server set one. */
  readonly cacheDays?: number;
  /** The picker's list (0036 point 3): the private chats seen since the socket opened, newest first. Memory only. */
  dialogs(limit: number): Promise<UserDialog[]>;
  /**
   * A chat's history since a time (on link, on open): what the Mac's WhatsApp app holds, returned now, and a request to the phone
   * for what came before `before` (the chat's oldest cached message, P141 verdict 1), whose answer reaches ingest through `poll`.
   */
  history(chatId: string, o: { since: Date; limit?: number; before?: WaAnchor | null }): Promise<InboundMessage[]>;
  refreshKnown(): Promise<void>;
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

/** A callback whose failure must never stop the receiver. */
const safely = (fn: () => void): void => {
  try {
    fn();
  } catch {
    // ignored
  }
};

export function createWhatsAppAdapter(o: WhatsAppOptions): WhatsAppSendingAdapter {
  const { account } = o;
  const self = `+${account}`;
  const max = o.queueMax ?? QUEUE_MAX;
  let known = new Map<string, string | null>();
  let linked = new Set<string>();
  let queue: InboundMessage[] = [];
  let failure: AdapterError | null = null;
  let sock: WaSocket | null = null;
  /** The connect in flight: `poll` and `history` share it, so two sockets over one auth state never exist at once. */
  let connecting: Promise<void> | null = null;
  let closed = false;
  const wake: { fn: (() => void) | null } = { fn: null };
  const directory = createWaDirectory();
  /** The history requests still open, by chat: a timer that leaves one ops line when the phone never answers. */
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const settle = (chatId: string) => (clearTimeout(pending.get(chatId)), pending.delete(chatId));

  const refreshKnown = async () => {
    const rows = await o.knownChats();
    known = new Map(rows.map((c) => [c.chatId, c.jid]));
    linked = new Set(rows.filter((c) => c.linked).map((c) => c.chatId));
  };
  const addressOf = (chatId: string): WaAddress => ({ chatId, jid: directory.get(chatId)?.jid ?? known.get(chatId) ?? null });

  const onMessages = (ms: WaMessage[], source: "live" | "history") => {
    const oldest = o.cacheDays ? Date.now() - o.cacheDays * 86_400_000 : null;
    let queued = 0;
    for (const raw of ms) {
      const m = { ...raw, chatId: directory.place(raw.chatId) };
      // The owner's chat with himself ("Message yourself") is not a client's.
      if (m.chatId === self) continue;
      if (source === "history") settle(m.chatId);
      directory.note(m.chatId, { newest: { id: m.editOf ?? m.id, fromMe: m.fromMe, at: m.at }, ...(m.jid ? { jid: m.jid } : {}), ...(m.pushName ? { pushName: m.pushName } : {}) });
      const mapped = toWaInbound(m, account, source === "history");
      const title = directory.titleOf(m.chatId);
      const msg = mapped && title && title !== m.chatId ? { ...mapped, chatTitle: title } : mapped;
      // P84: the chat's number and name (never its text) go to the autolink matcher. Its failure never stops the receiver.
      if (msg && !linked.has(m.chatId)) safely(() => o.onUnlinked?.({ chatId: m.chatId, title, phone: m.chatId.startsWith("lid:") ? null : m.chatId, username: null }, !m.fromMe));
      if (!msg) continue;
      // Without the cache an unknown chat stops here; with it, ingest decides (decision 0049).
      if (!known.has(m.chatId) && !o.cacheUnlinked) continue;
      if (source === "history" && oldest !== null && m.at.getTime() < oldest) continue;
      // Bounded: past the cap the oldest queued message goes (the Mac's app or the phone has it).
      if (queue.length >= max) queue.shift();
      queue.push(msg);
      queued++;
    }
    if (queued) wake.fn?.();
  };
  const onChats = (cs: WaChat[]) => {
    for (const c of cs) if (c.chatId !== self) directory.learn(c);
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
    ...(o.cacheDays ? { cacheDays: o.cacheDays } : {}),

    async start() {
      try {
        await refreshKnown();
        if (!sock) await connect();
      } catch (err) {
        throw toWaAdapterError(err);
      }
    },

    async poll(p: PollOptions): Promise<PollBatch> {
      try {
        await refreshKnown();
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
        // Drained against the allow-list read above: without the cache, a chat unlinked since its message was queued never reaches
        // ingest; with it, ingest decides by the stored rows.
        const out = queue.splice(0, p.limit).filter((m) => o.cacheUnlinked || known.has(m.chatId));
        // WhatsApp ids are not ordered: the cursor is the newest message time (seconds). After a restart WhatsApp itself delivers
        // what arrived while the device was offline; the hub does not read history from it.
        const top = out.reduce((n, m) => Math.max(n, Math.floor(Date.parse(m.sentAt) / 1000)), Number(p.cursor ?? 0));
        return { messages: out, cursor: top > 0 ? String(top) : p.cursor };
      } catch (err) {
        throw toWaAdapterError(err);
      }
    },

    async dialogs(limit: number) {
      return directory.dialogs(limit);
    },

    async history(chatId, h) {
      const address = addressOf(chatId);
      // The Mac's WhatsApp app first (P141 W3): local, read only, answered now.
      const local = (o.appHistory?.(address, h.since) ?? []).filter((m) => Date.parse(m.sentAt) >= h.since.getTime());
      // The phone's on-demand history (the fallback, verdict 1) answers only what came before its anchor: the oldest message known.
      const first = local[0];
      const anchor = historyAnchor(h.before, first ? { id: first.remoteMessageId, fromMe: first.direction === "out", at: new Date(first.sentAt) } : null, directory.get(chatId)?.newest);
      if (!anchor) return local;
      try {
        await ensure();
        if (!sock) return local;
        settle(chatId);
        const t = setTimeout(() => {
          pending.delete(chatId);
          log.info("the phone did not answer a history request", { account, afterS: Math.round((o.historyMs ?? WA_HISTORY_MS) / 1000) });
        }, o.historyMs ?? WA_HISTORY_MS);
        t.unref?.();
        pending.set(chatId, t);
        // The answer is not awaited: it reaches ingest through `poll` whenever the phone sends it (verdict 2).
        await sock.requestHistory(address, anchor, h.limit ?? IMPORT_LIMIT);
        return local;
      } catch (err) {
        settle(chatId);
        if (local.length) {
          log.warn("the history request to the phone failed; the Mac's WhatsApp app answered", { account, kind: err instanceof Error ? err.name : "Error" });
          return local;
        }
        throw toWaAdapterError(err);
      }
    },

    refreshKnown,

    // Once, no retry (decision 0036 point 7): a failure is the door's to record; the owner presses Send again if he wants.
    async send(draft: ConfirmedDraft): Promise<SentReceipt> {
      if (!isConfirmed(draft)) throw new AdapterError("unknown", "not_confirmed: send accepts only a ConfirmedDraft");
      if (draft.channel !== "whatsapp") throw new AdapterError("unknown", `adapter_mismatch: the draft is ${draft.channel}`);
      try {
        await refreshKnown();
        if (!known.has(draft.chatId)) throw new AdapterError("unknown", "chat_not_known: the chat is not known to the Hub");
        if (!sock) throw new AdapterError("network", "whatsapp: not connected right now");
        const m = await sock.sendText(addressOf(draft.chatId), draft.text);
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
      for (const chatId of [...pending.keys()]) settle(chatId);
      const s = sock;
      sock = null;
      await s?.close();
    },
  };
}

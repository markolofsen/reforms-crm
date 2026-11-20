import { MemoryStorage } from "@mtcute/core";
import { TelegramClient, type Message, type Peer } from "@mtcute/node";
import type { MtClient, MtMessage, MtPeer } from "./telegram-user";
import type { LoginCredentials, MtLoginClient } from "./telegram-user-login";
import type { UserSession } from "./sessions";

/**
 * The real mtcute client (0.32.8, P71 M0 verdict a). The only file that imports mtcute, so tests and types never touch MTProto.
 * Storage is `MemoryStorage`: the session lives in the one file `sessions.ts` writes (`exportSession` / `importSession`), and
 * better-sqlite3 12, which `@mtcute/node` depends on, is never loaded (its build is refused in `pnpm-workspace.yaml`). mtcute's own
 * log is off (level 0): its debug lines may name peers, and nothing of an unlinked chat may reach a log (decision 0036 point 3).
 */

const SILENT = 0;
/** How many dialogs the connect reads to warm the peer cache (the picker shows at most 200). */
const WARM_DIALOGS = 500;

const newClient = (c: LoginCredentials) => new TelegramClient({ apiId: c.apiId, apiHash: c.apiHash, storage: new MemoryStorage(), logLevel: SILENT });

const peerOf = (p: Peer): MtPeer =>
  p.type === "user"
    ? { type: "user", id: p.id, displayName: p.displayName, username: p.username, phoneNumber: p.phoneNumber, isBot: p.isBot, isSelf: p.isSelf }
    : { type: "other", id: p.id, displayName: p.displayName };

const messageOf = (m: Message): MtMessage => ({
  id: m.id,
  date: m.date,
  text: m.text,
  mediaType: m.media?.type ?? null,
  isOutgoing: m.isOutgoing,
  isService: m.isService,
  chat: peerOf(m.chat),
});

/** A client for one login flow. It has no session until `signIn` or `checkPassword` succeeds. */
export function mtcuteLoginClient(c: LoginCredentials): MtLoginClient {
  const tg = newClient(c);
  return {
    async sendCode(phone) {
      const r = await tg.sendCode({ phone });
      if (!("phoneCodeHash" in r)) throw new Error("this client is already signed in");
      return { phoneCodeHash: r.phoneCodeHash };
    },
    async signIn(o) {
      const u = await tg.signIn({ phone: o.phone, phoneCodeHash: o.phoneCodeHash, phoneCode: o.code });
      return { id: u.id, displayName: u.displayName };
    },
    async checkPassword(password) {
      const u = await tg.checkPassword(password);
      return { id: u.id, displayName: u.displayName };
    },
    exportSession: () => tg.exportSession(),
    close: () => tg.destroy(),
  };
}

/** A client restored from a stored session, for the supervisor's one connection per account. */
export function mtcuteSessionClient(s: UserSession): MtClient {
  const tg = newClient(s);
  let handlers: { message: (m: Message) => void; error: (e: Error) => void } | null = null;
  return {
    async connect() {
      await tg.importSession(s.session);
      await tg.connect();
      const me = await tg.getMe();
      // MemoryStorage starts with no peers, and a user id alone cannot be resolved to its access hash: one pass over the dialog
      // list fills mtcute's in-memory peer cache, so the catch-up and the import can read a linked chat. Nothing of it is kept.
      for await (const _d of tg.iterDialogs({ limit: WARM_DIALOGS })) void _d;
      return { id: me.id, displayName: me.displayName };
    },
    async listen(onMessage, onError) {
      handlers = { message: (m) => onMessage(messageOf(m)), error: (e) => onError(e) };
      tg.onNewMessage.add(handlers.message);
      tg.onError.add(handlers.error);
      await tg.startUpdatesLoop();
    },
    async dialogs(limit) {
      const out: MtPeer[] = [];
      for await (const d of tg.iterDialogs({ limit })) out.push(peerOf(d.peer));
      return out;
    },
    async history(chatId, o) {
      const out: MtMessage[] = [];
      for await (const m of tg.iterHistory(chatId, { limit: o.limit, ...(o.minId > 0 ? { minId: o.minId } : {}) })) {
        if (m.date < o.since) break;
        out.push(messageOf(m));
      }
      return out;
    },
    async sendText(chatId, text) {
      const m = await tg.sendText(chatId, text);
      return { id: m.id, date: m.date };
    },
    async close() {
      if (handlers) {
        tg.onNewMessage.remove(handlers.message);
        tg.onError.remove(handlers.error);
      }
      await tg.destroy();
    },
  };
}

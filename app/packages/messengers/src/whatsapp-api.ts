import makeWASocket, {
  Browsers,
  BufferJSON,
  getContentType,
  initAuthCreds,
  isLidUser,
  isPnUser,
  jidDecode,
  normalizeMessageContent,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type Contact,
  type SignalDataTypeMap,
  type WAMessage,
} from "baileys";
import { CREDS, keyName, type WaAuthFiles } from "./whatsapp-auth";
import type { WaChat, WaMe, WaMessage, WaSocket } from "./whatsapp";

/**
 * The real Baileys socket (`baileys` 7.0.0-rc14, P71 M5). The only file that imports Baileys, so tests and types never touch
 * WhatsApp; it is loaded by `baileysSocketFactory()` in `adapter.ts` only when the server has a session or a pairing starts.
 * Building a socket connects to WhatsApp at once: no test calls `baileysSocket` (they import this file only for its pure mappings).
 *
 * The options are privacy rules, not tuning: Baileys' own log is silent (its lines print event payloads, and nothing of an
 * unlinked chat may reach a log, decision 0036 point 3); `shouldIgnoreJid` drops every chat that is not a person (groups,
 * broadcasts, newsletters, status) before an event is built; `markOnlineOnConnect: false` keeps the owner's phone ringing for new
 * messages; `syncFullHistory: false` asks the phone for the recent history only.
 */

const noop = () => undefined;
interface SilentLogger {
  level: string;
  child(obj: Record<string, unknown>): SilentLogger;
  trace(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}
const SILENT: SilentLogger = { level: "silent", child: () => SILENT, trace: noop, debug: noop, info: noop, warn: noop, error: noop };

/** A person's chat as the hub names it: `+` and the number's digits. A LID chat is read through its phone alias, else dropped. */
export function chatIdOf(jid: string | null | undefined, alt?: string | null): string | null {
  const pn = isPnUser(jid ?? undefined) ? jid : isLidUser(jid ?? undefined) && isPnUser(alt ?? undefined) ? alt : null;
  const user = pn ? jidDecode(pn)?.user : undefined;
  return user && /^\d{7,15}$/.test(user) ? `+${user}` : null;
}
const jidOf = (chatId: string) => `${chatId.replace(/^\+/, "")}@s.whatsapp.net`;

/** Messages that carry nothing to keep: protocol frames, reactions, receipts of a poll, key distribution. */
const NOT_CONTENT = new Set(["protocolMessage", "reactionMessage", "senderKeyDistributionMessage", "messageContextInfo", "pollUpdateMessage", "keepInChatMessage", "encReactionMessage", "pinInChatMessage"]);

const secondsOf = (t: WAMessage["messageTimestamp"]): number => (typeof t === "number" ? t : t ? Number(t.toString()) : 0);

/** Maps Baileys' `WAMessage` to the hub's; null for anything but a person's private chat. Media bytes are never fetched. */
export function fromBaileys(m: WAMessage): WaMessage | null {
  const key = m.key;
  if (!key?.id) return null;
  const chatId = chatIdOf(key.remoteJid, key.remoteJidAlt);
  if (!chatId) return null;
  const content = normalizeMessageContent(m.message);
  const type = content ? getContentType(content) : undefined;
  let kind: string | null = null;
  let text = "";
  if (type && !NOT_CONTENT.has(type)) {
    if (type === "conversation" || type === "extendedTextMessage") {
      text = content?.conversation ?? content?.extendedTextMessage?.text ?? "";
      kind = text ? "text" : null;
    } else {
      kind = type.replace(/Message$/, "");
      text = content?.imageMessage?.caption ?? content?.videoMessage?.caption ?? content?.documentMessage?.caption ?? "";
    }
  }
  return { id: key.id, chatId, fromMe: key.fromMe === true, at: new Date(secondsOf(m.messageTimestamp) * 1000), text, kind };
}

const meOf = (c: Contact | undefined): WaMe | null => {
  const user = jidDecode(c?.id)?.user;
  return user && /^\d{7,20}$/.test(user) ? { account: user, name: c?.name ?? c?.notify ?? "" } : null;
};

const chatOf = (id: string | null | undefined, name: string | null | undefined, alt?: string | null): WaChat | null => {
  const chatId = chatIdOf(id, alt);
  return chatId ? { chatId, name: name ?? null } : null;
};

/** Baileys' auth state over the hub's store: every value serialized with `BufferJSON`, one file each (`whatsapp-auth.ts`). */
export function authStateOf(store: WaAuthFiles): AuthenticationState {
  const raw = store.get(CREDS);
  const creds: AuthenticationCreds = raw ? (JSON.parse(raw, BufferJSON.reviver) as AuthenticationCreds) : initAuthCreds();
  if (!raw) store.set(CREDS, JSON.stringify(creds, BufferJSON.replacer));
  return {
    creds,
    keys: {
      get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
        const out: { [id: string]: SignalDataTypeMap[T] } = {};
        for (const id of ids) {
          const v = store.get(keyName(type, id));
          if (v === undefined) continue;
          const parsed: unknown = JSON.parse(v, BufferJSON.reviver);
          out[id] = (type === "app-state-sync-key" ? proto.Message.AppStateSyncKeyData.fromObject(parsed as object) : parsed) as SignalDataTypeMap[T];
        }
        return out;
      },
      set(data) {
        for (const [type, entries] of Object.entries(data)) for (const [id, value] of Object.entries(entries ?? {})) store.set(keyName(type, id), value === null ? null : JSON.stringify(value, BufferJSON.replacer));
      },
    },
  };
}

/** Saves the creds Baileys changed (it merges the update into `creds` itself). */
export const saveCreds = (store: WaAuthFiles, creds: AuthenticationCreds) => store.set(CREDS, JSON.stringify(creds, BufferJSON.replacer));

/** One real socket over the store. It connects now: only the server's supervisor and the pairing flow build one. */
export function baileysSocket(store: WaAuthFiles): WaSocket {
  const auth = authStateOf(store);
  const sock = makeWASocket({
    auth,
    logger: SILENT,
    browser: Browsers.macOS("Desktop"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldIgnoreJid: (jid) => !(isPnUser(jid) || isLidUser(jid)),
    getMessage: async () => undefined,
  });
  const offs: (() => void)[] = [];
  return {
    listen(e) {
      const on = <K extends Parameters<typeof sock.ev.on>[0]>(event: K, fn: Parameters<typeof sock.ev.on<K>>[1]) => {
        sock.ev.on(event, fn);
        offs.push(() => sock.ev.off(event, fn));
      };
      on("creds.update", () => saveCreds(store, auth.creds));
      on("connection.update", (u) => {
        if (u.qr) e.connection({ state: "qr", qr: u.qr });
        const me = meOf(auth.creds.me);
        if (u.isNewLogin && me) e.connection({ state: "paired", me });
        if (u.connection === "open") {
          const now = meOf(sock.user) ?? me;
          if (now) e.connection({ state: "open", me: now });
        }
        if (u.connection === "close") {
          const err = u.lastDisconnect?.error;
          const output: unknown = err ? Reflect.get(err, "output") : undefined;
          const code: unknown = typeof output === "object" && output !== null ? Reflect.get(output, "statusCode") : undefined;
          e.connection({ state: "close", code: typeof code === "number" ? code : null });
        }
      });
      on("messages.upsert", (u) => e.messages(u.messages.map(fromBaileys).filter((m): m is WaMessage => m !== null), "live"));
      on("messaging-history.set", (h) => {
        e.chats([...h.chats.map((c) => chatOf(c.id, c.name)), ...h.contacts.map((c) => chatOf(c.id, c.name ?? c.notify, c.phoneNumber))].filter((c): c is WaChat => c !== null));
        e.messages(h.messages.map(fromBaileys).filter((m): m is WaMessage => m !== null), "history");
      });
      on("chats.upsert", (cs) => e.chats(cs.map((c) => chatOf(c.id, c.name)).filter((c): c is WaChat => c !== null)));
      on("contacts.upsert", (cs) => e.chats(cs.map((c) => chatOf(c.id, c.name ?? c.notify, c.phoneNumber)).filter((c): c is WaChat => c !== null)));
    },
    async sendText(chatId, text) {
      const m = await sock.sendMessage(jidOf(chatId), { text });
      return { id: m?.key.id ?? "", at: m ? new Date(secondsOf(m.messageTimestamp) * 1000 || Date.now()) : new Date() };
    },
    async requestHistory(chatId, anchor, count) {
      await sock.fetchMessageHistory(count, { remoteJid: jidOf(chatId), id: anchor.id, fromMe: anchor.fromMe }, Math.floor(anchor.at.getTime() / 1000));
    },
    async logout() {
      await sock.logout();
    },
    async close() {
      for (const off of offs.splice(0)) off();
      await sock.end(undefined);
    },
  };
}

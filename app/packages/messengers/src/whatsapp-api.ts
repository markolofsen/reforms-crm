import makeWASocket, {
  Browsers,
  BufferJSON,
  fetchLatestBaileysVersion,
  getContentType,
  initAuthCreds,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isLidUser,
  isPnUser,
  jidDecode,
  jidNormalizedUser,
  normalizeMessageContent,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type Contact,
  type SignalDataTypeMap,
  type WAMessage,
  type WAVersion,
} from "baileys";
import { CREDS, keyName, type WaAuthFiles } from "./whatsapp-auth";
import type { WaAddress, WaChat, WaMe, WaMessage, WaSocket } from "./whatsapp-socket";
import { ops } from "@hub/log/ops";
import { disconnectDetail, waLogger } from "./whatsapp-log";

/**
 * The real Baileys socket (`baileys` 7.0.0-rc14, P71 M5). The only file that imports Baileys, so tests and types never touch
 * WhatsApp; it is loaded by `baileysSocketFactory()` in `adapter.ts` only when the server has a session or a pairing starts.
 * Building a socket connects to WhatsApp at once: no test calls `baileysSocket` (they import this file only for its pure mappings).
 *
 * The options are privacy rules, not tuning: Baileys' log reaches the ops log (P86) at `warn` only, each line redacted by
 * `whatsapp-log.ts` and the ops log's redactor (no jid, number, key or text; decision 0036 point 3); `shouldIgnoreJid` drops every chat that is not a person
 * (groups, broadcasts, newsletters, status) before an event is built; `markOnlineOnConnect: false` keeps the owner's phone ringing
 * for new messages; `syncFullHistory: false` asks the phone for the recent history only. Every close is logged with its code and
 * WhatsApp's reason (`disconnectDetail`), which also reaches `messenger_accounts.last_error`.
 */

const log = ops("whatsapp");
const LOGGER = waLogger();

/** How long the server waits for the current WhatsApp Web version before it uses the one this Baileys release carries. */
const VERSION_MS = 5000;
let latest: Promise<WAVersion | undefined> | null = null;

/**
 * The WhatsApp Web version the sockets announce: the one Baileys' own repository names now (a release pins one that WhatsApp
 * retires within weeks, and a retired one is refused at connect), fetched once per process from GitHub, never from WhatsApp.
 * When the fetch fails or is slow, undefined: Baileys then uses the version it was built with.
 */
export function latestWaVersion(): Promise<WAVersion | undefined> {
  latest ??= Promise.race([
    fetchLatestBaileysVersion().then((r) => {
      if (!r.isLatest) log.warn("the current WhatsApp Web version could not be fetched; using the one Baileys carries");
      return r.isLatest ? r.version : undefined;
    }),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), VERSION_MS).unref()),
  ]).catch(() => undefined);
  return latest;
}

/**
 * A person's chat as the hub names it: `+` and the number's digits. A LID chat (`…@lid`, Baileys 7) is read through its phone alias
 * when the message carries one; without it the chat is `lid:<digits>` (P141 W1, verdict 5): stored, never dropped silently.
 */
export function chatIdOf(jid: string | null | undefined, alt?: string | null): string | null {
  const pn = isPnUser(jid ?? undefined) ? jid : isLidUser(jid ?? undefined) && isPnUser(alt ?? undefined) ? alt : null;
  const user = pn ? jidDecode(pn)?.user : undefined;
  if (user) return /^\d{7,15}$/.test(user) ? `+${user}` : null;
  const lid = isLidUser(jid ?? undefined) ? jidDecode(jid ?? undefined)?.user : undefined;
  return lid && /^\d{1,20}$/.test(lid) ? `lid:${lid}` : null;
}

/** The chat's real address, which WhatsApp files it under: the `@lid` one when the key names one (Defect 4), else the phone JID. */
export function realJidOf(jid: string | null | undefined, alt?: string | null): string | null {
  const lid = isLidUser(jid ?? undefined) ? jid : isLidUser(alt ?? undefined) ? alt : null;
  const out = lid ?? (isPnUser(jid ?? undefined) ? jid : null);
  return out ? jidNormalizedUser(out) : null;
}

/** The address a request names: the stored real JID, else the one the chat id spells (`lid:` → `@lid`, a number → `@s.whatsapp.net`). */
export const jidOf = (chat: WaAddress): string => chat.jid ?? (chat.chatId.startsWith("lid:") ? `${chat.chatId.slice(4)}@lid` : `${chat.chatId.replace(/^\+/, "")}@s.whatsapp.net`);

/** Messages that carry nothing to keep: protocol frames, reactions, receipts of a poll, key distribution. */
const NOT_CONTENT = new Set(["protocolMessage", "reactionMessage", "senderKeyDistributionMessage", "messageContextInfo", "pollUpdateMessage", "keepInChatMessage", "encReactionMessage", "pinInChatMessage"]);

/** Content types that are a person's text, though not `conversation`: a reply to a button, a list or a template. */
const REPLY_TYPES = new Set(["buttonsResponseMessage", "listResponseMessage", "templateButtonReplyMessage"]);
/** The kind a content type is stored as, where it is not the type's own name without `Message`. */
const KIND_OF: Record<string, string> = { pollCreationMessage: "poll", pollCreationMessageV2: "poll", pollCreationMessageV3: "poll", pollCreationMessageV5: "poll" };

const secondsOf = (t: WAMessage["messageTimestamp"]): number => (typeof t === "number" ? t : t ? Number(t.toString()) : 0);

type Content = NonNullable<ReturnType<typeof normalizeMessageContent>>;

/** The text a content of this type carries (P141 W1, verdict 4). Media stays kind-only: a caption is text, the bytes are never read. */
function textOf(c: Content, type: string): string {
  switch (type) {
    case "conversation":
      return c.conversation ?? "";
    case "extendedTextMessage": {
      // A link preview's text may omit the URL it previews: the matched URL is kept.
      const text = c.extendedTextMessage?.text ?? "";
      const url = c.extendedTextMessage?.matchedText ?? "";
      return url && !text.includes(url) ? (text ? `${text}\n${url}` : url) : text;
    }
    case "imageMessage":
      return c.imageMessage?.caption ?? "";
    case "videoMessage":
      return c.videoMessage?.caption ?? "";
    case "documentMessage":
      return c.documentMessage?.caption ?? "";
    case "buttonsResponseMessage":
      return c.buttonsResponseMessage?.selectedDisplayText ?? "";
    case "listResponseMessage":
      return c.listResponseMessage?.title ?? "";
    case "templateButtonReplyMessage":
      return c.templateButtonReplyMessage?.selectedDisplayText ?? "";
    case "contactMessage":
      return c.contactMessage?.displayName ?? "";
    case "locationMessage":
      return [c.locationMessage?.name, c.locationMessage?.address].filter((x): x is string => !!x).join(", ");
    case "pollCreationMessage":
    case "pollCreationMessageV2":
    case "pollCreationMessageV3":
    case "pollCreationMessageV5":
      return (c[type as "pollCreationMessage"] as { name?: string | null } | null | undefined)?.name ?? "";
    default:
      return "";
  }
}

/** Why a Baileys message did not become a hub message: counted in ops by reason, never with a jid or a text (verdict 5). */
export type WaDropReason = "no_chat_id" | "not_private" | "no_kind";

/** Maps Baileys' `WAMessage` to the hub's, or says why not. Media bytes are never fetched. */
export function mapBaileys(m: WAMessage): { message: WaMessage } | { dropped: WaDropReason } {
  const key = m.key;
  const remote = key?.remoteJid ?? undefined;
  if (remote && (isJidGroup(remote) || isJidBroadcast(remote) || isJidNewsletter(remote))) return { dropped: "not_private" };
  const chatId = chatIdOf(remote, key?.remoteJidAlt);
  const jid = realJidOf(remote, key?.remoteJidAlt);
  if (!key?.id || !chatId || !jid) return { dropped: "no_chat_id" };
  const base = { id: key.id, chatId, jid, fromMe: key.fromMe === true, at: new Date(secondsOf(m.messageTimestamp) * 1000), ...(key.fromMe !== true && m.pushName ? { pushName: m.pushName } : {}) };
  const content = normalizeMessageContent(m.message);
  const type = content ? getContentType(content) : undefined;
  if (!content || !type) return { dropped: "no_kind" };
  // An edit (WhatsApp wraps it as `editedMessage` → `protocolMessage` MESSAGE_EDIT): the stored row's text is replaced.
  const p = content.protocolMessage;
  if (type === "protocolMessage" && p?.type === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT && p.key?.id && p.editedMessage) {
    const inner = normalizeMessageContent(p.editedMessage);
    const innerType = inner ? getContentType(inner) : undefined;
    const text = inner && innerType ? textOf(inner, innerType) : "";
    return text ? { message: { ...base, text, kind: "text", editOf: p.key.id } } : { dropped: "no_kind" };
  }
  if (NOT_CONTENT.has(type)) return { dropped: "no_kind" };
  const text = textOf(content, type);
  if (type === "conversation" || type === "extendedTextMessage" || REPLY_TYPES.has(type)) return text ? { message: { ...base, text, kind: "text" } } : { dropped: "no_kind" };
  return { message: { ...base, text, kind: KIND_OF[type] ?? type.replace(/Message$/, "") } };
}

/** Maps Baileys' `WAMessage` to the hub's; null for anything it cannot place or keep (`mapBaileys` says why). */
export function fromBaileys(m: WAMessage): WaMessage | null {
  const r = mapBaileys(m);
  return "message" in r ? r.message : null;
}

/** Maps a batch and counts what did not map, by reason; the line carries counts only (no jid, no text). */
function mapBatch(ms: WAMessage[], what: "live" | "history"): WaMessage[] {
  const out: WaMessage[] = [];
  const dropped: Partial<Record<WaDropReason, number>> = {};
  for (const m of ms) {
    const r = mapBaileys(m);
    if ("message" in r) out.push(r.message);
    else dropped[r.dropped] = (dropped[r.dropped] ?? 0) + 1;
  }
  // A reaction or a receipt is routine; a message that could not be placed in a chat is worth a line.
  if (dropped.no_chat_id) log.warn("messages not mapped to a chat", { source: what, ...dropped });
  return out;
}

const meOf = (c: Contact | undefined): WaMe | null => {
  const user = jidDecode(c?.id)?.user;
  return user && /^\d{7,20}$/.test(user) ? { account: user, name: c?.name ?? c?.notify ?? "" } : null;
};

const chatOf = (id: string | null | undefined, name: string | null | undefined, alt?: string | null): WaChat | null => {
  const chatId = chatIdOf(id, alt);
  return chatId ? { chatId, name: name ?? null, jid: realJidOf(id, alt) } : null;
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
export function baileysSocket(store: WaAuthFiles, version?: WAVersion): WaSocket {
  const auth = authStateOf(store);
  const sock = makeWASocket({
    auth,
    logger: LOGGER,
    ...(version ? { version } : {}),
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
          const reason = disconnectDetail(err);
          // Every close, with WhatsApp's own reason: a logout (401), a ban (403) or a replaced session (440) is an error line.
          const status = typeof code === "number" ? code : null;
          (status === 401 || status === 403 || status === 440 ? log.error : status === 515 ? log.info : log.warn)("socket closed", { status, reason });
          e.connection({ state: "close", code: typeof code === "number" ? code : null, reason });
        }
      });
      /** A `lid:` chat whose phone Baileys' own LID store knows is moved onto the phone's chat id before the hub sees it. */
      const placed = async (ms: WaMessage[]): Promise<WaMessage[]> => {
        for (const m of ms) {
          if (!m.chatId.startsWith("lid:")) continue;
          const pn = await sock.signalRepository.lidMapping.getPNForLID(m.jid ?? `${m.chatId.slice(4)}@lid`).catch(() => null);
          const id = pn ? chatIdOf(jidNormalizedUser(pn)) : null;
          if (id && !id.startsWith("lid:")) m.chatId = id;
        }
        return ms;
      };
      const deliver = (ms: WaMessage[], source: "live" | "history") =>
        void placed(ms)
          .then((placedMs) => e.messages(placedMs, source))
          .catch((err: unknown) => log.warn("a message batch could not be handed on", { source, kind: err instanceof Error ? err.name : "Error" }));
      on("messages.upsert", (u) => deliver(mapBatch(u.messages, "live"), "live"));
      on("messaging-history.set", (h) => {
        e.chats([...h.chats.map((c) => chatOf(c.id, c.name)), ...h.contacts.map((c) => chatOf(c.id, c.name ?? c.notify, c.phoneNumber))].filter((c): c is WaChat => c !== null));
        deliver(mapBatch(h.messages, "history"), "history");
      });
      on("chats.upsert", (cs) => e.chats(cs.map((c) => chatOf(c.id, c.name)).filter((c): c is WaChat => c !== null)));
      on("contacts.upsert", (cs) => e.chats(cs.map((c) => chatOf(c.id, c.name ?? c.notify, c.phoneNumber)).filter((c): c is WaChat => c !== null)));
    },
    async sendText(chat, text) {
      const m = await sock.sendMessage(jidOf(chat), { text });
      return { id: m?.key.id ?? "", at: m ? new Date(secondsOf(m.messageTimestamp) * 1000 || Date.now()) : new Date() };
    },
    async typing(chat) {
      await sock.sendPresenceUpdate("composing", jidOf(chat));
    },
    async requestHistory(chat, anchor, count) {
      // Baileys' `oldestMsgTimestampMs` is milliseconds (P141 Defect 1), and the chat is named by its real JID (Defect 4).
      await sock.fetchMessageHistory(count, { remoteJid: jidOf(chat), id: anchor.id, fromMe: anchor.fromMe }, anchor.at.getTime());
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

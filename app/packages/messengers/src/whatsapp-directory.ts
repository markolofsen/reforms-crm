import type { UserDialog } from "./telegram-user";
import { WA_DIRECTORY_MAX, type WaAnchor, type WaChat } from "./whatsapp-socket";

/**
 * The adapter's memory of the private chats seen since the socket opened (0036 point 3, P141 W1): a chat's number, its real
 * address (`…@lid` when WhatsApp gives one), its contact name, the person's own profile name and the key and time of its newest
 * message. Never a text. It feeds the picker and the history request's anchor, and goes with the process or the disconnect.
 */

export interface WaDirEntry {
  name: string | null;
  /** The sender's own profile name, from their messages: the title when no contact name is known (shown as theirs, P141 verdict 6). */
  pushName: string | null;
  jid: string | null;
  newest: WaAnchor | null;
}

/** What a hidden-number chat is called until its phone is known (P141 verdict 5). */
export const HIDDEN_NUMBER_TITLE = "WhatsApp (number hidden)";

export function createWaDirectory(max = WA_DIRECTORY_MAX) {
  const entries = new Map<string, WaDirEntry>();
  /** `lid:<digits>` → `+<phone>`, learned from a contact event that names both: a hidden number's chat moves onto its phone's. */
  const lids = new Map<string, string>();

  const note = (chatId: string, patch: Partial<WaDirEntry>) => {
    const cur = entries.get(chatId) ?? { name: null, pushName: null, jid: null, newest: null };
    entries.delete(chatId);
    entries.set(chatId, { name: patch.name ?? cur.name, pushName: patch.pushName ?? cur.pushName, jid: patch.jid ?? cur.jid, newest: patch.newest && (!cur.newest || patch.newest.at >= cur.newest.at) ? patch.newest : cur.newest });
    while (entries.size > max) entries.delete(entries.keys().next().value ?? "");
  };
  const titleOf = (chatId: string): string => {
    const e = entries.get(chatId);
    return e?.name ?? e?.pushName ?? (chatId.startsWith("lid:") ? HIDDEN_NUMBER_TITLE : chatId);
  };

  return {
    get: (chatId: string) => entries.get(chatId),
    note,
    titleOf,
    /** The chat id a message is filed under: a `lid:` chat whose phone a contact event named is the phone's chat. */
    place: (chatId: string): string => (chatId.startsWith("lid:") ? (lids.get(chatId) ?? chatId) : chatId),
    /** A chat or contact event: its name, its real address, and the LID-to-phone pair when it names both. */
    learn(c: WaChat) {
      if (c.jid?.endsWith("@lid") && !c.chatId.startsWith("lid:")) lids.set(`lid:${c.jid.replace(/@lid$/, "").replace(/:\d+$/, "")}`, c.chatId);
      note(c.chatId, { name: c.name, ...(c.jid ? { jid: c.jid } : {}) });
    },
    /** The picker's list, newest first. */
    dialogs(limit: number): UserDialog[] {
      return [...entries.entries()]
        .sort((a, b) => (b[1].newest?.at.getTime() ?? 0) - (a[1].newest?.at.getTime() ?? 0))
        .slice(0, limit)
        .map(([chatId, e]) => ({ chatId, title: titleOf(chatId), username: null, phone: chatId.startsWith("lid:") ? null : chatId, last: e.newest ? { at: e.newest.at.toISOString(), inbound: !e.newest.fromMe } : null }));
    },
    clear() {
      entries.clear();
      lids.clear();
    },
  };
}

/**
 * The anchor of WhatsApp's on-demand history (P141 verdict 1): it answers only what came before it, so the oldest message known of
 * the chat: the oldest cached one the caller passes, the oldest the Mac's app supplied, else the newest seen. Null: nothing to ask.
 */
export function historyAnchor(...candidates: (WaAnchor | null | undefined)[]): WaAnchor | null {
  return candidates.reduce<WaAnchor | null>((a, x) => (!x ? a : !a || x.at < a.at ? x : a), null);
}

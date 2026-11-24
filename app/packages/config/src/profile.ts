/**
 * P140 P1b: the one write-precedence rule of the client profile, for every Hub writer of a Clients field (the Hub's own `clients`
 * row, the Notion card at create, the directory's read-back, a merge, a rename) and for the rules the agent follows in its profile
 * refresh. A real name is never replaced by a phone number, an address or a chat id; an Email is never cleared or replaced; a filled
 * Phone, WhatsApp or Telegram is not overwritten. Pure.
 */

/** A phone number however it is spaced (`+966 54 455 5430`, `966544555430`, `(212) 555-0100`). */
const PHONE = /^\+?[\d\s\-().]{6,}$/;
/** A chat id that is not a name: a WhatsApp `lid:` id, a bare Telegram user id. */
const CHAT_ID = /^(lid:\d+|\d+)$/i;
/** The placeholder title a chat-only client gets (P141 verdict 18): "WhatsApp +966…", "Telegram @user". */
const CHANNEL_PLACEHOLDER = /^(whatsapp|telegram)\s+[+@]?[\w.]+$/i;

/**
 * A name that is a person's or a company's: not empty, not an address, not a phone number, not a chat id and not the channel
 * placeholder. `email` is the client's own address, which a name must not repeat.
 */
export function isRealName(name: string | null | undefined, email?: string | null): boolean {
  const n = (name ?? "").trim();
  if (!n || n.includes("@") || PHONE.test(n) || CHAT_ID.test(n) || CHANNEL_PLACEHOLDER.test(n)) return false;
  return !email || n.toLowerCase() !== email.trim().toLowerCase();
}

export type ProfileField = "title" | "email" | "phone" | "whatsapp" | "telegram";

/**
 * What a Hub writer may put into a profile field: `next` when it is better than `current`, else null (write nothing).
 * - `title`: only a real name, and only over an empty title, an address, a phone number, a chat id or the placeholder.
 * - `email`: only into an empty Email; never cleared, never replaced (a second address goes to Other emails).
 * - `phone`, `whatsapp`, `telegram`: only into an empty field.
 */
export function betterValue(field: ProfileField, current: string | null | undefined, next: string | null | undefined): string | null {
  const cur = (current ?? "").trim();
  const nxt = (next ?? "").trim();
  if (!nxt) return null;
  if (field === "title") return isRealName(nxt) && !isRealName(cur) && nxt !== cur ? nxt : null;
  if (field === "email") return !cur && nxt.includes("@") ? nxt.toLowerCase() : null;
  return cur ? null : nxt;
}

/**
 * P141 verdict 18: the title of a client known only by a chat: the person's Telegram display name or WhatsApp profile name when it
 * is a real name, else "WhatsApp +966544555430" or "Telegram @user"; never empty, never the bare number.
 */
export function chatClientTitle(o: { channel: "telegram" | "whatsapp"; name?: string | null; username?: string | null; phone?: string | null; chatId?: string | null }): string {
  if (isRealName(o.name)) return (o.name ?? "").trim();
  if (o.channel === "telegram") {
    const u = o.username?.trim().replace(/^@/, "");
    if (u) return `Telegram @${u}`;
    const digits = (o.phone ?? "").replace(/\D/g, "");
    return digits ? `Telegram +${digits}` : `Telegram ${o.chatId ?? "contact"}`;
  }
  const digits = (o.phone ?? (o.chatId && !o.chatId.startsWith("lid:") ? o.chatId : "") ?? "").replace(/\D/g, "");
  return digits ? `WhatsApp +${digits}` : "WhatsApp (number hidden)";
}

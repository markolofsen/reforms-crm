/**
 * P140 P1b: the one write-precedence rule of the client profile, for every Hub writer of a Clients field (the Hub's own `clients`
 * row, the Notion card at create, the directory's read-back, a merge, a rename) and for the rules the agent follows in its profile
 * refresh. A real name is never replaced by a phone number, an address or a chat id; an Email is never cleared or replaced; a filled
 * Phone, WhatsApp or Telegram is not overwritten. Pure.
 */

/** A phone number however it is spaced (`+966 54 455 5430`, `966544555430`, `(212) 555-0100`), after `plainName`. */
const PHONE = /^\+?[\d\s\-().]{6,}$/;
/** Invisible format characters (Unicode Cf): direction marks and embeddings (U+200E, U+202A to U+202E, U+2066 to U+2069), zero widths, BOM. */
const FORMAT = /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/g;
/** Dashes that are not U+002D (the non-breaking hyphen U+2011 among them), read as one. */
const DASHES = /[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]/g;

/**
 * P143 N2: a name as its characters read, for the tests below and for what a writer stores: WhatsApp and Telegram wrap a number
 * in direction marks and space it with no-break spaces and non-breaking hyphens ("\u202a+55 44 99920\u20119735\u202c"), which the
 * phone test did not see, so a bare number passed as a person's name and no real title could replace it. Pure.
 */
export function plainName(name: string | null | undefined): string {
  return (name ?? "").replace(FORMAT, "").replace(DASHES, "-").replace(/\s+/g, " ").trim();
}
/** A chat id that is not a name: a WhatsApp `lid:` id, a bare Telegram user id. */
const CHAT_ID = /^(lid:\d+|\d+)$/i;
/** The placeholder title a chat-only client gets (P141 verdict 18): "WhatsApp +966…", "Telegram @user". */
const CHANNEL_PLACEHOLDER = /^(whatsapp|telegram)\s+[+@]?[\w.]+$/i;

/**
 * A name that is a person's or a company's: not empty, not an address, not a phone number, not a chat id and not the channel
 * placeholder. `email` is the client's own address, which a name must not repeat.
 */
export function isRealName(name: string | null | undefined, email?: string | null): boolean {
  const n = plainName(name);
  if (!n || n.includes("@") || PHONE.test(n) || CHAT_ID.test(n) || CHANNEL_PLACEHOLDER.test(n)) return false;
  return !email || n.toLowerCase() !== email.trim().toLowerCase();
}

export type ProfileField = "title" | "email" | "phone" | "whatsapp" | "telegram";

/**
 * What a Hub writer may put into a profile field: `next` when it is better than `current`, else null (write nothing).
 * - `title`: a real name, only over an empty title, an address, a phone number, a chat id or the placeholder; the channel
 *   placeholder ("WhatsApp +966…", P141 C5) only over an empty title, a bare phone number or a chat id.
 * - `email`: only into an empty Email; never cleared, never replaced (a second address goes to Other emails).
 * - `phone`, `whatsapp`, `telegram`: only into an empty field.
 */
export function betterValue(field: ProfileField, current: string | null | undefined, next: string | null | undefined): string | null {
  const cur = field === "title" ? plainName(current) : (current ?? "").trim();
  const nxt = field === "title" ? plainName(next) : (next ?? "").trim();
  if (!nxt) return null;
  if (field === "title") {
    if (nxt === cur) return null;
    if (isRealName(nxt)) return isRealName(cur) ? null : nxt;
    return CHANNEL_PLACEHOLDER.test(nxt) && (!cur || PHONE.test(cur) || CHAT_ID.test(cur)) ? nxt : null;
  }
  if (field === "email") return !cur && nxt.includes("@") ? nxt.toLowerCase() : null;
  return cur ? null : nxt;
}

/**
 * P141 verdict 18: the title of a client known only by a chat: the person's Telegram display name or WhatsApp profile name when it
 * is a real name, else "WhatsApp +966544555430" or "Telegram @user"; never empty, never the bare number.
 */
export function chatClientTitle(o: { channel: "telegram" | "whatsapp"; name?: string | null; username?: string | null; phone?: string | null; chatId?: string | null }): string {
  if (isRealName(o.name)) return plainName(o.name);
  if (o.channel === "telegram") {
    const u = o.username?.trim().replace(/^@/, "");
    if (u) return `Telegram @${u}`;
    const digits = (o.phone ?? "").replace(/\D/g, "");
    return digits ? `Telegram +${digits}` : `Telegram ${o.chatId ?? "contact"}`;
  }
  const digits = (o.phone ?? (o.chatId && !o.chatId.startsWith("lid:") ? o.chatId : "") ?? "").replace(/\D/g, "");
  return digits ? `WhatsApp +${digits}` : "WhatsApp (number hidden)";
}

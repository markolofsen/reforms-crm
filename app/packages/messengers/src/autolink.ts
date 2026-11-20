import { normalizeIdentifier } from "./normalize";

/**
 * The autolink matcher (P84, decision 0036 point 3 as amended 2026-11-20): pure, no I/O. The server builds a `Directory` from the
 * project's client records (Notion, read only, kept in memory) and asks `matchDialog` about each private dialog a connected account
 * sees. Only an exact identifier counts: a phone in E.164, or a Telegram username. A contact's saved name never matches. One client
 * is `unique` (the Hub may link it when `messengers.autolink` is on); two or more are `ambiguous` (a suggestion, never linked by
 * itself); a matching record without an email cannot become a client row, so it is a suggestion too (`no_email`).
 */

/** The two messengers a dialog can come from. */
export type DialogChannel = "telegram" | "whatsapp";

/**
 * What a record can be matched by. `phone` is `+` and digits; `username` is lower-case without `@`. A phone's `channel` says which
 * messenger it counts for: absent (the `Phone` field, or any other phone of the record) is both; `whatsapp` (the `WhatsApp` field)
 * matches WhatsApp chats only; `telegram` (a number in the `Telegram` field) matches Telegram chats only. A username is Telegram's.
 */
export type DirectoryKey = { kind: "phone"; value: string; channel?: DialogChannel } | { kind: "username"; value: string };

/** One client record of the directory: its source key (a Notion page id), name, email (null: no email) and identifiers. */
export interface DirectoryEntry {
  key: string;
  name: string;
  email: string | null;
  /** The record's Relationship (Client, Prospect, Lead, ...) or null: shown and counted, never used to decide. */
  relationship: string | null;
  identifiers: DirectoryKey[];
}

export interface Directory {
  entries: number;
  /** Every record, with or without an identifier (the owner's Link finds a client among them). */
  all: readonly DirectoryEntry[];
  /** `phone:+62...` (both channels), `whatsapp:+62...`, `telegram:+62...` (that channel only) and `username:anna` to the entries that carry it. */
  byKey: Map<string, DirectoryEntry[]>;
}

/** The identity of a dialog, never its text: what an adapter hands the matcher. */
export interface DialogIdentity {
  chatId: string;
  title: string;
  phone: string | null;
  username: string | null;
}

export type DialogMatch =
  | { kind: "unique"; entry: DirectoryEntry; by: DirectoryKey["kind"] }
  | { kind: "ambiguous"; entries: DirectoryEntry[]; by: DirectoryKey["kind"] }
  | { kind: "no_email"; entry: DirectoryEntry; by: DirectoryKey["kind"] }
  | { kind: "none" };

const keyOf = (k: DirectoryKey) => (k.kind === "phone" ? `${k.channel ?? "phone"}:${k.value}` : `username:${k.value}`);

/** A phone in E.164 or null. A number without a country code (no `+`, no `00`) is not guessed into one. */
export function e164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!/^(\+|00)/.test(v.replace(/[\s\-().]/g, ""))) return null;
  try {
    return normalizeIdentifier("phone", v);
  } catch {
    return null;
  }
}

/** A Telegram username (5 to 32 letters, digits, underscores, starting with a letter), lower-case, or null. */
export function username(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().replace(/^(https?:\/\/)?(www\.)?t\.me\//i, "").replace(/^@/, "").replace(/\/+$/, "");
  return /^[a-z][a-z0-9_]{4,31}$/i.test(v) ? v.toLowerCase() : null;
}

/** The index. An entry listed twice under one key counts once. */
export function buildDirectory(entries: readonly DirectoryEntry[]): Directory {
  const byKey = new Map<string, DirectoryEntry[]>();
  for (const e of entries) {
    for (const k of new Set(e.identifiers.map(keyOf))) {
      const list = byKey.get(k) ?? [];
      if (!list.includes(e)) list.push(e);
      byKey.set(k, list);
    }
  }
  return { entries: entries.length, all: entries, byKey };
}

/**
 * Phone first, then username: the first identifier of the dialog that any entry carries decides. `channel` is the dialog's messenger:
 * a WhatsApp chat matches a record's Phone or WhatsApp number; a Telegram chat its Phone, a number in its Telegram field, or its
 * Telegram username. Without a channel (a caller that cannot tell) only the channel-free keys count: Phone and username.
 */
export function matchDialog(dir: Directory, d: DialogIdentity, channel?: DialogChannel): DialogMatch {
  const lookups: Array<{ by: DirectoryKey["kind"]; keys: string[] }> = [];
  const phone = e164(d.phone);
  if (phone) lookups.push({ by: "phone", keys: [`phone:${phone}`, ...(channel ? [`${channel}:${phone}`] : [])] });
  const user = channel === "whatsapp" ? null : username(d.username);
  if (user) lookups.push({ by: "username", keys: [`username:${user}`] });
  for (const { by, keys } of lookups) {
    const hits: DirectoryEntry[] = [];
    for (const k of keys) for (const e of dir.byKey.get(k) ?? []) if (!hits.includes(e)) hits.push(e);
    if (hits.length === 0) continue;
    if (hits.length > 1) return { kind: "ambiguous", entries: hits, by };
    const entry = hits[0]!;
    return entry.email ? { kind: "unique", entry, by } : { kind: "no_email", entry, by };
  }
  return { kind: "none" };
}

/** The Activity line's reason, in the owner's words. */
export const MATCH_REASON: Record<DirectoryKey["kind"], string> = { phone: "phone matches the client", username: "Telegram username matches the client" };

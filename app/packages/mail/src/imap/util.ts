import { createHash } from "node:crypto";
import type { HistoryErrorCode, HistoryError } from "../history";

export function historyError(code: HistoryErrorCode, message: string): HistoryError {
  return Object.assign(new Error(`${code}: ${message}`), { code }) as HistoryError;
}

/** Strict e-mail shape: one bare address, no display name, no quotes, no list. */
export const ADDRESS = /^[^\s@<>",;()\\]{1,64}@[^\s@<>",;()\\]{1,255}\.[^\s@<>",;()\\]{2,63}$/;
export const normAddr = (a: string): string => a.trim().toLowerCase();

const MESSAGE_ID = /^<[^<>\s"\\]{1,500}>$/;
export const isMessageId = (s: string): boolean => MESSAGE_ID.test(s);

/** A stable id for the rare message that has no Message-Id. Its source cannot be fetched by id. */
export const syntheticId = (parts: (string | number)[]): string =>
  `<no-id-${createHash("sha1").update(parts.join("\u0000")).digest("hex").slice(0, 24)}@hub.invalid>`;

export const isSynthetic = (id: string): boolean => id.endsWith("@hub.invalid>") && id.startsWith("<no-id-");

/** Drafts, Trash and Junk never count as correspondence. */
export const SKIPPED_USE = new Set(["\\Drafts", "\\Trash", "\\Junk"]);
const SKIPPED_NAME = /(^|[/.])(drafts?|trash|deleted (items|messages)|junk( e-?mail)?|spam|bin)$/i;

/** Which mailboxes to read for an account without an explicit list. */
export function defaultMailboxes(host: string, boxes: { path: string; specialUse?: string }[]): string[] {
  const all = boxes.find((b) => b.specialUse === "\\All");
  // Gmail shows every message in All Mail, so reading the labels too would only repeat them.
  if (all && /gmail|googlemail/i.test(host)) return [all.path];
  return boxes.filter((b) => !(b.specialUse && SKIPPED_USE.has(b.specialUse)) && !SKIPPED_NAME.test(b.path)).map((b) => b.path);
}

export const chunk = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

import type { ChatRef, MessengerChannel, Repos } from "@hub/db";
import { channelsOf } from "./types";

/** One stored messenger message of a client. Mail is not here: the hub reads no mail (decision 0026), Mail.app has the thread. */
export interface HistoryItem { source: "messenger"; key: string; at: string; direction: "in" | "out"; channel: MessengerChannel; chatId: string; kind: string; text: string }

export interface ClientHistory {
  /** Newest first. */
  items: HistoryItem[];
  nextCursor?: string;
}

export interface ClientHistoryDeps {
  repos: Repos;
}

// Total order: newest first, ties broken by key so the order (and a cursor into it) is stable.
const before = (a: { at: string; key: string }, b: { at: string; key: string }) => (a.at === b.at ? a.key > b.key : a.at > b.at);
const after = (it: { at: string; key: string }, c: { t: string; k: string }) => (it.at === c.t ? it.key < c.k : it.at < c.t);

const iso = (s: string) => new Date(s).toISOString();

const encode = (it: { at: string; key: string }) => Buffer.from(JSON.stringify({ t: it.at, k: it.key })).toString("base64url");
function decode(cursor: string): { t: string; k: string } {
  try {
    const c = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { t?: unknown; k?: unknown };
    if (typeof c.t === "string" && typeof c.k === "string" && !Number.isNaN(Date.parse(c.t))) return { t: c.t, k: c.k };
  } catch {
    // fall through
  }
  throw new Error("bad_cursor: not a cursor from this function");
}

/**
 * One time-ordered history of a client: the stored messenger rows of the chats the owner linked (`client_identifiers`).
 * The cursor is a position in that order (time and key of the last item), so ties never repeat or drop a row.
 */
export async function clientHistory(
  deps: ClientHistoryDeps,
  project: string,
  clientId: number,
  opts: { limit?: number; cursor?: string } = {},
): Promise<ClientHistory> {
  const limit = Math.min(200, Math.max(1, Math.trunc(opts.limit ?? 20)));
  const cur = opts.cursor ? decode(opts.cursor) : null;
  const ids = await deps.repos.messengers.identifiersOf(project, clientId);
  const keep = (it: { at: string; key: string }) => !cur || after(it, cur);

  const items: HistoryItem[] = [];
  let more = false;

  // messenger rows
  const chats: ChatRef[] = [];
  for (const id of ids) {
    if (id.kind === "telegram" || id.kind === "whatsapp") for (const channel of channelsOf(id.kind)) chats.push({ channel, chatId: id.value });
  }
  const rows = await deps.repos.messengers.messagesOf(project, chats, { limit: limit + 1, ...(cur ? { before: cur.t } : {}) });
  for (const r of rows) {
    const it: HistoryItem = { source: "messenger", key: `m:${String(r.id).padStart(12, "0")}`, at: iso(r.sentAt), direction: r.direction, channel: r.channel, chatId: r.chatId, kind: r.kind, text: r.text };
    if (keep(it)) items.push(it);
  }
  // `messagesOf` caps the strictly older part at limit + 1: if it hit the cap, more rows may remain.
  const olderCount = rows.filter((r) => !cur || iso(r.sentAt) !== cur.t).length;
  if (olderCount > limit) more = true;

  items.sort((a, b) => (before(a, b) ? -1 : 1));
  if (items.length > limit) more = true;
  const page = items.slice(0, limit);
  const last = page[page.length - 1];
  return { items: page, ...(more && last ? { nextCursor: encode(last) } : {}) };
}

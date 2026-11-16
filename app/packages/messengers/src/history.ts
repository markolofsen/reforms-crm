import type { ChatRef, MessengerChannel, Repos } from "@hub/db";
import type { HistoryDirection, HistoryEntry, MailHistory } from "@hub/mail";
import { channelsOf } from "./types";

/** The mail side is injected: production passes the Mail.app reader, tests pass a fake. Read-only by construction. */
export type MailPages = Pick<MailHistory, "page">;

export type HistoryItem =
  | { source: "mail"; key: string; at: string; direction: HistoryDirection; entry: HistoryEntry }
  | { source: "messenger"; key: string; at: string; direction: HistoryDirection; channel: MessengerChannel; chatId: string; kind: string; text: string };

export interface ClientHistory {
  /** Newest first. */
  items: HistoryItem[];
  nextCursor?: string;
  /** Addresses whose mail could not be read (allow-list refusal, reader down). The rest of the history is still returned. */
  mailUnavailable: { address: string; code: string }[];
}

export interface ClientHistoryDeps {
  repos: Repos;
  /** Omit when mail is not connected: the result is messenger rows only. */
  mail?: MailPages;
}

const MAX_MAIL_PAGES = 100;

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
 * One time-ordered history of a client: mail (read live through `deps.mail`) merged with stored messenger rows,
 * found through the owner's `client_identifiers`. The cursor is a position in the merged order (time and key of the
 * last item), so it is valid however many sources there are; paging deep into old mail re-reads its newer pages.
 */
export async function clientHistory(
  deps: ClientHistoryDeps,
  project: string,
  clientId: number,
  opts: { limit?: number; cursor?: string; /** Addresses to read besides the linked ones, e.g. the client row's own e-mail. */ emails?: string[] } = {},
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

  // mail
  const mailUnavailable: ClientHistory["mailUnavailable"] = [];
  const seen = new Set<string>();
  if (deps.mail) {
    const addresses = [...new Set([...ids.filter((i) => i.kind === "email").map((i) => i.value), ...(opts.emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean)])];
    for (const address of addresses) {
      try {
        let cursor: string | undefined;
        let got = 0;
        for (let p = 0; p < MAX_MAIL_PAGES; p++) {
          const page = await deps.mail.page({ address, limit: Math.min(200, limit + 1), ...(cursor ? { cursor } : {}) });
          for (const e of page.entries) {
            const it: HistoryItem = { source: "mail", key: `e:${e.id}`, at: iso(e.date), direction: e.direction, entry: e };
            if (!keep(it) || seen.has(it.key)) continue;
            seen.add(it.key);
            items.push(it);
            got++;
          }
          cursor = page.nextCursor;
          if (!cursor || got > limit) break;
        }
        if (cursor) more = true;
      } catch (err) {
        mailUnavailable.push({ address, code: (err as { code?: string }).code ?? "unavailable" });
      }
    }
  }

  items.sort((a, b) => (before(a, b) ? -1 : 1));
  if (items.length > limit) more = true;
  const page = items.slice(0, limit);
  const last = page[page.length - 1];
  return { items: page, ...(more && last ? { nextCursor: encode(last) } : {}), mailUnavailable };
}

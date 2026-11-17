import type { HistoryEntry, HistoryPage, HistoryQuery, MailHistory } from "../history";
import type { ImapAccount, ImapConnect, ImapSession, RawHeader } from "./session";
import { ADDRESS, chunk, defaultMailboxes, historyError, isMessageId, isSynthetic, normAddr, syntheticId } from "./util";

export interface ImapHistoryOptions {
  /** Read on every call, so a refreshed token file is picked up. */
  accounts: () => ImapAccount[];
  connect: ImapConnect;
  /** Extra own addresses beyond each account's `addresses`. */
  me?: string[];
  /** The allow-list of doc 05 section 6. A refusal is `not_allowed`. Default: every address may be read. */
  allow?: (address: string) => boolean;
  /** How long one address's header list is reused between pages (ms). Default 60 000; 0 disables. */
  cacheMs?: number;
  now?: () => number;
}

const MAX_CACHE = 50;
const FETCH_CHUNK = 100;

const encode = (e: { date: string; id: string }) => Buffer.from(JSON.stringify({ t: e.date, k: e.id })).toString("base64url");
function decode(cursor: string): { t: string; k: string } {
  try {
    const c = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { t?: unknown; k?: unknown };
    if (typeof c.t === "string" && typeof c.k === "string" && !Number.isNaN(Date.parse(c.t))) return { t: c.t, k: c.k };
  } catch {
    // fall through
  }
  throw historyError("bad_cursor", "not a cursor from this reader");
}

/** Newest first, ties by id, so the order and a cursor into it are stable. */
const newer = (a: { date: string; id: string }, b: { date: string; id: string }) => (a.date === b.date ? (a.id > b.id ? -1 : 1) : a.date > b.date ? -1 : 1);
const olderThan = (e: { date: string; id: string }, c: { t: string; k: string }) => (e.date === c.t ? e.id < c.k : e.date < c.t);

/**
 * `MailHistory` over IMAP (research 02, D2). Per call: one session per account, one `OR FROM/TO/CC` search per mailbox,
 * headers only; entries are deduplicated by Message-Id, filtered to the exact address (the server only matches
 * substrings), sorted newest first and paged by a cursor that is a position in that order. Read-only by the session type.
 * If any account cannot be read the call fails with `unavailable`: a history with a silent hole is worse than an error.
 */
export function createImapHistory(o: ImapHistoryOptions): MailHistory {
  const cacheMs = o.cacheMs ?? 60_000;
  const now = o.now ?? Date.now;
  const cache = new Map<string, { at: number; entries: HistoryEntry[] }>();

  const own = (accounts: ImapAccount[]) => new Set([...(o.me ?? []).map(normAddr), ...accounts.flatMap((a) => a.addresses.map(normAddr))]);

  async function withSessions<T>(fn: (a: ImapAccount, s: ImapSession) => Promise<T>): Promise<T[]> {
    const accounts = o.accounts();
    if (accounts.length === 0) throw historyError("unavailable", "no mail account is configured");
    const out: T[] = [];
    for (const a of accounts) {
      let session: ImapSession | undefined;
      try {
        session = await o.connect(a);
        out.push(await fn(a, session));
      } catch (e) {
        // Never repeat the server's text: it can echo the login. The account name is enough to act on.
        throw historyError("unavailable", `account "${a.name}" could not be read${e instanceof Error && /auth|credential|login/i.test(e.message) ? " (sign-in refused)" : ""}`);
      } finally {
        await session?.close().catch(() => {});
      }
    }
    return out;
  }

  async function collect(address: string): Promise<HistoryEntry[]> {
    const hit = cache.get(address);
    if (hit && now() - hit.at < cacheMs) return hit.entries;
    const mine = own(o.accounts());
    const byId = new Map<string, HistoryEntry>();
    await withSessions(async (a, s) => {
      const boxes = a.mailboxes ?? defaultMailboxes(a.host, await s.list());
      for (const path of boxes) {
        const uids = await s.search(path, { address });
        for (const part of chunk(uids, FETCH_CHUNK)) {
          for (const h of await s.headers(path, part)) {
            if (![h.from, ...h.to, ...h.cc].some((x) => normAddr(x) === address)) continue;
            const id = h.messageId ?? syntheticId([h.date, h.from, h.subject, h.size]);
            if (byId.has(id)) continue; // the same mail in a second mailbox or label
            byId.set(id, entryOf(id, path, h, mine));
          }
        }
      }
    });
    const entries = [...byId.values()].sort(newer);
    if (cacheMs > 0) {
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
      cache.set(address, { at: now(), entries });
    }
    return entries;
  }

  return {
    async page(q: HistoryQuery): Promise<HistoryPage> {
      const address = normAddr(q.address ?? "");
      if (!ADDRESS.test(address)) throw historyError("bad_address", "not an e-mail address");
      if (o.allow && !o.allow(address)) throw historyError("not_allowed", "this address is not on the allow-list");
      const limit = Math.min(200, Math.max(1, Math.trunc(q.limit ?? 20)));
      const cur = q.cursor ? decode(q.cursor) : null;
      let since = 0;
      if (q.since) {
        since = Date.parse(q.since);
        if (Number.isNaN(since)) throw historyError("bad_cursor", "since is not an ISO date");
      }
      const all = (await collect(address)).filter((e) => (!q.direction || e.direction === q.direction) && Date.parse(e.date) >= since);
      const rest = cur ? all.filter((e) => olderThan(e, cur)) : all;
      const entries = rest.slice(0, limit);
      const last = entries[entries.length - 1];
      return { address, entries, total: all.length, ...(rest.length > limit && last ? { nextCursor: encode(last) } : {}) };
    },

    async source(id: string): Promise<Uint8Array | null> {
      if (!isMessageId(id) || isSynthetic(id)) return null;
      const accounts = o.accounts();
      const mine = own(accounts);
      for (const a of accounts) {
        let session: ImapSession | undefined;
        try {
          session = await o.connect(a);
          const boxes = a.mailboxes ?? defaultMailboxes(a.host, await session.list());
          for (const path of boxes) {
            const uids = await session.search(path, { messageId: id });
            if (uids.length === 0) continue;
            const [h] = await session.headers(path, [uids[0] as number]);
            // The allow-list applies here too: a Message-Id must not open a mail with someone who is not listed.
            if (h && o.allow && ![h.from, ...h.to, ...h.cc].some((x) => !mine.has(normAddr(x)) && o.allow?.(normAddr(x)))) return null;
            return await session.source(path, uids[0] as number);
          }
        } catch {
          throw historyError("unavailable", `account "${a.name}" could not be read`);
        } finally {
          await session?.close().catch(() => {});
        }
      }
      return null;
    },
  };
}

function entryOf(id: string, mailbox: string, h: RawHeader, mine: Set<string>): HistoryEntry {
  return {
    id,
    date: h.date,
    direction: mine.has(normAddr(h.from)) ? "out" : "in",
    from: h.from,
    to: h.to,
    cc: h.cc,
    subject: h.subject,
    mailbox,
    attachmentCount: h.attachmentCount,
    size: h.size,
  };
}

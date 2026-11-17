import { ImapFlow } from "imapflow";
import type { FetchMessageObject, MessageStructureObject, SearchObject } from "imapflow";
import type { ImapAccount, ImapConnect, ImapQuery, ImapSession, MailboxInfo, RawHeader } from "./session";
import { normAddr } from "./util";

/**
 * The only file that imports imapflow. Every mailbox is opened with `readOnly: true` (EXAMINE) and only SEARCH, FETCH
 * and LIST are issued, so nothing here can change flags, move, delete, append or send. Credentials are used for the
 * connection and kept nowhere else; the logger is off so no protocol line (AUTH included) is ever printed.
 */
const bare = (a: { address?: string } | undefined) => normAddr(a?.address ?? "");
const bares = (xs: { address?: string }[] | undefined) => (xs ?? []).map(bare).filter(Boolean);

function countAttachments(node: MessageStructureObject | undefined): number {
  if (!node) return 0;
  const kids = node.childNodes ?? [];
  if (kids.length) return kids.reduce((n, k) => n + countAttachments(k), 0);
  return node.disposition === "attachment" ? 1 : 0;
}

const refsOf = (h: Buffer | undefined): string[] => (h ? (String(h).match(/<[^<>\s]+>/g) ?? []) : []);

function toHeader(m: FetchMessageObject): RawHeader {
  const e = m.envelope;
  const when = e?.date ?? m.internalDate;
  const date = when instanceof Date ? when : new Date(when ?? 0);
  return {
    uid: m.uid,
    messageId: e?.messageId ?? null,
    inReplyTo: e?.inReplyTo ?? null,
    references: refsOf(m.headers),
    date: Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString(),
    from: bare(e?.from?.[0]),
    to: bares(e?.to),
    cc: bares(e?.cc),
    subject: e?.subject ?? "",
    size: m.size ?? 0,
    attachmentCount: countAttachments(m.bodyStructure),
  };
}

function toSearch(q: ImapQuery): SearchObject {
  const s: SearchObject = {};
  if (q.address) s.or = [{ from: q.address }, { to: q.address }, { cc: q.address }];
  if (q.messageId) s.header = { "message-id": q.messageId };
  if (q.since) s.since = q.since;
  return s;
}

/** The calls the session makes on a client: all reads. A test double needs only these. */
export type ImapFlowLike = Pick<ImapFlow, "list" | "getMailboxLock" | "search" | "fetch" | "fetchOne" | "logout" | "close">;

export const imapflowConnect: ImapConnect = async (a: ImapAccount): Promise<ImapSession> => {
  const client = new ImapFlow({
    host: a.host,
    port: a.port,
    secure: a.secure,
    auth: "pass" in a.auth ? { user: a.user, pass: a.auth.pass } : { user: a.user, accessToken: a.auth.accessToken },
    logger: false,
    disableAutoIdle: true,
  });
  client.on("error", () => {
    // Connection errors surface through the pending call; an unhandled 'error' event would crash the process.
  });
  await client.connect();
  return sessionOver(client);
};

export function sessionOver(client: ImapFlowLike): ImapSession {
  const open = async <T>(path: string, fn: () => Promise<T>): Promise<T> => {
    const lock = await client.getMailboxLock(path, { readOnly: true });
    try {
      return await fn();
    } finally {
      lock.release();
    }
  };

  return {
    async list(): Promise<MailboxInfo[]> {
      const boxes = await client.list();
      return boxes
        .filter((b) => !b.flags?.has("\\Noselect") && !b.flags?.has("\\NonExistent"))
        .map((b) => ({ path: b.path, ...(b.specialUse ? { specialUse: b.specialUse } : {}) }));
    },
    async search(path, query) {
      return open(path, async () => {
        const found = await client.search(toSearch(query), { uid: true });
        return found ? [...found].sort((x, y) => x - y) : [];
      });
    },
    async headers(path, uids) {
      if (uids.length === 0) return [];
      return open(path, async () => {
        const out: RawHeader[] = [];
        for await (const m of client.fetch(uids, { uid: true, envelope: true, internalDate: true, size: true, bodyStructure: true, headers: ["references"] }, { uid: true })) {
          out.push(toHeader(m));
        }
        return out;
      });
    },
    async source(path, uid) {
      return open(path, async () => {
        const m = await client.fetchOne(String(uid), { source: true }, { uid: true });
        return m && m.source ? new Uint8Array(m.source) : null;
      });
    },
    async close() {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    },
  };
}

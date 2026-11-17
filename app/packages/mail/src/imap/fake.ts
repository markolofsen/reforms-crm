import PostalMime from "postal-mime";
import type { ImapAccount, ImapConnect, ImapQuery, ImapSession, MailboxInfo, RawHeader } from "./session";
import { historyError, normAddr } from "./util";

/** Builds one RFC 822 message for tests. Plain text body, CRLF line ends. */
export function buildEml(o: {
  from: string;
  to: string | string[];
  cc?: string | string[];
  subject: string;
  messageId?: string | null;
  date: string;
  inReplyTo?: string;
  references?: string[];
  body?: string;
  attachment?: string;
}): string {
  const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(", ") : v);
  const h = [
    `From: ${o.from}`,
    `To: ${list(o.to)}`,
    ...(o.cc ? [`Cc: ${list(o.cc)}`] : []),
    `Subject: ${o.subject}`,
    ...(o.messageId === null ? [] : [`Message-ID: ${o.messageId ?? `<${Math.random().toString(36).slice(2)}@fake.test>`}`]),
    `Date: ${new Date(o.date).toUTCString()}`,
    ...(o.inReplyTo ? [`In-Reply-To: ${o.inReplyTo}`] : []),
    ...(o.references?.length ? [`References: ${o.references.join(" ")}`] : []),
    "MIME-Version: 1.0",
  ];
  if (!o.attachment) return `${h.join("\r\n")}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${o.body ?? "Hello."}\r\n`;
  const b = "fakeboundary";
  return [
    ...h,
    `Content-Type: multipart/mixed; boundary="${b}"`,
    "",
    `--${b}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    o.body ?? "Hello.",
    `--${b}`,
    `Content-Type: application/pdf; name="${o.attachment}"`,
    `Content-Disposition: attachment; filename="${o.attachment}"`,
    "Content-Transfer-Encoding: base64",
    "",
    "JVBERi0x",
    `--${b}--`,
    "",
  ].join("\r\n");
}

export type FakeMessage = string;
export interface FakeMailbox {
  specialUse?: string;
  messages: FakeMessage[];
}

/**
 * An in-memory IMAP server. It answers the closed `ImapQuery` set like a real one would (substring match on From, To,
 * Cc; exact Message-Id; SINCE by day) and records every call in `ops`, so a test can assert that only reads happened.
 * Nothing touches the network.
 */
export class FakeImapServer {
  /** account name -> mailbox path -> mailbox. */
  readonly boxes: Record<string, Record<string, FakeMailbox>>;
  /** Every session call as "<account>:<method>:<mailbox>". */
  readonly ops: string[] = [];
  readonly connects: string[] = [];
  /** Accounts whose connection is refused, and with what text (to test that it is not echoed). */
  readonly refuse = new Map<string, string>();
  private cache = new Map<string, Promise<RawHeader[]>>();

  constructor(boxes: Record<string, Record<string, FakeMailbox>>) {
    this.boxes = boxes;
  }

  add(account: string, path: string, eml: string): void {
    this.boxes[account]?.[path]?.messages.push(eml);
    this.cache.delete(`${account}\u0000${path}`);
  }

  readonly connect: ImapConnect = async (a: ImapAccount): Promise<ImapSession> => {
    this.connects.push(a.name);
    const refused = this.refuse.get(a.name);
    if (refused !== undefined) throw new Error(refused);
    const mailboxes = this.boxes[a.name];
    if (!mailboxes) throw new Error("no such account");
    const op = (m: string, box = "") => this.ops.push(`${a.name}:${m}:${box}`);
    const box = (path: string) => {
      const b = mailboxes[path];
      if (!b) throw new Error(`no such mailbox ${path}`);
      return b;
    };
    return {
      list: async (): Promise<MailboxInfo[]> => {
        op("list");
        return Object.entries(mailboxes).map(([path, b]) => ({ path, ...(b.specialUse ? { specialUse: b.specialUse } : {}) }));
      },
      search: async (path, q) => {
        op("search", path);
        const all = await this.parsed(a.name, path, box(path));
        return all.filter((h) => matches(h, q)).map((h) => h.uid);
      },
      headers: async (path, uids) => {
        op("headers", path);
        const want = new Set(uids);
        return (await this.parsed(a.name, path, box(path))).filter((h) => want.has(h.uid));
      },
      source: async (path, uid) => {
        op("source", path);
        const m = box(path).messages[uid - 1];
        return m === undefined ? null : new TextEncoder().encode(m);
      },
      close: async () => {
        op("close");
      },
    };
  };

  private parsed(account: string, path: string, b: FakeMailbox): Promise<RawHeader[]> {
    const key = `${account}\u0000${path}`;
    let p = this.cache.get(key);
    if (!p) {
      p = Promise.all(b.messages.map((raw, i) => header(raw, i + 1)));
      this.cache.set(key, p);
    }
    return p;
  }
}

const addrs = (xs: { address?: string }[] | undefined) => (xs ?? []).map((x) => normAddr(x.address ?? "")).filter(Boolean);

async function header(raw: string, uid: number): Promise<RawHeader> {
  const m = await PostalMime.parse(raw);
  const d = m.date ? new Date(m.date) : new Date(0);
  return {
    uid,
    messageId: m.messageId ?? null,
    inReplyTo: m.inReplyTo ?? null,
    references: (m.references ?? "").match(/<[^<>\s]+>/g) ?? [],
    date: Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString(),
    from: normAddr(m.from?.address ?? ""),
    to: addrs(m.to),
    cc: addrs(m.cc),
    subject: m.subject ?? "",
    size: raw.length,
    attachmentCount: (m.attachments ?? []).filter((x) => x.disposition === "attachment").length,
  };
}

function matches(h: RawHeader, q: ImapQuery): boolean {
  if (q.messageId !== undefined && h.messageId !== q.messageId) return false;
  if (q.address !== undefined) {
    const a = q.address.toLowerCase();
    if (![h.from, ...h.to, ...h.cc].some((x) => x.includes(a))) return false;
  }
  if (q.since) {
    const day = Date.UTC(q.since.getUTCFullYear(), q.since.getUTCMonth(), q.since.getUTCDate());
    if (Date.parse(h.date) < day) return false;
  }
  if (q.address === undefined && q.messageId === undefined && !q.since) throw historyError("unavailable", "empty query");
  return true;
}

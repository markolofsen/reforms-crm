import { senderOf } from "./read";
import { bareId, FS, LS, localStamp, records } from "./records";
import type { OsaRun } from "./osa";
import { FROM_SCRIPT, SENT_TO_SCRIPT } from "./scripts/history";

// P99 S1: one person's history, read from Apple Mail when a conversation opens (decision 0026), never stored (0013). The spike of
// 2026-11-21 (plan section 7b) chose AppleScript over Mail's own store: a sender read of one mailbox is 0.13 to 0.2 s, the store
// needs Full Disk Access. Two reads per account: the inbound mailboxes by `sender contains` (Mail filters, so only their messages
// cross the AppleEvent), then Sent narrowed by the thread subjects (`subject contains`) with the address checked in To and Cc,
// since a To scan of a whole Sent mailbox took 1.2 to 2.8 s on 330 messages. Read only: nothing launches, writes or moves Mail.

/** One message of a person's history, its header only. Ids bare. */
export interface HistoryMessage {
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  fromEmail: string;
  fromName: string;
  /** ISO 8601 UTC. */
  date: string;
  subject: string;
  ours: boolean;
  account: string;
  mailbox: string;
  mailId: number;
}

/** `null`: no such mailbox in that account (a label the project never made). */
export function parseHistory(out: string, account: string, mailbox: string, ours: boolean): HistoryMessage[] | null {
  if (out.trim() === "nobox") return null;
  const recs = records(out);
  const msgs: HistoryMessage[] = [];
  // The Sent read names the mailbox it found (a Gmail account's `[Gmail]/Sent Mail`), so a body is read from where it is.
  const box = recs[0]?.startsWith("ok") ? recs[0].split(FS)[1]?.trim() || mailbox : mailbox;
  for (const rec of recs[0]?.startsWith("ok") ? recs.slice(1) : recs) {
    const [id = "", mid = "", irt = "", refs = "", snd = "", stamp = "", subject = ""] = rec.split(FS);
    const date = localStamp(stamp.trim());
    const mailId = Number(id);
    if (!bareId(mid) || !date || !Number.isInteger(mailId)) continue;
    const s = senderOf(snd);
    const references = [...refs.matchAll(/<([^<>\s]+)>/g)].map((x) => bareId(x[1])).filter(Boolean);
    msgs.push({ messageId: bareId(mid), inReplyTo: bareId(irt) || null, references, fromEmail: s.email, fromName: s.name, date, subject, ours, account, mailbox: box, mailId });
  }
  return msgs;
}

/** A subject without its reply and forward prefixes, lower case, one space: the second way a message joins a thread. */
export const baseSubject = (s: string): string =>
  s
    .replace(/^(\s*(re|fwd?|fw|aw|sv|wg)\s*(\[\d+\])?\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export interface ReadInput {
  accounts: readonly string[];
  /** The project's inbound mailboxes (INBOX and the hub labels); one that an account lacks is skipped. */
  inboundBoxes: readonly string[];
  sentMailbox: string;
  address: string;
  /** Subjects the Hub knows for this person (its drafts): Sent is also searched for these. */
  subjects: readonly string[];
}

/** The most subjects one Sent read searches for (each is one `whose` query). */
const SUBJECTS_MAX = 20;

/** Their messages and ours with this address, every account, deduplicated by Message-ID. Throws what the OsaRun throws (not answering). */
export async function readHistory(osa: OsaRun, q: ReadInput): Promise<HistoryMessage[]> {
  const address = q.address.trim().toLowerCase();
  const seen = new Map<string, HistoryMessage>();
  for (const account of q.accounts) {
    for (const box of [...new Set(q.inboundBoxes)]) {
      for (const m of parseHistory(await osa(FROM_SCRIPT, [account, box, address]), account, box, false) ?? []) if (m.fromEmail === address && !seen.has(m.messageId)) seen.set(m.messageId, m);
    }
  }
  const subjects = [...new Set([...[...seen.values()].map((m) => baseSubject(m.subject)), ...q.subjects.map(baseSubject)].filter((s) => s.length >= 2))].slice(0, SUBJECTS_MAX);
  if (subjects.length > 0) {
    for (const account of q.accounts) {
      for (const m of parseHistory(await osa(SENT_TO_SCRIPT, [account, q.sentMailbox, address, subjects.join(LS)]), account, q.sentMailbox, true) ?? []) if (!seen.has(m.messageId)) seen.set(m.messageId, m);
    }
  }
  return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
}

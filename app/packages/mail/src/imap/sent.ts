import type { ImapAccount, ImapSession } from "./session";
import { ADDRESS, historyError, normAddr } from "./util";

/** One message found in a Sent folder. */
export interface SentMessage {
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  /** ISO 8601 UTC. */
  date: string;
  to: string[];
  cc: string[];
  subject: string;
  account: string;
  mailbox: string;
}

const SENT_NAMES = ["Sent", "Sent Items", "Sent Messages", "Sent Mail", "[Gmail]/Sent Mail", "[Google Mail]/Sent Mail", "INBOX.Sent", "Gesendet", "Отправленные"];

/** The Sent folder of an account: the configured name, else the `\Sent` special-use folder, else a usual name. */
export async function findSentMailbox(a: ImapAccount, s: ImapSession): Promise<string> {
  const boxes = await s.list();
  if (a.sentMailbox) {
    if (boxes.some((b) => b.path === a.sentMailbox)) return a.sentMailbox;
    throw historyError("unavailable", `account "${a.name}": sentMailbox "${a.sentMailbox}" does not exist`);
  }
  const hit = boxes.find((b) => b.specialUse === "\\Sent") ?? SENT_NAMES.map((n) => boxes.find((b) => b.path.toLowerCase() === n.toLowerCase())).find(Boolean);
  if (!hit) throw historyError("unavailable", `account "${a.name}": no Sent folder found (set sentMailbox)`);
  return hit.path;
}

/** Messages in the account's Sent folder dated at or after `since`. Read only. */
export async function readSent(a: ImapAccount, s: ImapSession, since: Date): Promise<SentMessage[]> {
  const mailbox = await findSentMailbox(a, s);
  const uids = await s.search(mailbox, { since });
  const out: SentMessage[] = [];
  for (let i = 0; i < uids.length; i += 100) {
    for (const h of await s.headers(mailbox, uids.slice(i, i + 100))) {
      if (!h.messageId || Date.parse(h.date) < since.getTime()) continue;
      out.push({ messageId: h.messageId, inReplyTo: h.inReplyTo, references: h.references, date: h.date, to: h.to, cc: h.cc, subject: h.subject, account: a.name, mailbox });
    }
  }
  return out;
}

/** What the matcher needs of a draft. */
export interface DraftToMatch {
  id: number;
  subject: string;
  /** `To` as stored: comma separated, display names allowed. */
  to: string;
  /** Message-Id of the draft the agent made in Mail, or of the thread it answers. */
  mailRef: string | null;
  /** ISO 8601. */
  createdAt: string;
}

export type SentVia = "message-id" | "thread" | "subject-recipient";
export interface SentMatch {
  draftId: number;
  via: SentVia;
  sent: SentMessage;
}

/** `Re: [x] Aw: Topic` becomes `topic`. */
export function normSubject(s: string): string {
  let t = s.normalize("NFC").trim();
  for (let prev = ""; prev !== t; ) {
    prev = t;
    t = t.replace(/^\s*(re|fwd?|aw|wg|sv|vs|odp|ответ|отв|пересл)\s*(\[\d+\])?\s*:\s*/i, "");
  }
  return t.replace(/\s+/g, " ").toLowerCase();
}

const addrOf = (raw: string): string => {
  const angle = /<([^>]+)>/.exec(raw);
  return normAddr(angle?.[1] ?? raw);
};
const firstTo = (to: string): string | null => {
  for (const part of to.split(",")) {
    const a = addrOf(part);
    if (ADDRESS.test(a)) return a;
  }
  return null;
};

/**
 * Which Sent messages are which drafts. The app never decides "sent": it only reads the folder, and a draft is a match
 * only when a message the person sent says so, by the strongest evidence available:
 *   1. `message-id`: the sent message has the draft's own Message-Id (Mail keeps it when a draft is sent);
 *   2. `thread`: it answers the thread `mailRef` points to, and is addressed to the draft's recipient;
 *   3. `subject-recipient`: same subject (Re:/Fwd: ignored), and the draft's first recipient is in To or Cc.
 * 2 and 3 only count messages sent after the draft was made. A sent message satisfies one draft only (the oldest draft
 * first), so two drafts to one client cannot both be marked by one send. Doubt leaves a draft unmarked.
 */
export function matchSent(drafts: DraftToMatch[], sent: SentMessage[]): SentMatch[] {
  const pool = [...sent].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.messageId < b.messageId ? -1 : 1));
  const queue = [...drafts].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id));
  const used = new Set<string>();
  const done = new Set<number>();
  const out: SentMatch[] = [];
  const take = (d: DraftToMatch, via: SentVia, ok: (m: SentMessage) => boolean) => {
    if (done.has(d.id)) return;
    const hit = pool.find((m) => !used.has(m.messageId) && ok(m));
    if (!hit) return;
    used.add(hit.messageId);
    done.add(d.id);
    out.push({ draftId: d.id, via, sent: hit });
  };
  const after = (d: DraftToMatch, m: SentMessage) => Date.parse(m.date) >= Date.parse(d.createdAt);
  const to = (d: DraftToMatch, m: SentMessage) => {
    const r = firstTo(d.to);
    return r !== null && [...m.to, ...m.cc].some((x) => normAddr(x) === r);
  };

  for (const d of queue) if (d.mailRef) take(d, "message-id", (m) => m.messageId === d.mailRef);
  for (const d of queue) {
    const ref = d.mailRef;
    if (ref) take(d, "thread", (m) => after(d, m) && to(d, m) && (m.inReplyTo === ref || m.references.includes(ref)));
  }
  for (const d of queue) {
    const s = normSubject(d.subject);
    if (s) take(d, "subject-recipient", (m) => after(d, m) && to(d, m) && normSubject(m.subject) === s);
  }
  return out;
}

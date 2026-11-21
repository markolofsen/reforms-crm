import { bareId, type OsaRun } from "@hub/send";
import { senderOf } from "./apple-mail";

// P99 S1: one person's history, read from Apple Mail when a conversation opens (decision 0026), never stored (0013). The spike of
// 2026-11-21 (plan section 7b) chose AppleScript over Mail's own store: a sender read of one mailbox is 0.13 to 0.2 s, the store
// needs Full Disk Access. Two reads per account: the inbound mailboxes by `sender contains` (Mail filters, so only their messages
// cross the AppleEvent), then Sent narrowed by the thread subjects (`subject contains`) with the address checked in To and Cc,
// since a To scan of a whole Sent mailbox took 1.2 to 2.8 s on 330 messages. Read only: nothing launches, writes or moves Mail.

const FS = "\x1f";
const RS = "\x1e";
const LS = "\x1d";

const STAMP = `set stamp to ((year of d) as text) & "," & (((month of d) as integer) as text) & "," & ((day of d) as text) & "," & ((time of d) as text)`;
const HEADERS = `set irt to ""
      try
        set irt to content of (first header of m whose name is "In-Reply-To")
      end try
      set refs to ""
      try
        set refs to content of (first header of m whose name is "References")
      end try
      set snd to ""
      try
        set snd to sender of m
      end try`;

/** argv: 1 account, 2 mailbox, 3 the address. One record per message from that sender: Mail's id, Message-ID, In-Reply-To, References, sender, received "y,m,d,seconds", subject. */
export const FROM_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set RS to (ASCII character 30)
  set out to ""
  tell application "Mail"
    try
      set box to mailbox (item 2 of argv) of account (item 1 of argv)
      get name of box
    on error
      return "nobox"
    end try
    repeat with m in (messages of box whose sender contains (item 3 of argv))
      ${HEADERS}
      set d to date received of m
      ${STAMP}
      set out to out & (id of m) & FS & (message id of m) & FS & irt & FS & refs & FS & snd & FS & stamp & FS & (subject of m) & RS
    end repeat
  end tell
  return "ok" & RS & out
end run`;

/**
 * argv: 1 account, 2 Sent mailbox (a Gmail account's is `[Gmail]/<name>`), 3 the address, 4 the thread subjects joined by LS. One
 * record per message of ours to that address (To or Cc) whose subject contains one of them; the same fields, the sent date.
 */
export const SENT_TO_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set RS to (ASCII character 30)
  set LS to (ASCII character 29)
  set addr to item 3 of argv
  set out to ""
  tell application "Mail"
    set boxPath to (item 2 of argv)
    try
      set box to mailbox boxPath of account (item 1 of argv)
      get name of box
    on error
      try
        set boxPath to "[Gmail]/" & (item 2 of argv)
        set box to mailbox boxPath of account (item 1 of argv)
        get name of box
      on error
        return "nobox"
      end try
    end try
    set AppleScript's text item delimiters to LS
    set subs to text items of (item 4 of argv)
    set AppleScript's text item delimiters to ""
    repeat with s in subs
      if (length of s) > 0 then
        repeat with m in (messages of box whose subject contains s)
          set hit to false
          try
            repeat with r in ((to recipients of m) & (cc recipients of m))
              if (address of r) is addr then set hit to true
            end repeat
          end try
          if hit then
            ${HEADERS}
            set d to date sent of m
            ${STAMP}
            set out to out & (id of m) & FS & (message id of m) & FS & irt & FS & refs & FS & snd & FS & stamp & FS & (subject of m) & RS
          end if
        end repeat
      end if
    end repeat
  end tell
  return "ok" & FS & boxPath & RS & out
end run`;

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

function localStamp(stamp: string): string | null {
  const [y, m, d, s] = stamp.split(",").map(Number);
  if (![y, m, d, s].every((n) => Number.isFinite(n))) return null;
  return new Date(y!, m! - 1, d!, 0, 0, s!).toISOString();
}

/** `null`: no such mailbox in that account (a label the project never made). */
export function parseHistory(out: string, account: string, mailbox: string, ours: boolean): HistoryMessage[] | null {
  if (out.trim() === "nobox") return null;
  const recs = out.split(RS).map((r) => r.replace(/^[\r\n]+/, "")).filter((r) => r.trim() !== "");
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

/**
 * Threads by References and In-Reply-To (a message joins every message it names), then joined by the base subject, oldest first.
 * Returns the groups oldest thread first (by its first message), each oldest message first.
 */
export function threadsOf<M extends { messageId: string; inReplyTo: string | null; references: readonly string[]; subject: string; date: string }>(msgs: readonly M[]): M[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const join = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  const bySubject = new Map<string, string>();
  for (const m of msgs) {
    if (!parent.has(m.messageId)) parent.set(m.messageId, m.messageId);
    for (const r of [m.inReplyTo, ...m.references]) if (r) join(m.messageId, r);
  }
  for (const m of msgs) {
    const s = baseSubject(m.subject);
    if (!s) continue;
    const first = bySubject.get(s);
    if (first === undefined) bySubject.set(s, m.messageId);
    else join(first, m.messageId);
  }
  const groups = new Map<string, M[]>();
  for (const m of [...msgs].sort((a, b) => a.date.localeCompare(b.date))) {
    const k = find(m.messageId);
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  return [...groups.values()].sort((a, b) => a[0]!.date.localeCompare(b[0]!.date));
}

/** The bodies read in this run of the server, by project and Message-ID (decision 0013: memory only, gone at a restart). */
const BODY_MAX = 300;
const BODY_TTL_MS = 15 * 60_000;
export function bodyCache(now: () => number = Date.now) {
  const m = new Map<string, { text: string; at: number }>();
  return {
    get(key: string): string | null {
      const hit = m.get(key);
      if (!hit || now() - hit.at > BODY_TTL_MS) return null;
      return hit.text;
    },
    set(key: string, text: string): void {
      m.delete(key);
      m.set(key, { text, at: now() });
      while (m.size > BODY_MAX) m.delete(m.keys().next().value!);
    },
  };
}


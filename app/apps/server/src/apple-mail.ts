import { bareId, type OsaRun } from "@hub/send";

// The server's read-only questions to Apple Mail (decision 0026), through `osascript` behind an injectable `OsaRun`:
// is Mail running, what is in an account's Sent mailbox since a date, which accounts does Mail have, and (P96, the Mail
// reader) what arrived in an inbound mailbox since a date and the text of one of those messages. Nothing here
// launches Mail (each caller asks `mailRunning` first), writes, moves or sends. The send door is `@hub/send`.

const FS = "\x1f";
const RS = "\x1e";
const LS = "\x1d";

/** Never launches Mail: `application "Mail" is running` only looks at the process list. */
export const RUNNING_SCRIPT = `on run argv
  return (application "Mail" is running) as text
end run`;

/**
 * argv: 1 account, 2 mailbox, 3-5 year month day, 6 seconds after local midnight (the oldest date to read).
 * One record per message: Message-ID, In-Reply-To, the sent date as local "y,m,d,seconds", To, Cc, subject, References (P90:
 * a reply further down the thread) and the sender (P90: who replied, when it is not the Hub); never the text (P65). A Gmail
 * account's Sent is `[Gmail]/<name>`.
 */
export const SENT_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set RS to (ASCII character 30)
  set LS to (ASCII character 29)
  set fromDate to current date
  set day of fromDate to 1
  set year of fromDate to (item 3 of argv) as integer
  set month of fromDate to (item 4 of argv) as integer
  set day of fromDate to (item 5 of argv) as integer
  set time of fromDate to (item 6 of argv) as integer
  set out to ""
  tell application "Mail"
    set acc to account (item 1 of argv)
    try
      set box to mailbox (item 2 of argv) of acc
      get name of box
    on error
      set box to mailbox ("[Gmail]/" & (item 2 of argv)) of acc
    end try
    set ms to (messages of box whose date sent is greater than or equal to fromDate)
    repeat with m in ms
      set irt to ""
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
      end try
      set tos to ""
      set ccs to ""
      try
        repeat with r in (to recipients of m)
          set tos to tos & (address of r) & LS
        end repeat
        repeat with r in (cc recipients of m)
          set ccs to ccs & (address of r) & LS
        end repeat
      end try
      set d to date sent of m
      set stamp to ((year of d) as text) & "," & (((month of d) as integer) as text) & "," & ((day of d) as text) & "," & ((time of d) as text)
      set out to out & (message id of m) & FS & irt & FS & stamp & FS & tos & FS & ccs & FS & (subject of m) & FS & refs & FS & snd & RS
    end repeat
  end tell
  return out
end run`;

/** One record per account: its name, then its addresses. */
export const ACCOUNTS_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set RS to (ASCII character 30)
  set LS to (ASCII character 29)
  set out to ""
  tell application "Mail"
    repeat with a in accounts
      set addrs to ""
      try
        repeat with e in (email addresses of a)
          set addrs to addrs & (e as text) & LS
        end repeat
      end try
      set out to out & (name of a) & FS & addrs & RS
    end repeat
  end tell
  return out
end run`;

/** One message of a Sent mailbox, as the matcher needs it. Ids are bare (no angle brackets, lower case). */
export interface SentMessage {
  messageId: string;
  inReplyTo: string | null;
  /** ISO 8601 UTC. */
  date: string;
  to: string[];
  cc: string[];
  subject: string;
  account: string;
  /** P90: the References header's ids, bare (empty when absent). */
  references: string[];
  /** P90: the sender as Mail shows it (`Name <address>`), or empty. */
  from: string;
}

export async function mailRunning(osa: OsaRun): Promise<boolean> {
  return (await osa(RUNNING_SCRIPT, [])).trim() === "true";
}

const list = (v: string | undefined) => (v ?? "").split(LS).map((x) => x.trim().toLowerCase()).filter(Boolean);
const records = (out: string) => out.split(RS).map((r) => r.replace(/^[\r\n]+/, "")).filter((r) => r.trim() !== "");

/** Mail's local "y,m,d,seconds" as an instant: the Date constructor applies this machine's zone and DST, as Mail did. */
function localStamp(stamp: string): string | null {
  const [y, m, d, s] = stamp.split(",").map(Number);
  if (![y, m, d, s].every((n) => Number.isFinite(n))) return null;
  return new Date(y!, m! - 1, d!, 0, 0, s!).toISOString();
}

export function parseSent(out: string, account: string): SentMessage[] {
  const msgs: SentMessage[] = [];
  for (const rec of records(out)) {
    const [id = "", irt = "", stamp = "", to, cc, subject = "", refs = "", from = ""] = rec.split(FS);
    const date = localStamp(stamp.trim());
    if (!bareId(id) || !date) continue;
    const references = [...refs.matchAll(/<([^<>\s]+)>/g)].map((x) => bareId(x[1])).filter(Boolean);
    msgs.push({ messageId: bareId(id), inReplyTo: bareId(irt) || null, date, to: list(to), cc: list(cc), subject, account, references, from: from.trim() });
  }
  return msgs;
}

/** The Sent mailbox of one account since `since` (local calendar parts are passed, so the script needs no date parsing). */
export async function readSent(osa: OsaRun, account: string, mailbox: string, since: Date): Promise<SentMessage[]> {
  const secs = since.getHours() * 3600 + since.getMinutes() * 60 + since.getSeconds();
  const args = [account, mailbox, String(since.getFullYear()), String(since.getMonth() + 1), String(since.getDate()), String(secs)];
  return parseSent(await osa(SENT_SCRIPT, args), account);
}

/** Mail's accounts: each name and address, lower case, in one list (what a project's `mail.accounts` may name). */
export function parseAccounts(out: string): string[] {
  const known: string[] = [];
  for (const rec of records(out)) {
    const [name = "", addrs] = rec.split(FS);
    if (name.trim()) known.push(name.trim().toLowerCase());
    known.push(...list(addrs));
  }
  return known;
}

/** The names and addresses Mail knows, or null when Mail is not running (it is never started for this). */
export async function readAccounts(osa: OsaRun): Promise<string[] | null> {
  if (!(await mailRunning(osa))) return null;
  return parseAccounts(await osa(ACCOUNTS_SCRIPT, []));
}

/**
 * P96: the inbound messages of one mailbox received since a date. argv: 1 account, 2 mailbox (a name, or a nested path such
 * as `hub/client`; a mailbox the account lacks answers `nobox`, not an error), 3-5 year month day, 6 seconds after local
 * midnight. One record per message: Mail's id, Message-ID, In-Reply-To, References, the sender, the received date as local
 * "y,m,d,seconds", subject, read status, and the bulk headers present (List-Unsubscribe, Auto-Submitted, Precedence). Never
 * the text: that is `CONTENT_SCRIPT`, for the messages judged a client's only. Read-only (0.2 s for a day of one INBOX, 2026-11-21).
 */
export const INBOUND_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set RS to (ASCII character 30)
  set fromDate to current date
  set day of fromDate to 1
  set year of fromDate to (item 3 of argv) as integer
  set month of fromDate to (item 4 of argv) as integer
  set day of fromDate to (item 5 of argv) as integer
  set time of fromDate to (item 6 of argv) as integer
  set out to ""
  tell application "Mail"
    try
      set box to mailbox (item 2 of argv) of account (item 1 of argv)
      get name of box
    on error
      return "nobox"
    end try
    set ms to (messages of box whose date received is greater than or equal to fromDate)
    repeat with m in ms
      set irt to ""
      try
        set irt to content of (first header of m whose name is "In-Reply-To")
      end try
      set refs to ""
      try
        set refs to content of (first header of m whose name is "References")
      end try
      set bulk to ""
      try
        set bulk to bulk & "list " & (content of (first header of m whose name is "List-Unsubscribe"))
      end try
      try
        set bulk to bulk & " auto " & (content of (first header of m whose name is "Auto-Submitted"))
      end try
      try
        set bulk to bulk & " prec " & (content of (first header of m whose name is "Precedence"))
      end try
      set snd to ""
      try
        set snd to sender of m
      end try
      set d to date received of m
      set stamp to ((year of d) as text) & "," & (((month of d) as integer) as text) & "," & ((day of d) as text) & "," & ((time of d) as text)
      set out to out & (id of m) & FS & (message id of m) & FS & irt & FS & refs & FS & snd & FS & stamp & FS & (subject of m) & FS & ((read status of m) as text) & FS & bulk & RS
    end repeat
  end tell
  return "ok" & RS & out
end run`;

/** P96: the text of one message by Mail's id in a known mailbox, at most 4000 characters. argv: 1 account, 2 mailbox, 3 Mail's id. Read-only. */
export const CONTENT_SCRIPT = `on run argv
  tell application "Mail"
    try
      set box to mailbox (item 2 of argv) of account (item 1 of argv)
      set m to (first message of box whose id is ((item 3 of argv) as integer))
      set c to (content of m) as text
      if (length of c) > 4000 then set c to text 1 thru 4000 of c
      return "ok" & (ASCII character 31) & c
    on error
      return "none"
    end try
  end tell
end run`;

/** One message of an inbound mailbox, as the reader judges it. Ids bare. */
export interface ReceivedMessage {
  mailId: number;
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  /** The sender's address, lower case, and the name Mail shows (empty when none). */
  email: string;
  name: string;
  /** ISO 8601 UTC. */
  receivedAt: string;
  subject: string;
  read: boolean;
  /** A bulk or automatic header was present (List-Unsubscribe, Auto-Submitted other than `no`, Precedence bulk/list/junk). */
  bulk: boolean;
  account: string;
  mailbox: string;
}

/** `Name <a@b>` or `a@b` into the address (lower case) and the name. */
export function senderOf(raw: string): { email: string; name: string } {
  const v = raw.trim();
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(v);
  const email = (m?.[1] ?? (/[^\s<>"]+@[^\s<>"]+/.exec(v)?.[0] ?? "")).trim().toLowerCase();
  const name = (m ? v.slice(0, m.index) : "").trim().replace(/^"|"$/g, "").trim();
  return { email, name };
}

const isBulk = (h: string): boolean => /\blist\b/.test(h) || /\bauto (?!no\b)\S/i.test(h) || /\bprec (bulk|list|junk)\b/i.test(h);

/** `null` when the mailbox does not exist in that account (a label the project never made): the reader skips it. */
export function parseInbound(out: string, account: string, mailbox: string): ReceivedMessage[] | null {
  if (out.trim() === "nobox") return null;
  const msgs: ReceivedMessage[] = [];
  const recs = records(out);
  for (const rec of recs[0]?.startsWith("ok") ? recs.slice(1) : recs) {
    const [id = "", mid = "", irt = "", refs = "", snd = "", stamp = "", subject = "", read = "", bulk = ""] = rec.split(FS);
    const receivedAt = localStamp(stamp.trim());
    const mailId = Number(id);
    const s = senderOf(snd);
    if (!bareId(mid) || !receivedAt || !Number.isInteger(mailId) || !s.email) continue;
    const references = [...refs.matchAll(/<([^<>\s]+)>/g)].map((x) => bareId(x[1])).filter(Boolean);
    msgs.push({ mailId, messageId: bareId(mid), inReplyTo: bareId(irt) || null, references, email: s.email, name: s.name, receivedAt, subject, read: read.trim() === "true", bulk: isBulk(bulk), account, mailbox });
  }
  return msgs;
}

/** One mailbox of one account since `since` (local calendar parts, as `readSent`). `null`: no such mailbox. */
export async function readInbound(osa: OsaRun, account: string, mailbox: string, since: Date): Promise<ReceivedMessage[] | null> {
  const secs = since.getHours() * 3600 + since.getMinutes() * 60 + since.getSeconds();
  const args = [account, mailbox, String(since.getFullYear()), String(since.getMonth() + 1), String(since.getDate()), String(secs)];
  return parseInbound(await osa(INBOUND_SCRIPT, args), account, mailbox);
}

/** The text of one message, or null when Mail no longer has it there. */
export async function readMessageText(osa: OsaRun, account: string, mailbox: string, mailId: number): Promise<string | null> {
  const out = await osa(CONTENT_SCRIPT, [account, mailbox, String(mailId)]);
  const i = out.indexOf(FS);
  return out.startsWith("ok") && i >= 0 ? out.slice(i + 1) : null;
}

/**
 * The client's own words of a message: what is above the quote of the earlier mail. The quote starts at a line that is a
 * reply header (`On … wrote:`, any line ending in `<address>:` as Gmail writes it in other languages, `-----Original
 * Message-----`, `From: …` after a blank line) or at the first `>` line. `quoted` says whether anything was cut.
 */
export function ownText(content: string): { text: string; quoted: boolean } {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = (lines[i] ?? "").trim();
    if (/^>/.test(l) || /^On\b.*\bwrote:$/i.test(l) || /<[^<>\s]+@[^<>\s]+>:$/.test(l) || /^-{2,}\s*Original Message\s*-{2,}$/i.test(l) || (/^From:\s/i.test(l) && i > 0 && (lines[i - 1] ?? "").trim() === "")) {
      cut = i;
      break;
    }
  }
  return { text: lines.slice(0, cut).join("\n").trim(), quoted: cut < lines.length };
}

/** At most `n` characters of the client's own words on one line (the stored preview, decision 0013). */
export const previewOf = (content: string, n: number): string => ownText(content).text.replace(/\s+/g, " ").trim().slice(0, n);

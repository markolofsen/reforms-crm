import { HUB_DRAFT_MARKER } from "@hub/config";
import { bareId, type OsaRun } from "@hub/send";

// The server's read-only questions to Apple Mail (decision 0026), through `osascript` behind an injectable `OsaRun`:
// is Mail running, what is in an account's Sent mailbox since a date, which accounts does Mail have. Nothing here
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
 * One record per message: Message-ID, In-Reply-To, the sent date as local "y,m,d,seconds", To, Cc, subject, and the
 * first 300 characters of the text (where a `[hub-draft ...]` marker would be). A Gmail account's Sent is `[Gmail]/<name>`.
 */
export const SENT_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set RS to (ASCII character 30)
  set LS to (ASCII character 29)
  set since to current date
  set day of since to 1
  set year of since to (item 3 of argv) as integer
  set month of since to (item 4 of argv) as integer
  set day of since to (item 5 of argv) as integer
  set time of since to (item 6 of argv) as integer
  set out to ""
  tell application "Mail"
    set acc to account (item 1 of argv)
    try
      set box to mailbox (item 2 of argv) of acc
      get name of box
    on error
      set box to mailbox ("[Gmail]/" & (item 2 of argv)) of acc
    end try
    set ms to (messages of box whose date sent is greater than or equal to since)
    repeat with m in ms
      set irt to ""
      try
        set irt to content of (first header of m whose name is "In-Reply-To")
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
      set head to ""
      try
        set head to content of m
        if (length of head) > 300 then set head to text 1 thru 300 of head
      end try
      set d to date sent of m
      set stamp to ((year of d) as text) & "," & (((month of d) as integer) as text) & "," & ((day of d) as text) & "," & ((time of d) as text)
      set out to out & (message id of m) & FS & irt & FS & stamp & FS & tos & FS & ccs & FS & (subject of m) & FS & head & RS
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
  /** The thread id of a `[hub-draft thread=...]` line left in the text, bare; null when there is none. */
  marker: string | null;
  account: string;
}

export async function mailRunning(osa: OsaRun): Promise<boolean> {
  return (await osa(RUNNING_SCRIPT, [])).trim() === "true";
}

const list = (v: string | undefined) => (v ?? "").split(LS).map((x) => x.trim().toLowerCase()).filter(Boolean);
const records = (out: string) => out.split(RS).map((r) => r.replace(/^[\r\n]+/, "")).filter((r) => r.trim() !== "");

/** The thread id a `[hub-draft thread=<id>]` line names. */
export function markerThread(text: string): string | null {
  const line = text.match(HUB_DRAFT_MARKER)?.[0];
  const id = line ? /thread=([^\]\s]+)/i.exec(line)?.[1] : undefined;
  return id ? bareId(id) || null : null;
}

/** Mail's local "y,m,d,seconds" as an instant: the Date constructor applies this machine's zone and DST, as Mail did. */
function localStamp(stamp: string): string | null {
  const [y, m, d, s] = stamp.split(",").map(Number);
  if (![y, m, d, s].every((n) => Number.isFinite(n))) return null;
  return new Date(y!, m! - 1, d!, 0, 0, s!).toISOString();
}

export function parseSent(out: string, account: string): SentMessage[] {
  const msgs: SentMessage[] = [];
  for (const rec of records(out)) {
    const [id = "", irt = "", stamp = "", to, cc, subject = "", head = ""] = rec.split(FS);
    const date = localStamp(stamp.trim());
    if (!bareId(id) || !date) continue;
    msgs.push({ messageId: bareId(id), inReplyTo: bareId(irt) || null, date, to: list(to), cc: list(cc), subject, marker: markerThread(head), account });
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

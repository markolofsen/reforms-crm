import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { adoptable, type Adoption, type MailVersionRow, type MailWriteRow } from "@hub/db";
import { replyFrom, type ReplyFrom } from "@hub/projects";

// The hub's draft writer (P52, decision 0030; decision 0031 for what it no longer writes): an unsent reply saved in
// Mail's Drafts, written by the `hub` MCP server (outside the agent's sandbox) through Mail's own scripting, with no
// window, no focus and no clipboard. It writes the reply text and nothing else: no marker line, no hidden text (0031).
// It never sends: the script has no `send`. It finds the draft it saved as a NEW draft of this subject, in any of the
// project's accounts (Mail saves a draft in its From's account, P65 S5), whose In-Reply-To is the answered message and
// whose text starts with the written text. Its removals: the older versions the caller names by account and `message id`
// (the Hub's `mail_versions` record), each re-checked in the script just before Mail's delete (moved to the account's
// Trash by Mail), and this run's own extras (a second save of the same text, Mail's empty reply shell; decision 0031
// addendum point 4). Nothing else is ever deleted, and nothing is deleted when the new draft is not seen. Mail slow (not
// seen within the wait): the write is `mail_slow`, not failed; the caller's write record lets a late save be adopted.

/** Runs osascript with the script and its arguments (`on run argv`). Injected so tests never reach Mail. */
export type OsaRun = (script: string, args: string[]) => Promise<string>;

/** How long the writer waits for Mail to show the draft it saved (P65 S5: Mail took 74 s once on 2026-11-19; past this the write is `mail_slow`). */
export const WRITE_WAIT_SECONDS = 45;

/** osascript was cut at its budget: Mail did not answer (the write may still land). */
export class OsaTimeout extends Error {}

/** osascript with a budget: well past the writer's own wait, so a slow Mail still ends in the script's `pending`. */
export const osaWithin = (timeoutMs: number): OsaRun => (script, args) =>
  new Promise((resolve, reject) =>
    execFile("osascript", ["-e", script, ...args], { timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      if ((err as { killed?: boolean }).killed) return reject(new OsaTimeout(`Mail did not answer within ${Math.round(timeoutMs / 1000)} s`));
      reject(new Error(String(stderr || err.message).slice(0, 300)));
    }),
  );

export const defaultOsa: OsaRun = osaWithin(150_000);

/**
 * What the agent (and a person's Save) is told when Mail is slow (P65 S5). It never asks anyone to delete a draft and
 * never says "write again": a second write while the first is still landing is what made two drafts on 2026-11-19.
 */
export const MAIL_SLOW_TEXT = "Mail is slow: it has not shown the saved draft yet. The write may still land in Drafts; the Hub recorded it and adopts it as this draft's version when it appears (at the next write, the card's next read, or hub drafts sweep). Nothing older was replaced. Do not call draft_write again for this draft now: tell the owner in one line that Mail is slow and the new text will show on the card when Mail saves it.";

/**
 * What a refusal of a draft write lets the caller do next (P83: the dock agent repeated an identical failing call five
 * times and named a permission nobody had measured). `retry`: `now` after changing what `next` says, `after_owner` only
 * once the owner did what `next` says, `no` never in this turn. Only `mail_not_allowed` speaks of a permission.
 */
export type RetryAdvice = { retry: "now" | "after_owner" | "no"; next: string };
const NO_RETRY = "Do not call draft_write again for this draft in this turn.";
export const WRITE_ADVICE: Readonly<Record<string, RetryAdvice>> = {
  own_signoff: { retry: "now", next: "Remove your closing as the message says, then call draft_write once with the new text." },
  invalid: { retry: "now", next: "Fix the arguments as the message says." },
  empty: { retry: "now", next: "Give the reply's text." },
  mail_not_running: { retry: "after_owner", next: "Ask the owner in one line to open Mail (it may stay in the background), then call draft_write once more. The Hub does not open Mail itself: opening Mail sends whatever waits in its Outbox." },
  mail_not_allowed: { retry: "after_owner", next: "Tell the owner in one line: System Settings ▸ Privacy & Security ▸ Automation, allow the Hub's process to control Mail; then call draft_write once more." },
  content_refused: { retry: "no", next: `Another call, with this text or another, gives the same result. ${NO_RETRY} Tell the owner in one line: the Hub's Mail writer refused the reply, nothing was saved, it is a Hub fault (in the session log), not a macOS permission.` },
  mail_slow: { retry: "no", next: `${NO_RETRY} Tell the owner in one line that Mail is slow and the new text shows on the card when Mail saves it.` },
  already_sent: { retry: "no", next: `${NO_RETRY} Tell the owner in one line what the message says; never write the text as a new reply to the same message.` },
  already_drafted: { retry: "no", next: "Revise the draft the message names, with draft = its id, when the owner asks." },
  no_message: { retry: "no", next: `${NO_RETRY} Tell the owner in one line that the client's message is no longer in Mail.` },
  no_account: { retry: "no", next: `${NO_RETRY} Tell the owner in one line that Mail has no such account (Settings ▸ Mail).` },
  mail_error: { retry: "no", next: `${NO_RETRY} Tell the owner in one line what Mail answered.` },
};
/**
 * P83 verdict 2: a sent draft is not revised (the agent's draft_write, the admin's Save and Restore), and its text is
 * not written as a second draft of the message it answered: Sent detection and the send door match a draft by that
 * message, so a second one would read as sent at once.
 */
export const alreadySentText = (id: number, sentAt: string | null): string =>
  `Draft ${id} was sent${sentAt ? ` (${sentAt.slice(0, 16).replace("T", " ")})` : ""}: a sent mail is not revised, and the Hub keeps one draft per message it answers. The next reply answers the client's next message and gets its own draft; a nudge now is a follow-up the owner sends from Mail. Nothing was written.`;

export const adviceOf = (code: string): RetryAdvice => WRITE_ADVICE[code] ?? { retry: "no", next: NO_RETRY };

/** One Mail version the Hub wrote, as the replace step needs it: the account it sits in and its own Message-ID. */
export interface VersionRef {
  account: string;
  messageId: string;
}

export interface ReplyDraftInput {
  /** Mail account name of the message answered (as mail-mcp names it). */
  account: string;
  /** Mailbox path of that message, e.g. ["INBOX"]. */
  mailboxPath: string[];
  /** Mail's integer id of the message answered (mail-mcp `message_id`). */
  messageId: number;
  /** Plain text of the reply. */
  body: string;
  /** The From to use when Mail would pick an address outside this account; null: the account's first address. */
  sender: string | null;
  /**
   * `add` (default, the agent's reply): the writer appends "On <date>, <sender> wrote:" and a `> ` quote of the original.
   * `keep` (P56, a person's Save or a Restore): `body` is the whole text, quote included as the person left it, written verbatim.
   */
  quote?: "add" | "keep";
  /** The Hub's older versions of the thread (from `mail_versions`), each in its own account: moved to Trash after the save. */
  replace?: readonly VersionRef[];
  /** The accounts Mail may save the draft in (the project's `mail.accounts`); absent: only `account`. */
  landIn?: readonly string[];
  /** Seconds to wait for the saved draft (default `WRITE_WAIT_SECONDS`). */
  waitSeconds?: number;
}

export interface ReplyDraftResult {
  /** Mail's id of the new draft in the Drafts mailbox. */
  draftId: number;
  /** The new draft's own Message-ID, bare: the identity the Hub records (`mail_versions`). */
  messageId: string;
  /** The text Mail returned after the save: what the version's hash is taken of (never stored). */
  text: string;
  subject: string;
  /** The answered message's Message-ID, bare: the `mailRef` for `hub record-draft`. */
  thread: string;
  from: string;
  /** Message-IDs of the older versions that were moved to Trash. */
  replaced: string[];
  /** Message-IDs of older versions Mail refused to move (still in Drafts): `hub drafts sweep` lists them. */
  left: string[];
  /** The account the new draft sits in (Mail saves it in its From's account). */
  savedIn: string;
  /** Mail's reply shell as the writer saw it before it set the text (its hash goes on the write record), or "". */
  shell: string;
}

export class DraftWriteError extends Error {
  /** `mail_slow`: Mail's reply shell, when the writer saw it (its hash goes on the write record). */
  shell?: string;
  constructor(readonly code: string, message: string, shell?: string) {
    super(message);
    if (shell !== undefined) this.shell = shell;
  }
}

/** One draft of a thread as Mail holds it (P65 S5): what a late save is matched against before a write. */
export interface ThreadMailDraft {
  ref: string;
  messageId: string | null;
  account: string | null;
  body: string;
}

/** Where the message a draft answers sits in Mail: what `writeReply` needs, found from its Message-ID (P53). */
export interface InboundMessage {
  account: string;
  mailboxPath: string[];
  messageId: number;
  /** P58: the receiving account's own addresses in Mail (`email addresses of acc`: what it can send as). Absent: not read. */
  accountAddresses?: string[];
}

export interface DraftWriter {
  writeReply(input: ReplyDraftInput): Promise<ReplyDraftResult>;
  /** The message with this Message-ID in one of these accounts (INBOX first, then the other mailboxes but Drafts, Sent, Trash and Spam), or null. */
  findInbound(accounts: readonly string[], messageId: string): Promise<InboundMessage | null>;
  /**
   * The raw header block of one known message (P60): what `resolveBrand` reads to learn the address the client wrote to.
   * A direct lookup by Mail's id in a known mailbox, not a search. Read-only.
   */
  readHeaders(m: InboundMessage): Promise<string>;
  /** The text of one known message (P65 S5: Mail's empty reply to it is recognised as Mail's, not the owner's). Read-only. */
  readContent(m: InboundMessage): Promise<string>;
  /** The Message-ID of one known message, bare (P65: a new reply is refused before it is written when the project already answers it). Read-only. */
  messageIdOf(m: InboundMessage): Promise<string>;
  /** P58: one account's own addresses in Mail (`email addresses of acc`: what it can send as); [] when Mail has no such account. Read-only. */
  addressesOf(account: string): Promise<string[]>;
  /** The drafts of these accounts whose In-Reply-To names the thread (P65 S5), with their text. Read-only. */
  threadDrafts(accounts: readonly string[], thread: string, subject: string | null): Promise<ThreadMailDraft[]>;
}

const FS = "\x1f";
const LS = "\x1d";
const RS = "\x1e";
const PS = "\x1c";

/** The fingerprint of a version's text as Mail returned it (decision 0013: the hash, never the text). */
export const versionHash = (text: string): string => createHash("sha256").update(text.replace(/\s+$/, "")).digest("hex");

/** What the script checks Mail took: the body's first 40 characters (Mail may rewrap or add an HTML part, never drop the start). */
export const probeOf = (body: string): string => body.replace(/^\s+/, "").slice(0, 40);

// argv: 1 account, 2 mailbox path (LS-joined), 3 message id, 4 body, 5 sender or "", 6 "keep" to write the body verbatim
// (no quote added; P56), 7 the probe (the body's first 40 characters), 8 the versions to replace (LS-joined, each
// "account PS Message-ID"), 9 the accounts Mail may save the draft in (LS-joined: the project's; Mail saves a draft in its
// From's account, P65 S5), 10 how many seconds to wait for the saved draft. Output: ok FS draftId FS subject FS thread FS
// from FS replaced (LS) FS left (LS) FS new message id FS its account FS cleared Mail ids (LS) FS Mail's reply shell FS
// the text read back; or pending FS Mail's reply shell (the draft was not seen in time: it may still land); or error FS
// code FS message. A message Mail flags as deleted (pending expunge) is not a draft.
export const WRITE_REPLY_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set LS to (ASCII character 29)
  set PS to (ASCII character 28)
  if application "Mail" is not running then return "error" & FS & "mail_not_running" & FS & "Mail is not running: open Mail (it may stay in the background), then write the draft again."
  set accName to item 1 of argv
  set boxPath to my parts(item 2 of argv, LS)
  set srcId to (item 3 of argv) as integer
  set theBody to item 4 of argv
  set wantSender to item 5 of argv
  set addQuote to (item 6 of argv) is not "keep"
  set probe to item 7 of argv
  set targets to my parts(item 8 of argv, LS)
  set landIn to my parts(item 9 of argv, LS)
  if (count of landIn) is 0 then set landIn to {accName}
  set waitSecs to (item 10 of argv) as integer
  tell application "Mail"
    try
      set acc to account accName
      set accAddrs to email addresses of acc
    on error
      return "error" & FS & "no_account" & FS & "No Mail account named " & accName & "."
    end try
    try
      set box to acc
      repeat with p in boxPath
        set box to mailbox (contents of p) of box
      end repeat
      set src to (first message of box whose id is srcId)
    on error
      return "error" & FS & "no_message" & FS & "No message " & srcId & " in that mailbox of " & accName & "."
    end try
    set thread to message id of src
    set origText to ""
    try
      set origText to (content of src) as text
    end try
    set tail to ""
    if addQuote then set tail to linefeed & linefeed & "On " & ((date sent of src) as string) & ", " & (sender of src) & " wrote:" & linefeed & my quoteOf(origText)
    -- Every draft that exists before the reply: whatever appears after it is this write's (one bulk read).
    set priorIds to id of every message of drafts mailbox
    set r to reply src opening window false
    set subj to subject of r
    -- Never read the reply's content before it is set (P83): on Mail 16 that read returns "" and Mail then ignores every
    -- set of it, so each write ended in content_refused (measured 2026-11-20). Mail's shell is recognised by its form instead.
    set shellText to ""
    set fromNow to sender of r
    set inAccount to false
    repeat with a in accAddrs
      if fromNow contains (contents of a) then set inAccount to true
    end repeat
    if wantSender is not "" then
      -- P58: the From the Hub chose (TS decides it). Mail's own pick is kept when it already is that address (its display name stays).
      if fromNow does not contain wantSender then set sender of r to wantSender
    else if not inAccount then
      set fullName to ""
      try
        set fullName to full name of acc
      end try
      if fullName is "" or fullName is missing value then
        set sender of r to (item 1 of accAddrs)
      else
        set sender of r to fullName & " <" & (item 1 of accAddrs) & ">"
      end if
    end if
    set content of r to (theBody & tail)
    delay 0.3
    if ((content of r) as text) does not contain probe then
      delete r
      -- Mail keeps a refused reply in Drafts (P83, 2026-11-20): this run's own, recognised by its form, goes to Trash.
      set cleared to ""
      set deadline to (current date) + 6
      repeat
        repeat with fid in my threadDrafts(subj, landIn, thread, priorIds)
          try
            set m to (first message of drafts mailbox whose id is (contents of fid))
            if (deleted status of m) is false and my isShell((content of m) as text, origText) then
              delete m
              set cleared to cleared & (contents of fid) & LS
            end if
          end try
        end repeat
        if cleared is not "" or (current date) > deadline then exit repeat
        delay 0.5
      end repeat
      return "error" & FS & "content_refused" & FS & "Mail did not take the text of the reply. This is the Hub's Mail writer, not a macOS permission (a missing permission is mail_not_allowed). Nothing was saved or replaced." & FS & cleared
    end if
    save r
    delay 0.5
    set fromNow to sender of r
    delete r
    -- Wait for the saved draft: a new draft of this thread, in any account Mail may have saved it in, holding the text's start.
    set mine to {}
    set shells to {}
    set deadline to (current date) + waitSecs
    repeat
      set mine to {}
      set shells to {}
      repeat with fid in my threadDrafts(subj, landIn, thread, priorIds)
        set t to ""
        try
          set t to (content of (first message of drafts mailbox whose id is (contents of fid))) as text
        end try
        considering case
          if t contains probe then
            set end of mine to (contents of fid)
          else if my isShell(t, origText) then
            set end of shells to (contents of fid)
          end if
        end considering
      end repeat
      if (count of mine) > 0 or (current date) > deadline then exit repeat
      delay 0.5
    end repeat
    if (count of mine) is 0 then return "pending" & FS & shellText
    set newId to item 1 of mine
    repeat with x in mine
      if (contents of x) > newId then set newId to (contents of x)
    end repeat
    set nm to (first message of drafts mailbox whose id is newId)
    set newMid to message id of nm
    set newAcc to name of account of mailbox of nm
    set readBack to (content of nm) as text
    -- This run's own extras: a second save of the same text, and Mail's empty reply shell.
    set cleared to ""
    repeat with x in (mine & shells)
      set xid to contents of x
      if xid is not newId then
        try
          set m to (first message of drafts mailbox whose id is xid)
          if (deleted status of m) is false then
            delete m
            set cleared to cleared & xid & LS
          end if
        end try
      end if
    end repeat
    set replaced to ""
    set leftIds to ""
    repeat with t in targets
      set pair to my parts(contents of t, PS)
      set tAcc to item 1 of pair
      set tid to item 2 of pair
      -- Resolved to Mail's own reference by id before the delete: a \`repeat with m in (messages …)\` item is not one (v0.12.15).
      try
        -- Bound to a list first: looping straight over the ids expression gives a specifier Mail cannot iterate (read-only check, 2026-11-19).
        set found to id of (messages of drafts mailbox whose message id is tid)
        repeat with fid in found
          set m to (first message of drafts mailbox whose id is (contents of fid))
          if (id of m) is not newId and (deleted status of m) is false and (name of account of mailbox of m) is tAcc and (message id of m) is tid then
            delete m
            set replaced to replaced & tid & LS
          end if
        end repeat
      on error
        set leftIds to leftIds & tid & LS
      end try
    end repeat
  end tell
  return "ok" & FS & newId & FS & subj & FS & thread & FS & fromNow & FS & replaced & FS & leftIds & FS & newMid & FS & newAcc & FS & cleared & FS & shellText & FS & readBack
end run

on threadDrafts(subj, accNames, thread, skipIds)
  set out to {}
  tell application "Mail"
    repeat with m in (messages of drafts mailbox whose subject is subj)
      set mid to id of m
      if skipIds does not contain mid and out does not contain mid and (deleted status of m) is false then
        set acc to ""
        try
          set acc to name of account of mailbox of m
        end try
        set irt to ""
        try
          set irt to content of (first header of m whose name is "In-Reply-To")
        end try
        if accNames contains acc and irt contains thread then set end of out to mid
      end if
    end repeat
  end tell
  return out
end threadDrafts

on quoteOf(t)
  set out to ""
  set n to 0
  repeat with p in paragraphs of t
    set n to n + 1
    if n > 80 then exit repeat
    set out to out & "> " & (contents of p) & linefeed
  end repeat
  return out
end quoteOf

-- Mail's own reply shell (P83; the form @hub/db isReplyShell matches): no text at all, or one attribution line ending
-- in ":" over the quoted original and nothing else. Whitespace and quote marks are ignored on both sides.
on isShell(t, orig)
  set flatT to my squeeze(t)
  if flatT is "" then return true
  set flatO to my squeeze(orig)
  if flatO is "" then return false
  set hd to ""
  repeat with p in paragraphs of t
    if my squeeze(contents of p) is not "" then
      set hd to my squeeze(contents of p)
      exit repeat
    end if
  end repeat
  if (length of hd) > 300 or hd does not end with ":" then return false
  considering case
    return flatT is (hd & flatO)
  end considering
end isShell

on squeeze(s)
  set AppleScript's text item delimiters to {space, tab, linefeed, return, ">", character id 160}
  set xs to text items of s
  set AppleScript's text item delimiters to ""
  set out to xs as text
  return out
end squeeze

on parts(s, d)
  if s is "" then return {}
  set AppleScript's text item delimiters to d
  set r to text items of s
  set AppleScript's text item delimiters to ""
  return r
end parts`;

// argv: 1 the thread's Message-ID (bare), 2 subject ("" for any), 3.. the accounts. Output: one record per draft of those
// accounts whose In-Reply-To names the thread: id FS message id FS account FS text RS. Read-only (P65 S5: what a late
// save is matched against before a write).
export const THREAD_DRAFTS_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set RS to (ASCII character 30)
  if application "Mail" is not running then return "error" & FS & "mail_not_running" & FS & "Mail is not running: open Mail (it may stay in the background), then write the draft again."
  set thread to item 1 of argv
  set subj to item 2 of argv
  set accNames to {}
  repeat with i from 3 to (count of argv)
    set end of accNames to item i of argv
  end repeat
  set out to ""
  tell application "Mail"
    if subj is "" then
      set ms to (messages of drafts mailbox)
    else
      set ms to (messages of drafts mailbox whose subject is subj)
    end if
    repeat with m in ms
      if (deleted status of m) is false then
        set acc to ""
        try
          set acc to name of account of mailbox of m
        end try
        set irt to ""
        try
          set irt to content of (first header of m whose name is "In-Reply-To")
        end try
        if accNames contains acc and irt contains thread then set out to out & (id of m) & FS & (message id of m) & FS & acc & FS & ((content of m) as text) & RS
      end if
    end repeat
  end tell
  return out
end run`;

// argv: 1 account, 2 mailbox path (LS-joined), 3 Mail's message id. Output: ok FS Message-ID, or error FS code FS message. Read-only.
export const MESSAGE_ID_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set LS to (ASCII character 29)
  if application "Mail" is not running then return "error" & FS & "mail_not_running" & FS & "Mail is not running: open Mail (it may stay in the background), then write the draft again."
  set boxPath to my parts(item 2 of argv, LS)
  tell application "Mail"
    try
      set box to account (item 1 of argv)
      repeat with p in boxPath
        set box to mailbox (contents of p) of box
      end repeat
      return "ok" & FS & (message id of (first message of box whose id is ((item 3 of argv) as integer)))
    on error
      return "error" & FS & "no_message" & FS & "No message " & (item 3 of argv) & " in that mailbox of " & (item 1 of argv) & "."
    end try
  end tell
end run

on parts(s, d)
  if s is "" then return {}
  set AppleScript's text item delimiters to d
  set r to text items of s
  set AppleScript's text item delimiters to ""
  return r
end parts`;

// argv: 1 Message-ID (bare), 2.. account names. Output: ok FS account FS mailbox name FS id FS the account's own
// addresses (LS-joined: what it can send as, P58), or none. Read-only. INBOX
// first (3 s on a 43-message Gmail INBOX, measured 2026-11-19); the account's other mailboxes only when it is not there.
export const FIND_INBOUND_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set mid to item 1 of argv
  set skipNames to {"Drafts", "Sent", "Sent Mail", "Sent Messages", "Trash", "Deleted Messages", "Bin", "Spam", "Junk"}
  if application "Mail" is not running then return "error" & FS & "mail_not_running" & FS & "Mail is not running: open Mail (it may stay in the background), then write the draft again."
  tell application "Mail"
    repeat with i from 2 to (count of argv)
      set accName to item i of argv
      try
        set acc to account accName
        try
          set m to (first message of mailbox "INBOX" of acc whose message id is mid)
          return "ok" & FS & accName & FS & "INBOX" & FS & (id of m) & FS & my addrs(acc)
        end try
      end try
    end repeat
    repeat with i from 2 to (count of argv)
      set accName to item i of argv
      try
        set acc to account accName
        repeat with b in (mailboxes of acc)
          set bn to name of b
          if bn is not "INBOX" and skipNames does not contain bn then
            try
              set m to (first message of b whose message id is mid)
              return "ok" & FS & accName & FS & bn & FS & (id of m) & FS & my addrs(acc)
            end try
          end if
        end repeat
      end try
    end repeat
  end tell
  return "none"
end run

on addrs(acc)
  set LS to (ASCII character 29)
  set out to ""
  tell application "Mail"
    try
      -- Bound to a list first: looping straight over the property gives items Mail cannot coerce to text (read-only check, 2026-11-20).
      set lst to email addresses of acc
      repeat with a in lst
        set out to out & (contents of a) & LS
      end repeat
    end try
  end tell
  return out
end addrs`;

// argv: 1 account name. Output: ok FS its own addresses (LS-joined), or error FS code FS message. Read-only (P58).
export const ACCOUNT_ADDRESSES_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set LS to (ASCII character 29)
  if application "Mail" is not running then return "error" & FS & "mail_not_running" & FS & "Mail is not running."
  set out to ""
  tell application "Mail"
    try
      set lst to email addresses of account (item 1 of argv)
      repeat with a in lst
        set out to out & (contents of a) & LS
      end repeat
    on error
      return "error" & FS & "no_account" & FS & "No Mail account named " & (item 1 of argv) & "."
    end try
  end tell
  return "ok" & FS & out
end run`;

// argv: 1 account, 2 mailbox path (LS-joined), 3 Mail's message id. Output: ok FS <all headers>, or error FS code FS message. Read-only.
export const READ_HEADERS_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set LS to (ASCII character 29)
  if application "Mail" is not running then return "error" & FS & "mail_not_running" & FS & "Mail is not running."
  set boxPath to my parts(item 2 of argv, LS)
  tell application "Mail"
    try
      set box to account (item 1 of argv)
      repeat with p in boxPath
        set box to mailbox (contents of p) of box
      end repeat
      set m to (first message of box whose id is ((item 3 of argv) as integer))
      return "ok" & FS & ((all headers of m) as text)
    on error
      return "error" & FS & "no_message" & FS & "No message " & (item 3 of argv) & " in that mailbox."
    end try
  end tell
end run

on parts(s, d)
  if s is "" then return {}
  set AppleScript's text item delimiters to d
  set r to text items of s
  set AppleScript's text item delimiters to ""
  return r
end parts`;

// argv: 1 account, 2 mailbox path (LS-joined), 3 Mail's message id. Output: ok FS <content>, or error FS code FS message. Read-only.
export const READ_CONTENT_SCRIPT = READ_HEADERS_SCRIPT.replace("((all headers of m) as text)", "((content of m) as text)");

export function parseInboundOutput(out: string): InboundMessage | null {
  const p = out.replace(/[\r\n]+$/, "").split(FS);
  if (p[0] === "error") throw new DraftWriteError(p[1] || "mail_error", p[2] || "Mail refused the lookup.");
  if (p[0] !== "ok" || p.length < 4) return null;
  const id = Number(p[3]);
  if (!Number.isInteger(id) || id <= 0) return null;
  const addresses = (p[4] ?? "").split(LS).map((x) => x.trim()).filter(Boolean);
  return { account: p[1] as string, mailboxPath: [p[2] as string], messageId: id, ...(p.length > 4 ? { accountAddresses: addresses } : {}) };
}

export function parseWriteOutput(out: string): ReplyDraftResult {
  const t = out.replace(/[\r\n]+$/, "");
  const p = t.split(FS);
  if (p[0] === "error") {
    // P83: a refused reply Mail kept in Drafts was this run's own and went to Trash; its Mail ids are said, never asked of anyone.
    const cleared = [...new Set((p[3] ?? "").split(LS).map((x) => x.trim()).filter(Boolean))];
    const note = cleared.length ? ` Mail kept the refused reply in Drafts; the Hub moved it to Trash (Mail id ${cleared.join(", ")}).` : "";
    throw new DraftWriteError(p[1] || "mail_error", `${p[2] || "Mail refused the draft."}${note}`);
  }
  if (p[0] === "pending") throw new DraftWriteError("mail_slow", MAIL_SLOW_TEXT, p.slice(1).join(FS));
  if (p[0] !== "ok" || p.length < 12) throw new DraftWriteError("mail_error", `Mail answered "${out.trim().slice(0, 100)}"`);
  const [, id, subject, thread, from, replaced, left, mid, savedIn, , shell] = p as [string, string, string, string, string, string, string, string, string, string, string];
  const text = p.slice(11).join(FS);
  const ids = (v: string) => [...new Set(v.split(LS).map((x) => x.trim().replace(/^<|>$/g, "")).filter(Boolean))];
  const messageId = mid.trim().replace(/^<|>$/g, "");
  if (!messageId) throw new DraftWriteError("mail_error", "Mail saved the draft but gave it no Message-ID; nothing was replaced.");
  return { draftId: Number(id), messageId, text, subject, thread: thread.trim().replace(/^<|>$/g, ""), from, replaced: ids(replaced), left: ids(left), savedIn: savedIn.trim(), shell };
}

export function parseThreadDrafts(out: string): ThreadMailDraft[] {
  const t = out.replace(/[\r\n]+$/, "");
  if (t.startsWith(`error${FS}`)) {
    const [, code = "mail_error", message = "Mail refused the read."] = t.split(FS);
    throw new DraftWriteError(code, message);
  }
  const list: ThreadMailDraft[] = [];
  for (const rec of t.split(RS)) {
    const p = rec.replace(/^[\r\n]+/, "").split(FS);
    if (p.length < 4) continue;
    const [ref, mid, account] = p as [string, string, string];
    list.push({ ref: ref.trim(), messageId: mid.trim().replace(/^<|>$/g, "") || null, account: account || null, body: p.slice(3).join(FS) });
  }
  return list;
}

/** macOS refused the Apple events (-1743): the one case that is a permission (P83). */
export const isNotAllowed = (message: string): boolean => /-1743\b|not authori[sz]ed to send apple events/i.test(message);

/** Mail.app through osascript, run by the hub MCP server. Plain text. */
export function mailAppDraftWriter(osa: OsaRun = defaultOsa): DraftWriter {
  const fail = (e: Error) => {
    if (isNotAllowed(e.message)) throw new DraftWriteError("mail_not_allowed", `macOS did not let the Hub control Mail (${e.message.slice(0, 120)}).`);
    throw new DraftWriteError("mail_error", e.message);
  };
  const readBlock = async (script: string, m: InboundMessage): Promise<string> => {
      const out = await osa(script, [m.account, m.mailboxPath.join(LS), String(m.messageId)]).catch(fail);
      const i = out.indexOf(FS);
      const head = i < 0 ? out.trim() : out.slice(0, i);
      if (head === "error") {
        const [, code = "mail_error", message = "Mail refused the header read."] = out.replace(/[\r\n]+$/, "").split(FS);
        throw new DraftWriteError(code, message);
      }
      if (head !== "ok") throw new DraftWriteError("mail_error", `Mail answered "${out.trim().slice(0, 100)}"`);
      return out.slice(i + 1);
    };
  return {
    async writeReply(i) {
      const body = i.body.trimEnd();
      if (!body.trim()) throw new DraftWriteError("empty", "The reply has no text.");
      const targets = (i.replace ?? []).map((v) => `${v.account}${PS}${v.messageId.trim().replace(/^<|>$/g, "")}`).join(LS);
      const land = [...new Set([i.account, ...(i.landIn ?? [])])].join(LS);
      const out = await osa(WRITE_REPLY_SCRIPT, [i.account, i.mailboxPath.join(LS), String(i.messageId), body, i.sender ?? "", i.quote ?? "add", probeOf(body), targets, land, String(i.waitSeconds ?? WRITE_WAIT_SECONDS)]).catch((e: Error) => {
        // Cut at the budget: Mail may still save it, exactly like the script's own `pending`.
        if (e instanceof OsaTimeout) throw new DraftWriteError("mail_slow", MAIL_SLOW_TEXT);
        return fail(e);
      });
      return parseWriteOutput(out);
    },
    async threadDrafts(accounts, thread, subject) {
      const id = thread.trim().replace(/^<|>$/g, "");
      if (!id || accounts.length === 0) return [];
      return parseThreadDrafts(await osa(THREAD_DRAFTS_SCRIPT, [id, subject ?? "", ...accounts]).catch(fail));
    },
    async findInbound(accounts, messageId) {
      const id = messageId.trim().replace(/^<|>$/g, "");
      if (!id || accounts.length === 0) return null;
      return parseInboundOutput(await osa(FIND_INBOUND_SCRIPT, [id, ...accounts]).catch(fail));
    },
    async addressesOf(account) {
      const p = (await osa(ACCOUNT_ADDRESSES_SCRIPT, [account]).catch(fail)).replace(/[\r\n]+$/, "").split(FS);
      if (p[0] !== "ok") return [];
      return (p[1] ?? "").split(LS).map((x) => x.trim()).filter(Boolean);
    },
    readContent: (m) => readBlock(READ_CONTENT_SCRIPT, m),
    readHeaders: (m) => readBlock(READ_HEADERS_SCRIPT, m),
    async messageIdOf(m) {
      const p = (await osa(MESSAGE_ID_SCRIPT, [m.account, m.mailboxPath.join(LS), String(m.messageId)]).catch(fail)).replace(/[\r\n]+$/, "").split(FS);
      if (p[0] === "error") throw new DraftWriteError(p[1] || "mail_error", p[2] || "Mail refused the lookup.");
      const id = (p[1] ?? "").trim().replace(/^<|>$/g, "");
      if (p[0] !== "ok" || !id) throw new DraftWriteError("mail_error", "Mail gave the message no Message-ID.");
      return id;
    },
  };
}

/** In memory: what tests use. A write replaces exactly the versions it is told to, in the same account, as Mail does. */
export class FakeDraftWriter implements DraftWriter {
  /** `quote`: whether the real writer would have appended the quote of the original (`add`) or written the text verbatim (`keep`). */
  drafts: Array<{ id: number; messageId: string; account: string; thread: string; subject: string; text: string; quote: "add" | "keep"; /** The From the writer was asked for (P58), else the account. */ from?: string }> = [];
  private next = 1000;
  /** Inbound messages the fake Mail holds, by Message-ID. */
  inbound = new Map<string, InboundMessage>();
  /** Raw header blocks of the fake Mail's messages, by Mail's id. */
  headers = new Map<number, string>();
  /** Set: the next write is not seen in time (`mail_slow`); the draft is still saved, as Mail does late. */
  slowNext = false;
  constructor(private readonly threadOf: (messageId: number) => string = (id) => `m${id}@example.com`) {}
  async findInbound(accounts: readonly string[], messageId: string): Promise<InboundMessage | null> {
    const m = this.inbound.get(messageId.trim().replace(/^<|>$/g, ""));
    return m && accounts.includes(m.account) ? { ...m, accountAddresses: m.accountAddresses ?? this.addresses.get(m.account) ?? [m.account] } : null;
  }
  /** Texts of the fake Mail's messages, by Mail's id. */
  contents = new Map<number, string>();
  async readContent(m: InboundMessage): Promise<string> {
    const c = this.contents.get(m.messageId);
    if (c === undefined) throw new DraftWriteError("no_message", `No message ${m.messageId}.`);
    return c;
  }
  async readHeaders(m: InboundMessage): Promise<string> {
    const h = this.headers.get(m.messageId);
    if (h === undefined) throw new DraftWriteError("no_message", `No message ${m.messageId}.`);
    return h;
  }
  async messageIdOf(m: InboundMessage): Promise<string> {
    return this.threadOf(m.messageId);
  }
  /** Each account's own addresses (P58: what it can send as); absent: the account name alone, as Mail lists a one-address account. */
  addresses = new Map<string, string[]>();
  async addressesOf(account: string): Promise<string[]> {
    return this.addresses.get(account) ?? [account];
  }
  async threadDrafts(accounts: readonly string[], thread: string): Promise<ThreadMailDraft[]> {
    const t = thread.trim().replace(/^<|>$/g, "").toLowerCase();
    return this.drafts.filter((d) => accounts.includes(d.account) && d.thread.toLowerCase() === t).map((d) => ({ ref: String(d.id), messageId: d.messageId, account: d.account, body: d.text }));
  }
  async writeReply(i: ReplyDraftInput): Promise<ReplyDraftResult> {
    const body = i.body.trimEnd();
    if (!body.trim()) throw new DraftWriteError("empty", "The reply has no text.");
    const thread = this.threadOf(i.messageId);
    const subject = `Re: message ${i.messageId}`;
    const id = this.next++;
    const messageId = `draft-${id}@hub.test`;
    if (this.slowNext) {
      this.slowNext = false;
      this.drafts.push({ id, messageId, account: i.account, thread, subject, text: body, quote: i.quote ?? "add", from: i.sender ?? i.account });
      throw new DraftWriteError("mail_slow", MAIL_SLOW_TEXT, "");
    }
    const wanted = new Set((i.replace ?? []).map((x) => `${x.account}\u0000${x.messageId.toLowerCase()}`));
    const older = this.drafts.filter((d) => wanted.has(`${d.account}\u0000${d.messageId.toLowerCase()}`));
    this.drafts.push({ id, messageId, account: i.account, thread, subject, text: body, quote: i.quote ?? "add", from: i.sender ?? i.account });
    this.drafts = this.drafts.filter((d) => !older.includes(d));
    return { draftId: id, messageId, text: body, subject, thread, from: i.sender ?? i.account, replaced: older.map((d) => d.messageId), left: [], savedIn: i.account, shell: "" };
  }
}

export interface ReviseInput {
  /** The project's Mail accounts (`mail.accounts`): the message answered is looked up only there. */
  accounts: readonly string[];
  /** `mail.sender`: the From only when the receiving account is not on `accounts` (P58 `replyFrom`). */
  sender: string | null;
  /** The address the client wrote to when no `sign` resolves it from the headers (a person's Save: the draft row's `wrote_to`). */
  clientWroteTo?: string | null;
  /** The hub draft's `mailRef`: the Message-ID of the message it answers. */
  mailRef: string;
  body: string;
  quote: "add" | "keep";
  /** The Hub's recorded versions of this draft still in Drafts (`mail_versions`, not trashed): each is replaced in its own account. */
  versions: readonly VersionRef[];
  /** P60: turns the body into the signed body once the answered message is known (the agent's revision); absent: written as given (a person's Save). */
  sign?: (inbound: InboundMessage, body: string) => Promise<Signed>;
  /** P65 S5: the write is recorded before Mail is asked, so a late save is adopted. Absent: not recorded. */
  log?: WriteLog;
}

/**
 * The Hub's record of one write (P65 S5, `mail_writes`, decision 0031 addendum point 1): started before Mail is asked to
 * save, settled when the saved draft is found, and given Mail's reply shell when the writer saw it. Best effort: a failed
 * record never stops or fails the write.
 */
export interface WriteLog {
  start(text: string): Promise<number>;
  settle(id: number, saved: { mailId: number; messageId: string }): Promise<void>;
  shell(id: number, text: string): Promise<void>;
}

const quietly = async <T>(p: () => Promise<T>): Promise<T | null> => {
  try {
    return await p();
  } catch {
    return null;
  }
};

/** One write through the writer, recorded in `log` first (P65 S5): a `mail_slow` write keeps its open row, with the shell's hash. */
export async function writeRecorded(writer: DraftWriter, input: ReplyDraftInput, log?: WriteLog): Promise<ReplyDraftResult> {
  const id = log ? await quietly(() => log.start(input.body.trimEnd())) : null;
  try {
    const r = await writer.writeReply(input);
    if (log && id !== null) {
      await quietly(() => log.settle(id, { mailId: r.draftId, messageId: r.messageId }));
      if (r.shell) await quietly(() => log.shell(id, r.shell));
    }
    return r;
  } catch (e) {
    if (log && id !== null && e instanceof DraftWriteError && e.shell) await quietly(() => log.shell(id, e.shell ?? ""));
    throw e;
  }
}

/**
 * The thread's drafts that are the Hub's own late saves, not yet recorded (decision 0031 addendum point 2): read from
 * Mail (the project's accounts, In-Reply-To = `mailRef`), matched to the recorded versions and the open writes by the
 * hash of their text. Read-only; the caller records them (`adopted`).
 */
export async function lateSaves(writer: DraftWriter, q: { accounts: readonly string[]; mailRef: string; subject: string | null; versions: readonly Pick<MailVersionRow, "account" | "messageId" | "hash">[]; writes: readonly MailWriteRow[] }): Promise<Adoption<ThreadMailDraft>[]> {
  if (q.writes.length === 0 && q.versions.length === 0) return [];
  const drafts = await writer.threadDrafts(q.accounts, q.mailRef, q.subject);
  const found = adoptable(drafts, q.versions, q.writes);
  // Left unmatched: one more read, of the answered message, so Mail's empty reply in the thread is recognised (P65 S5).
  const left = drafts.filter((d) => !found.some((a) => a.draft === d) && !q.versions.some((v) => v.account.trim().toLowerCase() === (d.account ?? "").trim().toLowerCase() && v.messageId.trim().replace(/^<|>$/g, "").toLowerCase() === (d.messageId ?? "").toLowerCase()));
  if (left.length === 0) return found;
  const m = await writer.findInbound(q.accounts, q.mailRef).catch(() => null);
  const original = m ? await writer.readContent(m).catch(() => null) : null;
  return original ? adoptable(drafts, q.versions, q.writes, original) : found;
}

/** What the writer adds when it signs (P60): the signed body and how the brand was found. */
export interface Signed {
  body: string;
  wroteTo: string | null;
  brand: string | null;
  brandReason: string;
  /** `signed`: sign-off and the brand's lines; `placeholder`: `[Owner: signature for ...]`; `none`: the project signs with nothing. */
  signature: "signed" | "placeholder" | "none";
  /** P65 S2: the reply's language had no sign-off or signature line, so it was signed in English. */
  signatureFallback?: string;
}

/** A revision as the writer saved it, with the account it sits in (the version row's account) and why its From is what it is (P58). */
export type Revision = ReplyDraftResult & { replyTo: number; account: string; fromReason: string | null; clientWroteTo: string | null } & Partial<Omit<Signed, "body">>;

/**
 * The From of a reply to `inbound` (P58 `replyFrom`): the address the client wrote to when the receiving account can send
 * as it, else the receiving account, else `mail.sender`. The receiving account's addresses come from the lookup that found
 * the message, else one read of the account (`addressesOf`); a failed read leaves the account name alone.
 */
export async function fromFor(writer: DraftWriter, inbound: InboundMessage, clientWroteTo: string | null, mail: { accounts: readonly string[]; sender: string | null }): Promise<ReplyFrom> {
  const addresses = inbound.accountAddresses ?? (await writer.addressesOf(inbound.account).catch(() => []));
  return replyFrom({ account: inbound.account, accountAddresses: addresses, clientWroteTo }, { mail: { accounts: [...mail.accounts], sender: mail.sender } });
}

/**
 * The one revision of a hub draft (P56): find the message it answers by its Message-ID in the project's accounts, then
 * write the reply through the writer, which moves the older recorded versions to Trash, each in its own account. Shared
 * by `hub mcp`'s `draft_write {draft}` (the agent, `quote: "add"`), the server (a person's Save or Restore, `quote:
 * "keep"`), so there is one path. The caller records the new version (`mail_versions`) in the
 * account Mail saved it in (`savedIn`: the From's account, P65 S5).
 */
export async function reviseDraft(writer: DraftWriter, i: ReviseInput): Promise<Revision> {
  const found = await writer.findInbound(i.accounts, i.mailRef);
  if (!found) throw new DraftWriteError("no_message", `The message this draft answers (Message-ID ${i.mailRef}) is not in ${i.accounts.join(", ") || "this project's accounts"}: it may have been deleted. Nothing was written.`);
  const signed = i.sign ? await i.sign(found, i.body) : null;
  const rf = await fromFor(writer, found, signed ? signed.wroteTo : (i.clientWroteTo ?? null), i);
  const { accountAddresses: _addresses, ...where } = found;
  const r = await writeRecorded(writer, { ...where, body: signed?.body ?? i.body, sender: rf.from, quote: i.quote, replace: i.versions, landIn: i.accounts }, i.log);
  const account = r.savedIn || found.account;
  const why = { fromReason: rf.fromReason, clientWroteTo: rf.clientWroteTo };
  if (!signed) return { ...r, replyTo: found.messageId, account, ...why };
  const { body: _body, ...how } = signed;
  return { ...r, replyTo: found.messageId, account, ...how, ...why };
}

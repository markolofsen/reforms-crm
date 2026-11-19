import { execFile } from "node:child_process";

// The hub's draft writer (P52, decision 0030): an unsent reply saved in Mail's Drafts, written by the `hub` MCP server
// (outside the agent's sandbox) through Mail's own scripting, with no window, no focus and no clipboard. mail-mcp's
// `create_reply` opens a compose window, activates Mail and pastes with a global Cmd+V: with the owner's browser in
// front Mail is not activated, the paste never lands and an empty reply is left behind (P51 live check). This writer
// never sends: the script has no `send`. Its one removal is the replace step of a revision: after the new draft is
// saved and found, it deletes the OLDER drafts of the same account whose text carries the same
// `[hub-draft thread=<id>]` marker and the same subject (moved to the account's Trash by Mail). Nothing else is ever
// deleted, and nothing is deleted when the new draft cannot be found.

/** Runs osascript with the script and its arguments (`on run argv`). Injected so tests never reach Mail. */
export type OsaRun = (script: string, args: string[]) => Promise<string>;

export const defaultOsa: OsaRun = (script, args) =>
  new Promise((resolve, reject) =>
    execFile("osascript", ["-e", script, ...args], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(String(stderr || err.message).slice(0, 300))) : resolve(stdout),
    ),
  );

export interface ReplyDraftInput {
  /** Mail account name of the message answered (as mail-mcp names it). */
  account: string;
  /** Mailbox path of that message, e.g. ["INBOX"]. */
  mailboxPath: string[];
  /** Mail's integer id of the message answered (mail-mcp `message_id`). */
  messageId: number;
  /** Plain text of the reply, without the marker line (the writer adds it). */
  body: string;
  /** The From to use when Mail would pick an address outside this account; null: the account's first address. */
  sender: string | null;
}

export interface ReplyDraftResult {
  /** Mail's id of the new draft in the Drafts mailbox. */
  draftId: number;
  subject: string;
  /** The answered message's Message-ID, bare: the marker's thread and the `mailRef` for `hub record-draft`. */
  thread: string;
  from: string;
  /** Ids of the older drafts of this thread that were replaced (deleted; Mail may list them as deleted until it expunges). */
  replaced: number[];
  /** Older hub drafts of this thread still there after the replace: the owner deletes them (none expected). */
  left: number[];
}

export class DraftWriteError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** Where the message a draft answers sits in Mail: what `writeReply` needs, found from its Message-ID (P53). */
export interface InboundMessage {
  account: string;
  mailboxPath: string[];
  messageId: number;
}

export interface DraftWriter {
  writeReply(input: ReplyDraftInput): Promise<ReplyDraftResult>;
  /** The message with this Message-ID in one of these accounts (INBOX first, then the other mailboxes but Drafts, Sent, Trash and Spam), or null. */
  findInbound(accounts: readonly string[], messageId: string): Promise<InboundMessage | null>;
}

const FS = "\x1f";
const LS = "\x1d";

/** The marker line an agent may have put first itself: dropped, the writer adds the one true line. */
export const stripMarker = (body: string): string => body.replace(/^\s*\[hub-draft\b[^\]\n]*\]\s*\n?/i, "").replace(/\s+$/, "");

// argv: 1 account, 2 mailbox path (LS-joined), 3 message id, 4 body, 5 sender or "". Output: ok FS draftId FS subject FS
// thread FS from FS replaced (LS-joined) FS left (LS-joined), or error FS code FS message. A message Mail flags as deleted
// (pending expunge) is not a draft.
export const WRITE_REPLY_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set LS to (ASCII character 29)
  if application "Mail" is not running then return "error" & FS & "mail_not_running" & FS & "Mail is not running: open Mail (it may stay in the background), then write the draft again."
  set accName to item 1 of argv
  set boxPath to my parts(item 2 of argv, LS)
  set srcId to (item 3 of argv) as integer
  set theBody to item 4 of argv
  set wantSender to item 5 of argv
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
    set marker to "[hub-draft thread=" & thread & "]"
    set quoteHead to "On " & ((date sent of src) as string) & ", " & (sender of src) & " wrote:"
    set quoted to my quoteOf((content of src) as text)
    set r to reply src opening window false
    set subj to subject of r
    set fromNow to sender of r
    set inAccount to false
    repeat with a in accAddrs
      if fromNow contains (contents of a) then set inAccount to true
    end repeat
    if wantSender is not "" then
      set sender of r to wantSender
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
    set olderIds to my hubDrafts(subj, marker, accName, {})
    set wanted to marker & linefeed & theBody & linefeed & linefeed & quoteHead & linefeed & quoted
    set content of r to wanted
    delay 0.3
    if ((content of r) as text) does not contain marker then
      delete r
      return "error" & FS & "content_refused" & FS & "Mail did not take the text of the reply; nothing was saved or replaced."
    end if
    save r
    delay 0.5
    set fromNow to sender of r
    delete r
    set newId to 0
    repeat 40 times
      set found to my hubDrafts(subj, marker, accName, olderIds)
      if (count of found) > 0 then
        set newId to item 1 of found
        exit repeat
      end if
      delay 0.25
    end repeat
    if newId is 0 then return "error" & FS & "not_saved" & FS & "Mail did not show the new draft in Drafts within 10 s; nothing was replaced. Look in Drafts before writing again."
    set replaced to ""
    repeat with oid in olderIds
      try
        delete (first message of drafts mailbox whose id is (contents of oid))
        set replaced to replaced & (contents of oid) & LS
      end try
    end repeat
    delay 0.5
    set leftIds to ""
    repeat with lid in my hubDrafts(subj, marker, accName, {newId})
      set leftIds to leftIds & (contents of lid) & LS
    end repeat
  end tell
  return "ok" & FS & newId & FS & subj & FS & thread & FS & fromNow & FS & replaced & FS & leftIds
end run

on hubDrafts(subj, marker, accName, skipIds)
  set out to {}
  tell application "Mail"
    repeat with m in (messages of drafts mailbox whose subject is subj)
      set mid to id of m
      if skipIds does not contain mid and out does not contain mid and (deleted status of m) is false then
        set acc to ""
        try
          set acc to name of account of mailbox of m
        end try
        if acc is accName and ((content of m) as text) contains marker then set end of out to mid
      end if
    end repeat
  end tell
  return out
end hubDrafts

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

on parts(s, d)
  if s is "" then return {}
  set AppleScript's text item delimiters to d
  set r to text items of s
  set AppleScript's text item delimiters to ""
  return r
end parts`;

// argv: 1 Message-ID (bare), 2.. account names. Output: ok FS account FS mailbox name FS id, or none. Read-only. INBOX
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
          return "ok" & FS & accName & FS & "INBOX" & FS & (id of m)
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
              return "ok" & FS & accName & FS & bn & FS & (id of m)
            end try
          end if
        end repeat
      end try
    end repeat
  end tell
  return "none"
end run`;

export function parseInboundOutput(out: string): InboundMessage | null {
  const p = out.replace(/[\r\n]+$/, "").split(FS);
  if (p[0] === "error") throw new DraftWriteError(p[1] || "mail_error", p[2] || "Mail refused the lookup.");
  if (p[0] !== "ok" || p.length < 4) return null;
  const id = Number(p[3]);
  return Number.isInteger(id) && id > 0 ? { account: p[1] as string, mailboxPath: [p[2] as string], messageId: id } : null;
}

export function parseWriteOutput(out: string): ReplyDraftResult {
  const p = out.replace(/[\r\n]+$/, "").split(FS);
  if (p[0] === "error") throw new DraftWriteError(p[1] || "mail_error", p[2] || "Mail refused the draft.");
  if (p[0] !== "ok" || p.length < 6) throw new DraftWriteError("mail_error", `Mail answered "${out.trim().slice(0, 100)}"`);
  const [, id, subject, thread, from, replaced, left = ""] = p as [string, string, string, string, string, string, string?];
  const ids = (v: string) => [...new Set(v.split(LS).map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0))];
  return { draftId: Number(id), subject, thread: thread.trim().replace(/^<|>$/g, ""), from, replaced: ids(replaced), left: ids(left) };
}

/** Mail.app through osascript, run by the hub MCP server. Plain text. */
export function mailAppDraftWriter(osa: OsaRun = defaultOsa): DraftWriter {
  return {
    async writeReply(i) {
      const body = stripMarker(i.body);
      if (!body.trim()) throw new DraftWriteError("empty", "The reply has no text.");
      const out = await osa(WRITE_REPLY_SCRIPT, [i.account, i.mailboxPath.join(LS), String(i.messageId), body, i.sender ?? ""]).catch((e: Error) => {
        throw new DraftWriteError("mail_error", e.message);
      });
      return parseWriteOutput(out);
    },
    async findInbound(accounts, messageId) {
      const id = messageId.trim().replace(/^<|>$/g, "");
      if (!id || accounts.length === 0) return null;
      const out = await osa(FIND_INBOUND_SCRIPT, [id, ...accounts]).catch((e: Error) => {
        throw new DraftWriteError("mail_error", e.message);
      });
      return parseInboundOutput(out);
    },
  };
}

/** In memory: what tests use. A second write on the same thread replaces the first, as Mail does. */
export class FakeDraftWriter implements DraftWriter {
  drafts: Array<{ id: number; account: string; thread: string; subject: string; text: string }> = [];
  private next = 1000;
  /** Inbound messages the fake Mail holds, by Message-ID. */
  inbound = new Map<string, InboundMessage>();
  constructor(private readonly threadOf: (messageId: number) => string = (id) => `m${id}@example.com`) {}
  async findInbound(accounts: readonly string[], messageId: string): Promise<InboundMessage | null> {
    const m = this.inbound.get(messageId.trim().replace(/^<|>$/g, ""));
    return m && accounts.includes(m.account) ? m : null;
  }
  async writeReply(i: ReplyDraftInput): Promise<ReplyDraftResult> {
    const body = stripMarker(i.body);
    if (!body.trim()) throw new DraftWriteError("empty", "The reply has no text.");
    const thread = this.threadOf(i.messageId);
    const subject = `Re: message ${i.messageId}`;
    const older = this.drafts.filter((d) => d.account === i.account && d.thread === thread && d.subject === subject);
    const id = this.next++;
    this.drafts.push({ id, account: i.account, thread, subject, text: `[hub-draft thread=${thread}]\n${body}` });
    this.drafts = this.drafts.filter((d) => !older.includes(d));
    return { draftId: id, subject, thread, from: i.sender ?? i.account, replaced: older.map((d) => d.id), left: [] };
  }
}

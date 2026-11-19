import { createHash } from "node:crypto";
import { execFile } from "node:child_process";

// The hub's draft writer (P52, decision 0030; decision 0031 for what it no longer writes): an unsent reply saved in
// Mail's Drafts, written by the `hub` MCP server (outside the agent's sandbox) through Mail's own scripting, with no
// window, no focus and no clipboard. It writes the reply text and nothing else: no marker line, no hidden text (0031).
// It never sends: the script has no `send`. It finds the draft it saved as the one NEW draft of the account with this
// subject whose In-Reply-To is the answered message. Its one removal is the replace step of a revision: the older
// versions the caller names by their `message id` (the Hub's `mail_versions` record), each re-checked in the script by
// account and `message id` just before Mail's delete (moved to the account's Trash by Mail). Nothing else is ever
// deleted, and nothing is deleted when the new draft cannot be told apart.

/** Runs osascript with the script and its arguments (`on run argv`). Injected so tests never reach Mail. */
export type OsaRun = (script: string, args: string[]) => Promise<string>;

export const defaultOsa: OsaRun = (script, args) =>
  new Promise((resolve, reject) =>
    execFile("osascript", ["-e", script, ...args], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(String(stderr || err.message).slice(0, 300))) : resolve(stdout),
    ),
  );

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
  /** The Message-IDs of this account's older Hub versions of the thread (from `mail_versions`): moved to Trash after the save. */
  replace?: readonly string[];
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
  /**
   * The raw header block of one known message (P60): what `resolveBrand` reads to learn the address the client wrote to.
   * A direct lookup by Mail's id in a known mailbox, not a search. Read-only.
   */
  readHeaders(m: InboundMessage): Promise<string>;
  /** The Message-ID of one known message, bare (P65: a new reply is refused before it is written when the project already answers it). Read-only. */
  messageIdOf(m: InboundMessage): Promise<string>;
}

const FS = "\x1f";
const LS = "\x1d";

/** A marker line an agent (or an old copy) put first: dropped, nothing of the Hub's goes in the body (decision 0031). */
export const stripMarker = (body: string): string => body.replace(/^\s*\[hub-draft\b[^\]\n]*\]\s*\n?/i, "").replace(/\s+$/, "");

/** The fingerprint of a version's text as Mail returned it (decision 0013: the hash, never the text). */
export const versionHash = (text: string): string => createHash("sha256").update(text.replace(/\s+$/, "")).digest("hex");

/** What the script checks Mail took: the body's first 40 characters (Mail may rewrap or add an HTML part, never drop the start). */
export const probeOf = (body: string): string => body.replace(/^\s+/, "").slice(0, 40);

// argv: 1 account, 2 mailbox path (LS-joined), 3 message id, 4 body, 5 sender or "", 6 "keep" to write the body verbatim
// (no quote added; P56), 7 the probe (the body's first 40 characters), 8 the Message-IDs to replace (LS-joined). Output:
// ok FS draftId FS subject FS thread FS from FS replaced (LS) FS left (LS) FS new message id FS the text read back, or
// error FS code FS message. A message Mail flags as deleted (pending expunge) is not a draft.
export const WRITE_REPLY_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set LS to (ASCII character 29)
  if application "Mail" is not running then return "error" & FS & "mail_not_running" & FS & "Mail is not running: open Mail (it may stay in the background), then write the draft again."
  set accName to item 1 of argv
  set boxPath to my parts(item 2 of argv, LS)
  set srcId to (item 3 of argv) as integer
  set theBody to item 4 of argv
  set wantSender to item 5 of argv
  set addQuote to (item 6 of argv) is not "keep"
  set probe to item 7 of argv
  set targets to my parts(item 8 of argv, LS)
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
    set tail to ""
    if addQuote then set tail to linefeed & linefeed & "On " & ((date sent of src) as string) & ", " & (sender of src) & " wrote:" & linefeed & my quoteOf((content of src) as text)
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
    set priorIds to my threadDrafts(subj, accName, thread, {})
    set content of r to (theBody & tail)
    delay 0.3
    if ((content of r) as text) does not contain probe then
      delete r
      return "error" & FS & "content_refused" & FS & "Mail did not take the text of the reply; nothing was saved or replaced."
    end if
    save r
    delay 0.5
    set fromNow to sender of r
    delete r
    set fresh to {}
    repeat 40 times
      set fresh to my threadDrafts(subj, accName, thread, priorIds)
      if (count of fresh) > 0 then exit repeat
      delay 0.25
    end repeat
    if (count of fresh) is 0 then return "error" & FS & "not_saved" & FS & "Mail did not show the new draft in Drafts within 10 s; nothing was replaced. Look in Drafts before writing again."
    if (count of fresh) > 1 then return "error" & FS & "ambiguous" & FS & "Mail shows " & (count of fresh) & " new drafts of this thread and the Hub cannot tell which one it wrote; nothing was replaced. Keep one in Drafts, then write again."
    set newId to item 1 of fresh
    set nm to (first message of drafts mailbox whose id is newId)
    set newMid to message id of nm
    set readBack to (content of nm) as text
    set replaced to ""
    set leftIds to ""
    repeat with t in targets
      set tid to contents of t
      try
        repeat with m in (messages of drafts mailbox whose message id is tid)
          if (id of m) is not newId and (deleted status of m) is false and (name of account of mailbox of m) is accName and (message id of m) is tid then
            delete m
            set replaced to replaced & tid & LS
          end if
        end repeat
      on error
        set leftIds to leftIds & tid & LS
      end try
    end repeat
  end tell
  return "ok" & FS & newId & FS & subj & FS & thread & FS & fromNow & FS & replaced & FS & leftIds & FS & newMid & FS & readBack
end run

on threadDrafts(subj, accName, thread, skipIds)
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
        if acc is accName and irt contains thread then set end of out to mid
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

on parts(s, d)
  if s is "" then return {}
  set AppleScript's text item delimiters to d
  set r to text items of s
  set AppleScript's text item delimiters to ""
  return r
end parts`;

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

export function parseInboundOutput(out: string): InboundMessage | null {
  const p = out.replace(/[\r\n]+$/, "").split(FS);
  if (p[0] === "error") throw new DraftWriteError(p[1] || "mail_error", p[2] || "Mail refused the lookup.");
  if (p[0] !== "ok" || p.length < 4) return null;
  const id = Number(p[3]);
  return Number.isInteger(id) && id > 0 ? { account: p[1] as string, mailboxPath: [p[2] as string], messageId: id } : null;
}

export function parseWriteOutput(out: string): ReplyDraftResult {
  const t = out.replace(/[\r\n]+$/, "");
  const p = t.split(FS);
  if (p[0] === "error") throw new DraftWriteError(p[1] || "mail_error", p[2] || "Mail refused the draft.");
  if (p[0] !== "ok" || p.length < 9) throw new DraftWriteError("mail_error", `Mail answered "${out.trim().slice(0, 100)}"`);
  const [, id, subject, thread, from, replaced, left, mid] = p as [string, string, string, string, string, string, string, string];
  const text = p.slice(8).join(FS);
  const ids = (v: string) => [...new Set(v.split(LS).map((x) => x.trim().replace(/^<|>$/g, "")).filter(Boolean))];
  const messageId = mid.trim().replace(/^<|>$/g, "");
  if (!messageId) throw new DraftWriteError("mail_error", "Mail saved the draft but gave it no Message-ID; nothing was replaced.");
  return { draftId: Number(id), messageId, text, subject, thread: thread.trim().replace(/^<|>$/g, ""), from, replaced: ids(replaced), left: ids(left) };
}

/** Mail.app through osascript, run by the hub MCP server. Plain text. */
export function mailAppDraftWriter(osa: OsaRun = defaultOsa): DraftWriter {
  const fail = (e: Error) => {
    throw new DraftWriteError("mail_error", e.message);
  };
  return {
    async writeReply(i) {
      const body = stripMarker(i.body);
      if (!body.trim()) throw new DraftWriteError("empty", "The reply has no text.");
      const out = await osa(WRITE_REPLY_SCRIPT, [i.account, i.mailboxPath.join(LS), String(i.messageId), body, i.sender ?? "", i.quote ?? "add", probeOf(body), (i.replace ?? []).join(LS)]).catch(fail);
      return parseWriteOutput(out);
    },
    async findInbound(accounts, messageId) {
      const id = messageId.trim().replace(/^<|>$/g, "");
      if (!id || accounts.length === 0) return null;
      return parseInboundOutput(await osa(FIND_INBOUND_SCRIPT, [id, ...accounts]).catch(fail));
    },
    async readHeaders(m) {
      const out = await osa(READ_HEADERS_SCRIPT, [m.account, m.mailboxPath.join(LS), String(m.messageId)]).catch(fail);
      const i = out.indexOf(FS);
      const head = i < 0 ? out.trim() : out.slice(0, i);
      if (head === "error") {
        const [, code = "mail_error", message = "Mail refused the header read."] = out.replace(/[\r\n]+$/, "").split(FS);
        throw new DraftWriteError(code, message);
      }
      if (head !== "ok") throw new DraftWriteError("mail_error", `Mail answered "${out.trim().slice(0, 100)}"`);
      return out.slice(i + 1);
    },
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
  drafts: Array<{ id: number; messageId: string; account: string; thread: string; subject: string; text: string; quote: "add" | "keep" }> = [];
  private next = 1000;
  /** Inbound messages the fake Mail holds, by Message-ID. */
  inbound = new Map<string, InboundMessage>();
  /** Raw header blocks of the fake Mail's messages, by Mail's id. */
  headers = new Map<number, string>();
  constructor(private readonly threadOf: (messageId: number) => string = (id) => `m${id}@example.com`) {}
  async findInbound(accounts: readonly string[], messageId: string): Promise<InboundMessage | null> {
    const m = this.inbound.get(messageId.trim().replace(/^<|>$/g, ""));
    return m && accounts.includes(m.account) ? m : null;
  }
  async readHeaders(m: InboundMessage): Promise<string> {
    const h = this.headers.get(m.messageId);
    if (h === undefined) throw new DraftWriteError("no_message", `No message ${m.messageId}.`);
    return h;
  }
  async messageIdOf(m: InboundMessage): Promise<string> {
    return this.threadOf(m.messageId);
  }
  async writeReply(i: ReplyDraftInput): Promise<ReplyDraftResult> {
    const body = stripMarker(i.body);
    if (!body.trim()) throw new DraftWriteError("empty", "The reply has no text.");
    const thread = this.threadOf(i.messageId);
    const subject = `Re: message ${i.messageId}`;
    const id = this.next++;
    const messageId = `draft-${id}@hub.test`;
    const wanted = new Set((i.replace ?? []).map((x) => x.toLowerCase()));
    const older = this.drafts.filter((d) => d.account === i.account && wanted.has(d.messageId.toLowerCase()));
    this.drafts.push({ id, messageId, account: i.account, thread, subject, text: body, quote: i.quote ?? "add" });
    this.drafts = this.drafts.filter((d) => !older.includes(d));
    return { draftId: id, messageId, text: body, subject, thread, from: i.sender ?? i.account, replaced: older.map((d) => d.messageId), left: [] };
  }
}

export interface ReviseInput {
  /** The project's Mail accounts (`mail.accounts`): the message answered is looked up only there. */
  accounts: readonly string[];
  sender: string | null;
  /** The hub draft's `mailRef`: the Message-ID of the message it answers. */
  mailRef: string;
  body: string;
  quote: "add" | "keep";
  /** The Hub's recorded versions of this draft still in Drafts (`mail_versions`, not trashed): those of the answered message's account are replaced. */
  versions: readonly VersionRef[];
  /** P60: turns the body into the signed body once the answered message is known (the agent's revision); absent: written as given (a person's Save). */
  sign?: (inbound: InboundMessage, body: string) => Promise<Signed>;
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

/** A revision as the writer saved it, with the account it sits in (the version row's account). */
export type Revision = ReplyDraftResult & { replyTo: number; account: string } & Partial<Omit<Signed, "body">>;

/**
 * The one revision of a hub draft (P56): find the message it answers by its Message-ID in the project's accounts, then
 * write the reply through the writer, which moves the older recorded versions of that account to Trash. Shared by `hub
 * mcp`'s `draft_write {draft}` (the agent, `quote: "add"`), the server (a person's Save or Restore, `quote: "keep"`) and
 * `hub drafts unmark`, so there is one path. The caller records the new version (`mail_versions`).
 */
export async function reviseDraft(writer: DraftWriter, i: ReviseInput): Promise<Revision> {
  const found = await writer.findInbound(i.accounts, i.mailRef);
  if (!found) throw new DraftWriteError("no_message", `The message this draft answers (Message-ID ${i.mailRef}) is not in ${i.accounts.join(", ") || "this project's accounts"}: it may have been deleted. Nothing was written.`);
  const signed = i.sign ? await i.sign(found, i.body) : null;
  const same = (a: string) => a.trim().toLowerCase() === found.account.trim().toLowerCase();
  const replace = i.versions.filter((v) => same(v.account)).map((v) => v.messageId);
  const r = await writer.writeReply({ ...found, body: signed?.body ?? i.body, sender: i.sender, quote: i.quote, replace });
  if (!signed) return { ...r, replyTo: found.messageId, account: found.account };
  const { body: _body, ...how } = signed;
  return { ...r, replyTo: found.messageId, account: found.account, ...how };
}

import { execFile } from "node:child_process";
import { withoutLeadingBlankLines } from "@hub/db";

// The one door out of the hub (decision 0011). `Mailer` is the whole surface `hub send` needs from Mail: read the
// drafts that match a recorded draft, and send one of them. `MailAppMailer` does it through Mail.app's scripting
// with `osascript` run by the hub process; the agent's shell has `Bash(osascript *)` denied (P17), so it cannot reach
// this path. `FakeMailer` is what every test uses: no test touches Mail or sends anything.

/** A draft as Mail holds it. */
export interface MailDraft {
  /** Mail's own id of the draft message; the key `send` and the trash step use. */
  ref: string;
  /** The draft's Message-ID header (without angle brackets), when Mail has one. */
  messageId: string | null;
  /** Mail account name the draft sits in. */
  account: string | null;
  /** The bare Message-ID its In-Reply-To names (P65: how the Hub finds a thread's draft), or null. */
  inReplyTo: string | null;
  /** From, as Mail shows it (`Name <addr>` or `addr`). */
  sender: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  /** Plain text. */
  body: string;
  attachments: number;
}

export interface DraftQuery {
  mailRef: string | null;
  subject: string;
}

/**
 * One Mail draft the hub may move to Trash (P65, decision 0031): a version the Hub recorded, named by its account and
 * its own Message-ID as Mail returned it. The script moves a draft only when both still match, read just before the delete.
 */
export interface TrashItem {
  account: string;
  messageId: string;
}

/** A draft's headers without its text: what the sweep and the migration list (P65; the text is never read for this). */
export interface DraftHead {
  ref: string;
  messageId: string | null;
  account: string | null;
  subject: string;
  inReplyTo: string | null;
}

export interface Mailer {
  /** Drafts whose subject equals `subject` (candidates; the caller picks by `mailRef` and recipient). Read only. */
  findDrafts(q: DraftQuery): Promise<MailDraft[]>;
  /** Messages in Mail's Trash with this subject: where a deleted draft is found again (P56, `mail_gone`). Read only. */
  findInTrash(q: DraftQuery): Promise<MailDraft[]>;
  /** The headers of every draft in every account (id, Message-ID, account, subject, In-Reply-To): what `hub drafts sweep` joins to the Hub's record. Read only. */
  listDrafts(): Promise<DraftHead[]>;
  /** Moves these drafts to Trash (recoverable), each only if its account and Message-ID still match. Never anything else. Returns the Message-IDs. */
  trashDrafts(items: TrashItem[]): Promise<{ moved: string[]; refused: string[]; why?: string[] }>;
  /**
   * Sends exactly this draft's text to exactly its recipients. `replyTo` (the bare Message-ID of the message answered,
   * P56) makes the outgoing mail a reply to it, so it keeps `In-Reply-To` and `References`. Throws when Mail refuses.
   */
  send(d: MailDraft, replyTo?: string | null): Promise<{ messageId: string | null }>;
}

/** Runs osascript with the script and its arguments (`on run argv`). Injected so tests never reach Mail. */
export type OsaRun = (script: string, args: string[]) => Promise<string>;

/** The one line a page shows when Mail holds an AppleEvent past its budget (measured 2026-11-19: error -1712 after 2 min). */
export const MAIL_NOT_ANSWERING_FIX = "Quit Mail (Force Quit if it does not close), open it again, then reload this page.";

/** osascript was cut at its budget: Mail is running but did not answer. The message names no account or text. */
export class MailNotAnswering extends Error {
  readonly seconds: number;
  constructor(ms: number) {
    super(`Mail is not answering (no reply in ${Math.round(ms / 1000)} s)`);
    this.name = "MailNotAnswering";
    this.seconds = Math.round(ms / 1000);
  }
}

/**
 * osascript with its own budget: at `timeoutMs` the child is killed and the call rejects with `MailNotAnswering`. Node also
 * sets `killed` when output passes `maxBuffer`; at 32 MB that does not happen for anything the hub reads.
 */
export const osaWithin = (timeoutMs: number): OsaRun => (script, args) =>
  new Promise((resolve, reject) =>
    execFile("osascript", ["-e", script, ...args], { timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      if ((err as { killed?: boolean }).killed) return reject(new MailNotAnswering(timeoutMs));
      reject(new Error(String(stderr || err.message).slice(0, 300)));
    }),
  );

/** A send, a trash or a long read: two minutes. */
export const defaultOsa: OsaRun = osaWithin(120_000);
/** A read a page waits on (the Drafts card, Connections' accounts): a healthy Mail answers in seconds. */
export const MAIL_READ_TIMEOUT_MS = 20_000;

const FS = "\x1f";
const RS = "\x1e";
const LS = "\x1d";

/** Message-ID with the angle brackets and spaces removed: how mailRef and Mail's `message id` are compared. */
export const bareId = (id: string | null | undefined): string => (id ?? "").trim().replace(/^<|>$/g, "").toLowerCase();

// The record of one message, fields separated by FS, lists by LS; a message Mail flags as deleted is skipped (a
// revision's older version on its way out, P52). Used inside a `repeat with m in ms` of each read script.
const RECORDS = `
  set out to ""
  repeat with m in ms
    if (deleted status of m) is false then
      set acc to ""
      try
        set acc to name of account of mailbox of m
      end try
      set tos to ""
      set ccs to ""
      set bccs to ""
      try
        repeat with r in (to recipients of m)
          set tos to tos & (address of r) & LS
        end repeat
        repeat with r in (cc recipients of m)
          set ccs to ccs & (address of r) & LS
        end repeat
        repeat with r in (bcc recipients of m)
          set bccs to bccs & (address of r) & LS
        end repeat
      end try
      set n to 0
      try
        set n to count of mail attachments of m
      end try
      set irt to ""
      try
        set irt to content of (first header of m whose name is "In-Reply-To")
      end try
      set out to out & (id of m) & FS & (message id of m) & FS & acc & FS & (sender of m) & FS & tos & FS & ccs & FS & bccs & FS & (subject of m) & FS & (content of m) & FS & n & FS & irt & RS
    end if
  end repeat`;

const SEPARATORS = `
  set FS to (ASCII character 31)
  set RS to (ASCII character 30)
  set LS to (ASCII character 29)`;

// argv: 1 subject, 2 "trash" to read Mail's Trash instead of Drafts. Output: one record per message.
export const FIND_SCRIPT = `on run argv${SEPARATORS}
  set subj to item 1 of argv
  set box to "drafts"
  if (count of argv) > 1 then set box to item 2 of argv
  tell application "Mail"
    if box is "trash" then
      set ms to (messages of trash mailbox whose subject is subj)
    else
      set ms to (messages of drafts mailbox whose subject is subj)
    end if${RECORDS}
  end tell
  return out
end run`;

// No argv. The headers of every draft of every account, never its text (P65: 0.3 s to 1.5 s for 63 drafts, against
// 1 min 29 s for a `whose content contains` read). One record per draft: id FS message id FS account FS subject FS In-Reply-To.
export const LIST_DRAFTS_SCRIPT = `on run argv${SEPARATORS}
  set out to ""
  tell application "Mail"
    repeat with m in (messages of drafts mailbox)
      if (deleted status of m) is false then
        set acc to ""
        try
          set acc to name of account of mailbox of m
        end try
        set irt to ""
        try
          set irt to content of (first header of m whose name is "In-Reply-To")
        end try
        set out to out & (id of m) & FS & (message id of m) & FS & acc & FS & (subject of m) & FS & irt & RS
      end if
    end repeat
  end tell
  return out
end run`;

// argv: pairs of (account, Message-ID). A draft is moved to Trash (Mail's delete: recoverable) only when a draft of that
// account still has exactly that Message-ID, read again here, just before the delete (P65, decision 0031). Output:
// moved (LS-joined Message-IDs) FS refused FS why (LS-joined "Message-ID: Mail's error", for a refusal Mail explained).
// v0.12.15 (2026-11-19): `repeat with m in (messages … whose message id is mid)` found every draft but `delete m` failed
// on each (a loop item is a reference into the list, not Mail's message), and the `try` hid it: every move was "refused".
// The draft is now resolved to Mail's own reference by its id (the form P56's trash used), and Mail's error is returned.
export const TRASH_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set LS to (ASCII character 29)
  set moved to ""
  set refused to ""
  set why to ""
  tell application "Mail"
    repeat with i from 1 to (count of argv) by 2
      set accName to item i of argv
      set mid to item (i + 1) of argv
      set ok to false
      set err to ""
      try
        set found to id of (messages of drafts mailbox whose message id is mid)
      on error e
        set found to {}
        set err to e
      end try
      repeat with fid in found
        try
          set m to (first message of drafts mailbox whose id is (contents of fid))
          if (deleted status of m) is false and (name of account of mailbox of m) is accName and (message id of m) is mid then
            delete m
            set ok to true
          end if
        on error e
          set err to e
        end try
      end repeat
      if ok then
        set moved to moved & mid & LS
      else
        set refused to refused & mid & LS
        if err is not "" then set why to why & mid & ": " & err & LS
      end if
    end repeat
  end tell
  return moved & FS & refused & FS & why
end run`;

export function parseTrashOutput(out: string): { moved: string[]; refused: string[]; why: string[] } {
  const [moved = "", refused = "", why = ""] = out.replace(/[\r\n]+$/, "").split(FS);
  const ids = (v: string) => v.split(LS).map((x) => x.trim()).filter(Boolean);
  return { moved: ids(moved), refused: ids(refused), why: ids(why) };
}

export function parseFindOutput(out: string): MailDraft[] {
  const list = (v: string) => v.split(LS).map((x) => x.trim()).filter(Boolean);
  const drafts: MailDraft[] = [];
  for (const rec of out.split(RS)) {
    const p = rec.replace(/^[\r\n]+/, "").split(FS);
    if (p.length < 10) continue;
    const [ref, messageId, account, sender, to, cc, bcc, subject, body, n, irt = ""] = p as [string, string, string, string, string, string, string, string, string, string, string?];
    drafts.push({ ref, messageId: rawId(messageId) || null, account: account || null, inReplyTo: bareId(irt) || null, sender: sender || null, to: list(to), cc: list(cc), bcc: list(bcc), subject, body, attachments: Number(n) || 0 });
  }
  return drafts;
}

/** A Message-ID as Mail gives it back to a script: angle brackets and spaces removed, case kept (TS compares with `bareId`). */
export const rawId = (id: string | null | undefined): string => (id ?? "").trim().replace(/^<|>$/g, "");

export function parseDraftHeads(out: string): DraftHead[] {
  const heads: DraftHead[] = [];
  for (const rec of out.split(RS)) {
    const p = rec.replace(/^[\r\n]+/, "").split(FS);
    if (p.length < 5) continue;
    const [ref, messageId, account, subject, irt] = p as [string, string, string, string, string];
    heads.push({ ref: ref.trim(), messageId: rawId(messageId) || null, account: account || null, subject, inReplyTo: bareId(irt) || null });
  }
  return heads;
}

// argv: 1 sender, 2 subject, 3 body, 4 to (LS-separated), 5 cc, 6 bcc, 7 draft id, 8 Message-ID of the message answered
// (bare, or ""), 9 the draft's account. A saved draft is a `message`, which Mail's `send` cannot take, so the script
// sends an outgoing message with the draft's text and moves the original draft to the Trash. With a Message-ID found in
// that account (INBOX first, then its other mailboxes, Sent included: P85, a message on the owner's initiative answers
// our own sent copy) the outgoing message is Mail's own `reply` to it, which carries In-Reply-To and References
// (P56: `make new outgoing message` has no header property, so a hub send started a new thread at the client); the
// recipients are then set to exactly the draft's. Not found: a new outgoing message, as before.
export const SEND_SCRIPT = `on run argv
  set LS to (ASCII character 29)
  set theSender to item 1 of argv
  set theSubject to item 2 of argv
  set theBody to item 3 of argv
  set tos to my parts(item 4 of argv, LS)
  set ccs to my parts(item 5 of argv, LS)
  set bccs to my parts(item 6 of argv, LS)
  set draftId to (item 7 of argv) as integer
  set inReplyTo to ""
  set accName to ""
  if (count of argv) > 8 then
    set inReplyTo to item 8 of argv
    set accName to item 9 of argv
  end if
  tell application "Mail"
    set msg to missing value
    if inReplyTo is not "" and accName is not "" then
      set src to missing value
      try
        set src to (first message of mailbox "INBOX" of account accName whose message id is inReplyTo)
      end try
      if src is missing value then
        try
          repeat with b in (mailboxes of account accName)
            set bn to name of b
            if bn is not "INBOX" and {"Drafts", "Trash", "Deleted Messages", "Bin", "Spam", "Junk"} does not contain bn then
              try
                set src to (first message of b whose message id is inReplyTo)
                exit repeat
              end try
            end if
          end repeat
        end try
      end if
      if src is not missing value then
        set msg to reply src opening window false
        delete every to recipient of msg
        delete every cc recipient of msg
        delete every bcc recipient of msg
        set subject of msg to theSubject
        set content of msg to theBody
      end if
    end if
    if msg is missing value then set msg to make new outgoing message with properties {subject:theSubject, content:theBody, visible:false}
    if theSender is not "" then set sender of msg to theSender
    try
      set message signature of msg to missing value
    end try
    tell msg
      repeat with a in tos
        make new to recipient at end of to recipients with properties {address:(contents of a)}
      end repeat
      repeat with a in ccs
        make new cc recipient at end of cc recipients with properties {address:(contents of a)}
      end repeat
      repeat with a in bccs
        make new bcc recipient at end of bcc recipients with properties {address:(contents of a)}
      end repeat
    end tell
    set ok to send msg
    if ok is not true then error "Mail did not send the message"
    try
      delete (first message of drafts mailbox whose id is draftId)
    end try
  end tell
  return "ok"
end run

on parts(s, d)
  if s is "" then return {}
  set AppleScript's text item delimiters to d
  set r to text items of s
  set AppleScript's text item delimiters to ""
  return r
end parts`;

/**
 * Mail.app through osascript. Plain text only; a draft with attachments is refused before it gets here. `read` runs the
 * finds (a page waits on them: the server passes a short budget, so a hung Mail is a "not answering" reason, not a
 * request open for two minutes); listing, trash and send keep `osa`.
 */
export function mailAppMailer(osa: OsaRun = defaultOsa, read: OsaRun = osa): Mailer {
  return {
    async findDrafts(q) {
      return parseFindOutput(await read(FIND_SCRIPT, [q.subject]));
    },
    async findInTrash(q) {
      return parseFindOutput(await read(FIND_SCRIPT, [q.subject, "trash"]));
    },
    async listDrafts() {
      return parseDraftHeads(await osa(LIST_DRAFTS_SCRIPT, []));
    },
    async trashDrafts(items) {
      if (items.length === 0) return { moved: [], refused: [] };
      return parseTrashOutput(await osa(TRASH_SCRIPT, items.flatMap((i) => [i.account, rawId(i.messageId)])));
    },
    async send(d, replyTo) {
      // P94: never a blank line above the text (Mail's reply adds its own empty top line; `assess` already strips, this is the door's own guard).
      const out = await osa(SEND_SCRIPT, [d.sender ?? "", d.subject, withoutLeadingBlankLines(d.body), d.to.join(LS), d.cc.join(LS), d.bcc.join(LS), d.ref, bareId(replyTo), d.account ?? ""]);
      if (!/ok/.test(out)) throw new Error(`Mail answered "${out.trim().slice(0, 100)}"`);
      return { messageId: null };
    },
  };
}

/** What `hub drafts sweep` needs of Mail (P56): list drafts, read candidates, move recorded versions to Trash. No send: it holds no send door. */
export type DraftsCleaner = Pick<Mailer, "listDrafts" | "findDrafts" | "trashDrafts">;

export function mailAppDraftsCleaner(osa: OsaRun = defaultOsa): DraftsCleaner {
  const m = mailAppMailer(osa);
  return { listDrafts: () => m.listDrafts(), findDrafts: (q) => m.findDrafts(q), trashDrafts: (items) => m.trashDrafts(items) };
}

/** Records what it was asked and never leaves the process. `failSend` makes `send` throw once. */
export class FakeMailer implements Mailer {
  drafts: MailDraft[];
  /** What was moved to Trash, and what a test put there. */
  trash: MailDraft[] = [];
  sent: MailDraft[] = [];
  /** The `replyTo` of each send, in order. */
  replies: Array<string | null> = [];
  failSend: string | null = null;
  failTrash: string | null = null;
  finds = 0;
  constructor(drafts: MailDraft[] = []) {
    this.drafts = drafts;
  }
  async findDrafts(q: DraftQuery): Promise<MailDraft[]> {
    this.finds++;
    return this.drafts.filter((d) => d.subject === q.subject);
  }
  async findInTrash(q: DraftQuery): Promise<MailDraft[]> {
    return this.trash.filter((d) => d.subject === q.subject);
  }
  async listDrafts(): Promise<DraftHead[]> {
    return this.drafts.map((d) => ({ ref: d.ref, messageId: d.messageId, account: d.account, subject: d.subject, inReplyTo: d.inReplyTo }));
  }
  async trashDrafts(items: TrashItem[]): Promise<{ moved: string[]; refused: string[] }> {
    if (this.failTrash) throw new Error(this.failTrash);
    const moved: string[] = [];
    const refused: string[] = [];
    for (const i of items) {
      const d = this.drafts.find((x) => bareId(x.messageId) === bareId(i.messageId) && x.account === i.account);
      if (d) {
        this.drafts = this.drafts.filter((x) => x !== d);
        this.trash.push(d);
        moved.push(i.messageId);
      } else refused.push(i.messageId);
    }
    return { moved, refused };
  }
  async send(d: MailDraft, replyTo?: string | null): Promise<{ messageId: string | null }> {
    if (this.failSend) {
      const m = this.failSend;
      this.failSend = null;
      throw new Error(m);
    }
    this.replies.push(replyTo ?? null);
    this.sent.push(d);
    this.drafts = this.drafts.filter((x) => x.ref !== d.ref);
    return { messageId: `fake-${this.sent.length}@hub.test` };
  }
}

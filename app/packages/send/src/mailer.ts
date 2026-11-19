import { execFile } from "node:child_process";

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

/** One Mail draft the hub may move to Trash, and the line its text must still start with when it is moved (P56). */
export interface TrashItem {
  ref: string;
  /** The first non-empty line, exactly as `hubAuthorship` found it: the script refuses the draft when the text no longer starts with it. */
  line: string;
}

export interface Mailer {
  /** Drafts whose subject equals `subject` (candidates; the caller picks by `mailRef` and recipient). Read only. */
  findDrafts(q: DraftQuery): Promise<MailDraft[]>;
  /** Messages in Mail's Trash with this subject: where a deleted draft is found again (P56, `mail_gone`). Read only. */
  findInTrash(q: DraftQuery): Promise<MailDraft[]>;
  /** Every draft whose text holds a hub marker or the legacy run line, in every account: what `hub drafts sweep` judges. Read only. */
  listHubDrafts(): Promise<MailDraft[]>;
  /** Moves these drafts to Trash (recoverable), each only if its text still starts with its line. Never anything else. */
  trashDrafts(items: TrashItem[]): Promise<{ moved: string[]; refused: string[] }>;
  /**
   * Sends exactly this draft's text to exactly its recipients. `replyTo` (the bare Message-ID of the message answered,
   * P56) makes the outgoing mail a reply to it, so it keeps `In-Reply-To` and `References`. Throws when Mail refuses.
   */
  send(d: MailDraft, replyTo?: string | null): Promise<{ messageId: string | null }>;
}

/** Runs osascript with the script and its arguments (`on run argv`). Injected so tests never reach Mail. */
export type OsaRun = (script: string, args: string[]) => Promise<string>;

export const defaultOsa: OsaRun = (script, args) =>
  new Promise((resolve, reject) =>
    execFile("osascript", ["-e", script, ...args], { timeout: 120_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(String(stderr || err.message).slice(0, 300))) : resolve(stdout),
    ),
  );

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
      set out to out & (id of m) & FS & (message id of m) & FS & acc & FS & (sender of m) & FS & tos & FS & ccs & FS & bccs & FS & (subject of m) & FS & (content of m) & FS & n & RS
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

// No argv. The drafts of every account whose text holds a hub line; the caller judges each by `hubAuthorship`.
export const LIST_HUB_SCRIPT = `on run argv${SEPARATORS}
  tell application "Mail"
    set ms to (messages of drafts mailbox whose content contains "[hub-draft thread=" or content contains "[Reforms draft, run ")${RECORDS}
  end tell
  return out
end run`;

// argv: pairs of (draft id, line). A draft is moved to Trash (Mail's delete: recoverable) only when its first non-empty
// paragraph still starts with that line, read again here, just before the delete. Output: moved (LS-joined) FS refused.
export const TRASH_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set LS to (ASCII character 29)
  set moved to ""
  set refused to ""
  tell application "Mail"
    repeat with i from 1 to (count of argv) by 2
      set did to item i of argv
      set wanted to item (i + 1) of argv
      set ok to false
      try
        set m to (first message of drafts mailbox whose id is (did as integer))
        set firstLine to ""
        repeat with p in paragraphs of ((content of m) as text)
          if (contents of p) is not "" then
            set firstLine to (contents of p)
            exit repeat
          end if
        end repeat
        if firstLine starts with wanted then
          delete m
          set ok to true
        end if
      end try
      if ok then
        set moved to moved & did & LS
      else
        set refused to refused & did & LS
      end if
    end repeat
  end tell
  return moved & FS & refused
end run`;

export function parseTrashOutput(out: string): { moved: string[]; refused: string[] } {
  const [moved = "", refused = ""] = out.replace(/[\r\n]+$/, "").split(FS);
  const ids = (v: string) => v.split(LS).map((x) => x.trim()).filter(Boolean);
  return { moved: ids(moved), refused: ids(refused) };
}

export function parseFindOutput(out: string): MailDraft[] {
  const list = (v: string) => v.split(LS).map((x) => x.trim()).filter(Boolean);
  const drafts: MailDraft[] = [];
  for (const rec of out.split(RS)) {
    const p = rec.replace(/^[\r\n]+/, "").split(FS);
    if (p.length < 10) continue;
    const [ref, messageId, account, sender, to, cc, bcc, subject, body, n] = p as [string, string, string, string, string, string, string, string, string, string];
    drafts.push({ ref, messageId: bareId(messageId) || null, account: account || null, sender: sender || null, to: list(to), cc: list(cc), bcc: list(bcc), subject, body, attachments: Number(n) || 0 });
  }
  return drafts;
}

// argv: 1 sender, 2 subject, 3 body, 4 to (LS-separated), 5 cc, 6 bcc, 7 draft id, 8 Message-ID of the message answered
// (bare, or ""), 9 the draft's account. A saved draft is a `message`, which Mail's `send` cannot take, so the script
// sends an outgoing message with the draft's text and moves the original draft to the Trash. With a Message-ID found in
// that account (INBOX first) the outgoing message is Mail's own `reply` to it, which carries In-Reply-To and References
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
            if bn is not "INBOX" and {"Drafts", "Sent", "Sent Mail", "Sent Messages", "Trash", "Deleted Messages", "Bin", "Spam", "Junk"} does not contain bn then
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

/** Mail.app through osascript. Plain text only; a draft with attachments is refused before it gets here. */
export function mailAppMailer(osa: OsaRun = defaultOsa): Mailer {
  return {
    async findDrafts(q) {
      return parseFindOutput(await osa(FIND_SCRIPT, [q.subject]));
    },
    async findInTrash(q) {
      return parseFindOutput(await osa(FIND_SCRIPT, [q.subject, "trash"]));
    },
    async listHubDrafts() {
      return parseFindOutput(await osa(LIST_HUB_SCRIPT, []));
    },
    async trashDrafts(items) {
      if (items.length === 0) return { moved: [], refused: [] };
      return parseTrashOutput(await osa(TRASH_SCRIPT, items.flatMap((i) => [i.ref, i.line])));
    },
    async send(d, replyTo) {
      const out = await osa(SEND_SCRIPT, [d.sender ?? "", d.subject, d.body, d.to.join(LS), d.cc.join(LS), d.bcc.join(LS), d.ref, bareId(replyTo), d.account ?? ""]);
      if (!/ok/.test(out)) throw new Error(`Mail answered "${out.trim().slice(0, 100)}"`);
      return { messageId: null };
    },
  };
}

/** What `hub drafts sweep` needs of Mail (P56): list the hub's drafts and move them to Trash. No send: the sweep holds no send door. */
export type DraftsCleaner = Pick<Mailer, "listHubDrafts" | "trashDrafts">;

export function mailAppDraftsCleaner(osa: OsaRun = defaultOsa): DraftsCleaner {
  const m = mailAppMailer(osa);
  return { listHubDrafts: () => m.listHubDrafts(), trashDrafts: (items) => m.trashDrafts(items) };
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
  async listHubDrafts(): Promise<MailDraft[]> {
    return this.drafts.filter((d) => /\[hub-draft thread=|\[Reforms draft, run /i.test(d.body));
  }
  async trashDrafts(items: TrashItem[]): Promise<{ moved: string[]; refused: string[] }> {
    if (this.failTrash) throw new Error(this.failTrash);
    const moved: string[] = [];
    const refused: string[] = [];
    for (const i of items) {
      const d = this.drafts.find((x) => x.ref === i.ref);
      const first = d?.body.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
      if (d && first.toLowerCase().startsWith(i.line.toLowerCase())) {
        this.drafts = this.drafts.filter((x) => x !== d);
        this.trash.push(d);
        moved.push(i.ref);
      } else refused.push(i.ref);
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

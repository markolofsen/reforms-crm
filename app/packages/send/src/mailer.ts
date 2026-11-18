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

export interface Mailer {
  /** Drafts whose subject equals `subject` (candidates; the caller picks by `mailRef` and recipient). Read only. */
  findDrafts(q: DraftQuery): Promise<MailDraft[]>;
  /** Sends exactly this draft's text to exactly its recipients. Throws when Mail refuses. */
  send(d: MailDraft): Promise<{ messageId: string | null }>;
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

// argv: 1 subject. Output: one record per draft, fields separated by FS, lists by LS.
export const FIND_SCRIPT = `on run argv
  set FS to (ASCII character 31)
  set RS to (ASCII character 30)
  set LS to (ASCII character 29)
  set subj to item 1 of argv
  set out to ""
  tell application "Mail"
    set ms to (messages of drafts mailbox whose subject is subj)
    repeat with m in ms
      -- a draft Mail flags as deleted is on its way out (a revision's older version, P52): not a draft
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
    end repeat
  end tell
  return out
end run`;

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

// argv: 1 sender, 2 subject, 3 body, 4 to (LS-separated), 5 cc, 6 bcc, 7 draft id. Sends a NEW outgoing message with the
// draft's text (a saved draft is a `message`, which Mail's `send` cannot take), then moves the original draft to the Trash.
export const SEND_SCRIPT = `on run argv
  set LS to (ASCII character 29)
  set theSender to item 1 of argv
  set theSubject to item 2 of argv
  set theBody to item 3 of argv
  set tos to my parts(item 4 of argv, LS)
  set ccs to my parts(item 5 of argv, LS)
  set bccs to my parts(item 6 of argv, LS)
  set draftId to (item 7 of argv) as integer
  tell application "Mail"
    set msg to make new outgoing message with properties {subject:theSubject, content:theBody, visible:false}
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
    async send(d) {
      const out = await osa(SEND_SCRIPT, [d.sender ?? "", d.subject, d.body, d.to.join(LS), d.cc.join(LS), d.bcc.join(LS), d.ref]);
      if (!/ok/.test(out)) throw new Error(`Mail answered "${out.trim().slice(0, 100)}"`);
      return { messageId: null };
    },
  };
}

/** Records what it was asked and never leaves the process. `failSend` makes `send` throw once. */
export class FakeMailer implements Mailer {
  drafts: MailDraft[];
  sent: MailDraft[] = [];
  failSend: string | null = null;
  finds = 0;
  constructor(drafts: MailDraft[] = []) {
    this.drafts = drafts;
  }
  async findDrafts(q: DraftQuery): Promise<MailDraft[]> {
    this.finds++;
    return this.drafts.filter((d) => d.subject === q.subject);
  }
  async send(d: MailDraft): Promise<{ messageId: string | null }> {
    if (this.failSend) {
      const m = this.failSend;
      this.failSend = null;
      throw new Error(m);
    }
    this.sent.push(d);
    this.drafts = this.drafts.filter((x) => x.ref !== d.ref);
    return { messageId: `fake-${this.sent.length}@hub.test` };
  }
}

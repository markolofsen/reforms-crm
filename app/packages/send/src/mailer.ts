import { withoutLeadingBlankLines } from "@hub/db";
import { mailAppDrafts, type DraftHead, type DraftQuery, type MailDraft, type TrashItem } from "@hub/mail-app/drafts";
import { osaFor, type OsaRun } from "@hub/mail-app/osa";
import { bareId, LS } from "@hub/mail-app/records";

// The one door out of the hub (decision 0011). `Mailer` is the whole surface `hub send` needs from Mail: read the
// drafts that match a recorded draft, and send one of them. `MailAppMailer` does it through Mail.app's scripting
// with `osascript` run by the hub process; the agent's shell has `Bash(osascript *)` denied (P17), so it cannot reach
// this path. `FakeMailer` is what every test uses: no test touches Mail or sends anything. Reading, listing and
// trashing the drafts is `@hub/mail-app`'s (P126 M1); the send script is the one thing only this file holds.

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
export function mailAppMailer(osa: OsaRun = osaFor("long"), read: OsaRun = osa): Mailer {
  return {
    ...mailAppDrafts(osa, read),
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

export function mailAppDraftsCleaner(osa: OsaRun = osaFor("long")): DraftsCleaner {
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

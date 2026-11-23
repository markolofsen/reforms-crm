// The Mail draft writer's types (P52, P65, P85b): what a write takes and returns, and the writer's interface.
import { HubError } from "@hub/config/errors";

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

/** Mail did not take the draft: `unavailable` (503); `code` is the Mail script's own (`mail_slow`, `mail_not_running`…). */
export class DraftWriteError extends HubError {
  /** `mail_slow`: Mail's reply shell, when the writer saw it (its hash goes on the write record). */
  shell?: string;
  constructor(code: string, message: string, shell?: string) {
    super("unavailable", code, message);
    this.name = "DraftWriteError";
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
  /** P85b: an unsent NEW message (a new thread: it answers nothing) to one client, saved in Drafts. Absent: a new thread is refused. */
  writeNew?(input: NewDraftInput): Promise<ReplyDraftResult>;
  /** The message with this Message-ID in one of these accounts (INBOX first, then the other mailboxes, Sent included (P85), but Drafts, Trash and Spam), or null. */
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

/** What the new-thread writer needs: the account to write from, its From, the client, the subject and the plain text. */
export interface NewDraftInput {
  /** One of the project's Mail accounts (as Mail names it): its addresses decide the From when `sender` is empty. */
  account: string;
  /** The From: the project's sender or brand address; "" or null: the account's first address with its full name. */
  sender: string | null;
  /** The client's address (one); never one of ours. */
  to: string;
  subject: string;
  body: string;
  /** The Hub's older versions of this new thread (from `mail_versions`): moved to Trash after the save. */
  replace?: readonly { account: string; messageId: string }[];
  /** The accounts Mail may save the draft in (the project's `mail.accounts`). */
  landIn?: readonly string[];
  waitSeconds?: number;
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

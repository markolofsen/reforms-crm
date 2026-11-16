/**
 * The smallest read-only surface the history and Sent readers need from an IMAP connection.
 * There is no write method here on purpose: nothing can append, flag, move, delete or send through a session.
 * `imapflow.ts` implements it over a real server, `fake.ts` over memory.
 */

export interface MailboxInfo {
  path: string;
  /** RFC 6154 special-use flag when the server reports one: `\Sent`, `\Drafts`, `\Trash`, `\Junk`, `\All`. */
  specialUse?: string;
}

/** Header-level view of one stored message. Addresses are lower-case bare addresses. */
export interface RawHeader {
  uid: number;
  /** Message-Id with angle brackets, or null when the message has none. */
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  /** ISO 8601 UTC. */
  date: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  size: number;
  attachmentCount: number;
}

/** A closed query: no free text, no path, no IMAP syntax from the caller. At least one field is set. */
export interface ImapQuery {
  /** Matches From, To or Cc (the server does a substring match; callers filter exactly afterwards). */
  address?: string;
  messageId?: string;
  /** Internal date on or after this day (IMAP SINCE has day granularity). */
  since?: Date;
}

export interface ImapSession {
  list(): Promise<MailboxInfo[]>;
  /** Ascending UIDs of the matches. The mailbox is opened read-only (EXAMINE), so reading never sets \Seen. */
  search(path: string, query: ImapQuery): Promise<number[]>;
  headers(path: string, uids: number[]): Promise<RawHeader[]>;
  source(path: string, uid: number): Promise<Uint8Array | null>;
  close(): Promise<void>;
}

/** One configured mailbox login. Built by `creds.ts`; the secret never leaves `auth`. */
export interface ImapAccount {
  /** The account name a project lists under `mail.accounts`. */
  name: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** App password (`pass`) or OAuth2 access token (`accessToken`, XOAUTH2). */
  auth: { pass: string } | { accessToken: string };
  /** Mailboxes to search. Default: every mailbox except Drafts, Trash and Junk (Gmail: All Mail only). */
  mailboxes?: string[];
  /** Name of the Sent folder when special-use detection fails. */
  sentMailbox?: string;
  /** Own addresses (a message from one of them is `out`). The login name is always one. */
  addresses: string[];
}

export type ImapConnect = (account: ImapAccount) => Promise<ImapSession>;

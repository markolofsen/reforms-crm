/**
 * History helper contract (types only; the IMAP reader comes later, see doc 05 and research 02, D2).
 *
 * "All mail with a client address, paged": every message in any mailbox of the configured accounts that has
 * the address in From, To or Cc, in and out, deduplicated by Message-Id. The implementation is read-only by
 * construction: nothing here can send, and nothing takes a path or a query language.
 *
 * The reader returns raw RFC 822 bytes; a caller decodes them (the Mail-to-Markdown converter is archived: the archived mail-to-markdown material (not part of this repo)). Pages walk from the newest
 * message to older ones, so a caller that wants "the last 20" reads one page and stops.
 */

export type HistoryDirection = "in" | "out";

/** Header-level view of one message: enough to build an index line without fetching the body. */
export interface HistoryEntry {
  /** Message-Id with angle brackets: the stable key (cache key is sha1(id + date), doc 05 section 5). */
  id: string;
  /** Send time, ISO 8601 UTC. */
  date: string;
  /** `out` when the sender is one of the configured own addresses. */
  direction: HistoryDirection;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  /** Mailbox where the copy was read first (a message in several mailboxes is listed once). */
  mailbox: string;
  /** Number of attachments, so the index can show it without parsing. */
  attachmentCount: number;
  /** Size of the raw message in bytes. */
  size: number;
}

export interface HistoryQuery {
  /** Client address, validated against a strict e-mail pattern; matched against From, To and Cc. */
  address: string;
  /** Page size, 1 to 200. Default 20. */
  limit?: number;
  /** Opaque cursor from a previous page's `nextCursor`; omit for the newest page. */
  cursor?: string;
  /** Only messages sent after this instant (ISO 8601 UTC), for `since_profile` reads. Inclusive. */
  since?: string;
  /** Restrict to one direction. Default: both. */
  direction?: HistoryDirection;
}

export interface HistoryPage {
  address: string;
  /** Entries, newest first. */
  entries: HistoryEntry[];
  /** Total matching messages for the query (ignoring `cursor` and `limit`). */
  total: number;
  /** Present while older messages remain. Opaque to the caller. */
  nextCursor?: string;
}

/** Why a read failed. `not_allowed` is the allow-list refusal of doc 05 section 6. */
export type HistoryErrorCode = "not_allowed" | "bad_address" | "bad_cursor" | "unavailable";

/** Methods of `MailHistory` reject with an `Error` that carries one of these codes. */
export interface HistoryError extends Error {
  code: HistoryErrorCode;
}

export interface MailHistory {
  /** One page of the history with `address`, newest first. */
  page(query: HistoryQuery): Promise<HistoryPage>;
  /** Raw RFC 822 source of one message by Message-Id, or null if it is gone.  */
  source(id: string): Promise<Uint8Array | null>;
}

import { z } from "zod";

// The Mail reader's replies (P96 S1): the Inbox view of Mail (the clients who wrote and have no draft yet) and one message's
// card, its text read from Mail when it is opened. Read-only toward Mail; the only writes are the owner's No reply needed and
// its Undo (local state) and Check now (one read pass). Never a body stored: `preview` is at most 120 characters.

export const INBOUND_WHY = ["thread", "client", "test"] as const;

/** One client of the Inbox view: their newest open message, and how many open messages they have. */
export const inboundRowDto = z.strictObject({
  id: z.number().int(),
  email: z.string(),
  name: z.string(),
  subject: z.string(),
  receivedAt: z.string(),
  /** Mail's read flag. Reading is not answering: a read message stays in Inbox. */
  read: z.boolean(),
  /** Why the Hub took it: it answers a mail of ours, the sender is a known client, or the owner's test address in test mode. */
  why: z.enum(INBOUND_WHY),
  preview: z.string(),
  messages: z.number().int(),
  /** The Hub's draft whose thread this message answers, if the reader matched one. */
  threadDraftId: z.number().int().nullable(),
});
export type InboundRowDto = z.infer<typeof inboundRowDto>;

/** The reader's line: when it last read this project's mail, or why it does not; whether a pass runs now. */
/** The reader's reasons a read pass can cure (Mail opened again, a passing error): only then is Check now worth a place beside the reason. */
export const MAIL_NOT_RUNNING = "Mail is not running";
export const MAIL_UNREADABLE = "Mail could not be read";
export const MAIL_READ_RETRYABLE: readonly string[] = [MAIL_NOT_RUNNING, MAIL_UNREADABLE];

export const mailReadDto = z.strictObject({ at: z.string().nullable(), reason: z.string().nullable(), reading: z.boolean(), unknown: z.number().int() });
export type MailReadDto = z.infer<typeof mailReadDto>;

/** `GET /api/projects/:slug/inbound`: the Inbox view. `unknown` is the muted line, the messages from senders the Hub does not know. */
export const inboundListDto = z.strictObject({
  rows: z.array(inboundRowDto),
  total: z.number().int(),
  read: mailReadDto,
});
export type InboundListDto = z.infer<typeof inboundListDto>;

/** `GET /api/projects/:slug/inbound/:id`: one message, its text read from Mail now (null with `note` when Mail cannot show it). */
export const inboundDetailDto = z.strictObject({
  row: inboundRowDto.extend({ account: z.string(), mailbox: z.string(), messageId: z.string(), open: z.boolean(), dismissedAt: z.string().nullable() }),
  /** The client's own words (the quote of the earlier mail folded away), or null. */
  text: z.string().nullable(),
  /** Whether a quote of an earlier mail was folded away. */
  quoted: z.boolean(),
  /** Why there is no text ("Mail is not running", "This message is no longer in Mail"). */
  note: z.string().nullable(),
  /** The client's drafts in this project, newest first (links on the card). */
  drafts: z.array(z.strictObject({ id: z.number().int(), subject: z.string(), status: z.string() })),
  /** The client's other open messages (subjects and when). */
  others: z.array(z.strictObject({ id: z.number().int(), subject: z.string(), receivedAt: z.string() })),
  notionUrl: z.string().nullable(),
});
export type InboundDetailDto = z.infer<typeof inboundDetailDto>;

/** `POST .../inbound/:id/dismiss` (No reply needed) answers the ids it closed, for Undo (`POST .../inbound/undismiss`). */
export const inboundDismissedDto = z.strictObject({ ok: z.literal(true), ids: z.array(z.number().int()) });
export type InboundDismissedDto = z.infer<typeof inboundDismissedDto>;
export const inboundUndismissBody = z.strictObject({ ids: z.array(z.number().int().positive()).min(1).max(200) });

/** `POST .../inbound/check` (Check now): the line after the pass this request waited for. */
export const inboundCheckedDto = z.strictObject({ ok: z.literal(true), read: mailReadDto });

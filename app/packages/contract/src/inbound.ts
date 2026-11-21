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

export const mailReadDto = z.strictObject({
  at: z.string().nullable(),
  reason: z.string().nullable(),
  reading: z.boolean(),
  unknown: z.number().int(),
  /** P97: messages in the window that are a site's notification of a lead (never a client row; the lead is listed from Notion Leads). */
  notices: z.number().int().optional(),
});
export type MailReadDto = z.infer<typeof mailReadDto>;

// P97 S2 (decision 0044): the Leads group of Inbox, read from the project's Notion Leads (never from a notice mail).

/** One person of the Leads group: their newest open request (Status New or empty, in the window, not dismissed, no draft yet). */
export const leadRowDto = z.strictObject({
  pageId: z.string(),
  name: z.string(),
  /** The reply address (the email typed on the form, else the Leads Email); null: none, the card says which channel to use. */
  email: z.string().nullable(),
  accountEmail: z.string().nullable(),
  brand: z.string().nullable(),
  receivedAt: z.string(),
  preview: z.string(),
  /** Open requests sharing the address (verdict 7: one person, "2 requests"). */
  requests: z.number().int(),
});
export type LeadRowDto = z.infer<typeof leadRowDto>;

/** The Leads line: when Leads were last read, or why not; the older New leads (one muted count); the window in days. */
export const leadsReadDto = z.strictObject({
  at: z.string().nullable(),
  reason: z.string().nullable(),
  reading: z.boolean(),
  older: z.number().int(),
  windowDays: z.number().int(),
});
export type LeadsReadDto = z.infer<typeof leadsReadDto>;

export const leadsGroupDto = z.strictObject({ rows: z.array(leadRowDto), total: z.number().int(), read: leadsReadDto });
export type LeadsGroupDto = z.infer<typeof leadsGroupDto>;

/** `GET /api/projects/:slug/inbound`: the Inbox view. `unknown` is the muted line, the messages from senders the Hub does not know. */
export const inboundListDto = z.strictObject({
  rows: z.array(inboundRowDto),
  total: z.number().int(),
  read: mailReadDto,
  /** P97: the Leads group above the clients who wrote; absent from a server before P97. */
  leads: leadsGroupDto.optional(),
});
export type InboundListDto = z.infer<typeof inboundListDto>;

/**
 * `GET /api/projects/:slug/inbound/:id`: one message's state from the Hub's own record (P98 item 3: no Mail read, so the live
 * topics `drafts` and `inbox` refresh it the moment a draft lands). The text is `GET .../inbound/:id/text`.
 */
export const inboundDetailDto = z.strictObject({
  row: inboundRowDto.extend({ account: z.string(), mailbox: z.string(), messageId: z.string(), open: z.boolean(), dismissedAt: z.string().nullable() }),
  /** The client's drafts in this project, newest first (links on the card). */
  drafts: z.array(z.strictObject({ id: z.number().int(), subject: z.string(), status: z.string(), createdAt: z.string() })),
  /** The draft that answers this message (its mailRef names it, else the client's newest draft recorded after it), or null. */
  answer: z.strictObject({ id: z.number().int(), subject: z.string(), status: z.string(), createdAt: z.string(), excerpt: z.string() }).nullable(),
  /** The client's other open messages (subjects and when). */
  others: z.array(z.strictObject({ id: z.number().int(), subject: z.string(), receivedAt: z.string() })),
  notionUrl: z.string().nullable(),
});
export type InboundDetailDto = z.infer<typeof inboundDetailDto>;

/** `GET /api/projects/:slug/inbound/:id/text`: the client's own words read from Mail now (null with `note` when Mail cannot show it). */
export const inboundTextDto = z.strictObject({
  /** The client's own words (the quote of the earlier mail folded away), or null. */
  text: z.string().nullable(),
  /** Whether a quote of an earlier mail was folded away. */
  quoted: z.boolean(),
  /** Why there is no text ("Mail is not running", "This message is no longer in Mail"). */
  note: z.string().nullable(),
});
export type InboundTextDto = z.infer<typeof inboundTextDto>;

/** `POST .../inbound/:id/dismiss` (No reply needed) answers the ids it closed, for Undo (`POST .../inbound/undismiss`). */
export const inboundDismissedDto = z.strictObject({ ok: z.literal(true), ids: z.array(z.number().int()) });
export type InboundDismissedDto = z.infer<typeof inboundDismissedDto>;
export const inboundUndismissBody = z.strictObject({ ids: z.array(z.number().int().positive()).min(1).max(200) });

/** `POST .../inbound/check` (Check now): the line after the pass this request waited for. */
export const inboundCheckedDto = z.strictObject({ ok: z.literal(true), read: mailReadDto });

/** `GET /api/projects/:slug/leads/:pageId`: one lead, its page read from Notion now (`lead` null with `note` when it cannot be). */
export const leadDetailDto = z.strictObject({
  row: leadRowDto.extend({
    open: z.boolean(),
    notionStatus: z.string().nullable(),
    dismissedAt: z.string().nullable(),
    dismissedReason: z.enum(["not_now", "spam"]).nullable(),
    convertedAt: z.string().nullable(),
    clientPageId: z.string().nullable(),
    /** What the owner must do when Notion refused a write at the first send (S4), else null. */
    convertNote: z.string().nullable(),
  }),
  lead: z
    .strictObject({
      company: z.string().nullable(),
      message: z.string(),
      details: z.string(),
      form: z.string().nullable(),
      pageUrl: z.string().nullable(),
      phone: z.string().nullable(),
      brands: z.array(z.string()),
      /** The contact typed on the form when it is not an email ("WhatsApp: …"): no mail draft, reply on that channel. */
      otherContact: z.string().nullable(),
    })
    .nullable(),
  note: z.string().nullable(),
  /** The Hub's drafts to this lead's address, newest first. */
  drafts: z.array(z.strictObject({ id: z.number().int(), subject: z.string(), status: z.string() })),
});
export type LeadDetailDto = z.infer<typeof leadDetailDto>;

/** Not now, Spam and their Undo: the local change, and what Notion did (Spam and its Undo write Status; Not now writes nothing). */
export const leadActionDto = z.strictObject({ ok: z.literal(true), pageId: z.string(), notion: z.enum(["written", "skipped", "refused", "off", "none"]), note: z.string().nullable() });
export type LeadActionDto = z.infer<typeof leadActionDto>;

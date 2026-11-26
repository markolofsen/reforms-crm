import { z } from "zod";
import { LEAD_PASS_DECISIONS, LEAD_PASS_DISPLAY } from "@hub/config/lead-pass";

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

/** P138 verdict 6: the list row's facts, read from the form when the lead was stored (each at most 60 characters), else null. */
export const leadFactsDto = z.strictObject({ site: z.string().nullable(), country: z.string().nullable(), segment: z.string().nullable(), volume: z.string().nullable() });
export type LeadFactsDto = z.infer<typeof leadFactsDto>;
export const NO_LEAD_FACTS: LeadFactsDto = { site: null, country: null, segment: null, volume: null };

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
  facts: leadFactsDto,
  /** The current work state, including owner actions made without an agent decision. */
  display: z.enum(LEAD_PASS_DISPLAY),
  /** P147 verdict 15: the daily lead pass's decision on this request (the card's chip and Redo), or null when none was made. */
  pass: z.strictObject({ decision: z.enum(LEAD_PASS_DECISIONS), display: z.enum(LEAD_PASS_DISPLAY).optional(), reason: z.string().nullable(), at: z.string().nullable(), draftId: z.number().int().nullable(), excludedAt: z.string().nullable() }).nullable(),
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

/**
 * P134 verdicts 6-7: Mail ▸ Leads, its views. New: the open leads of the window (the Leads group's rows, all of them, paged);
 * Not now and Spam: the owner's two asides; Replied: the leads a first send answered (they became a client, P97 S4).
 * P147 verdict 15: Drafted holds the leads the daily pass decided with a draft or a proposal; For you its hand-overs.
 */
export const LEAD_VIEWS = ["needs_you", "all", "new", "drafted", "for_you", "not_now", "spam", "replied"] as const;
export type LeadView = (typeof LEAD_VIEWS)[number];
export const LEAD_VIEW_LABELS: Readonly<Record<LeadView, string>> = { needs_you: "Needs you", all: "All", new: "New", drafted: "To review", for_you: "Needs decision", not_now: "Deferred", spam: "Spam", replied: "Answered" };

/** `GET /api/projects/:slug/leads`: one view of the project's leads, one row per person, newest first. */
export const leadsListQuery = z.object({
  view: z.enum(LEAD_VIEWS).default("needs_you"),
  q: z.string().trim().max(200).default(""),
  brand: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const leadsListDto = z.strictObject({
  rows: z.array(leadRowDto),
  total: z.number().int(),
  nextOffset: z.number().int().nullable(),
  /** Every view's count (never narrowed by the brand). */
  counts: z.strictObject({ needs_you: z.number().int(), all: z.number().int(), new: z.number().int(), drafted: z.number().int(), for_you: z.number().int(), not_now: z.number().int(), spam: z.number().int(), replied: z.number().int() }),
  /** The brands of the view's leads with how many people each, most first; the filter shows them only with two or more. */
  brands: z.array(z.strictObject({ name: z.string(), count: z.number().int() })),
  read: leadsReadDto,
});
export type LeadsListDto = z.infer<typeof leadsListDto>;

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
  /** The client's own words (quoted history is represented by its own messages), or null. */
  text: z.string().nullable(),
  /** Whether the Mail reader found quoted history outside the client's own words. */
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

/** P138 E1: how the person asked to be contacted (the form's `Contact channel`); WhatsApp and Telegram open the app, never send. */
export const LEAD_CHANNEL_KINDS = ["whatsapp", "telegram", "email", "phone", "other"] as const;

/**
 * P138 verdicts 1-2: the lead's form, read from the page's Details: what they want (known fields first, then every unknown one),
 * the channel, the sites they named, and the technical lines (locale, hosts, consent, environment), shown last and smaller.
 */
export const leadSheetDto = z.strictObject({
  fields: z.array(z.strictObject({ key: z.string(), label: z.string(), value: z.string(), href: z.string().nullable() })),
  channel: z.strictObject({ kind: z.enum(LEAD_CHANNEL_KINDS), value: z.string() }).nullable(),
  sites: z.array(z.strictObject({ name: z.string(), href: z.string().nullable() })),
  technical: z.array(z.strictObject({ label: z.string(), value: z.string() })),
});
export type LeadSheetDto = z.infer<typeof leadSheetDto>;

/**
 * P138 verdict 4: what the owner should know before replying. `typo`: the address's domain is a common typo; `client`: a client of
 * the project has this address, or an address at the company's website domain; `repeat`: the same address sent `count` forms.
 */
export const leadNoteDto = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("typo"), address: z.string(), suggestion: z.string(), domain: z.string(), meant: z.string() }),
  z.strictObject({ kind: z.literal("client"), by: z.enum(["address", "company"]), clientId: z.number().int(), name: z.string(), email: z.string() }),
  z.strictObject({ kind: z.literal("repeat"), count: z.number().int() }),
]);
export type LeadNoteDto = z.infer<typeof leadNoteDto>;

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
      form: z.string().nullable(),
      sheet: leadSheetDto,
      /** P138 verdict 3: the agent's read (the page's Conversation summary, first line), else null; never written by the admin. */
      read: z.string().nullable(),
      pageUrl: z.string().nullable(),
      phone: z.string().nullable(),
      brands: z.array(z.string()),
      /** The contact typed on the form when it is not an email ("WhatsApp: …"): no mail draft, reply on that channel. */
      otherContact: z.string().nullable(),
    })
    .nullable(),
  note: z.string().nullable(),
  notes: z.array(leadNoteDto),
  /** The Hub's drafts to this lead's address, newest first. */
  drafts: z.array(z.strictObject({ id: z.number().int(), clientId: z.number().int(), subject: z.string(), status: z.string() })),
});
export type LeadDetailDto = z.infer<typeof leadDetailDto>;

/** Not now, Spam and their Undo: the local change, and what Notion did (Spam and its Undo write Status; Not now writes nothing). */
export const leadActionDto = z.strictObject({ ok: z.literal(true), pageId: z.string(), notion: z.enum(["written", "skipped", "refused", "off", "none"]), note: z.string().nullable() });
export type LeadActionDto = z.infer<typeof leadActionDto>;

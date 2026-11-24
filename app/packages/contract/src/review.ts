import { z } from "zod";
import { AUDIENCES, BATCH_FILTERS, BATCH_INTENTS, BATCH_STATUSES, CLIENT_FILTERS, DRAFT_STATUSES, ENROLLMENT_STATES, EVENT_KINDS, EXCLUSION_REASONS, MARKS, NOTION_KINDS, SAFETY_KINDS, TONES } from "@hub/config";

// What the API answers about drafts and clients: the review rows, batches, timeline and history, and the plain acks.
// The server parses its own reply with these (so a column added to a table never leaks to the browser), and the admin
// parses what arrives (so a stale server fails with a sentence, not a render crash). Split out of `responses.ts` (P120 W3).
const iso = z.string();
const nullableIso = z.string().nullable();
const filterCounts = <K extends readonly [string, ...string[]]>(keys: K) => z.record(z.enum(keys), z.number());

export const safetyResultDto = z.object({
  kind: z.enum(SAFETY_KINDS),
  level: z.enum(["amber", "red"]),
  text: z.string(),
  acked: z.boolean(),
});
export type SafetyResultDto = z.infer<typeof safetyResultDto>;

export const clientDto = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
  repliesOwed: z.boolean(),
  lastContactAt: nullableIso,
  marks: z.array(z.enum(MARKS)),
});

/**
 * What a recorded draft was based on: the context block the draft record (`draft_write`) stored as the agent stated it, never
 * judged (P140 K2), and the record's findings (P60 fact-other-brand). No reply text, only short excerpts of the incoming thread.
 */
export const basedOnDto = z.object({
  findings: z.array(z.object({ code: z.string(), text: z.string(), amber: z.boolean() })),
  context: z.object({
    purpose: z.string().optional(),
    thread: z
      .object({
        firstContact: z.boolean().optional(),
        found: z.number().optional(),
        read: z.number().optional(),
        newest: z.string().optional(),
        cited: z.array(z.string()).optional(),
        rows: z.array(z.object({ date: z.string(), who: z.string(), subject: z.string(), excerpt: z.string() })).optional(),
      })
      .optional(),
    profile: z.object({ read: z.boolean().optional(), state: z.string().optional(), editedAt: z.string().optional() }).optional(),
    facts: z.object({ queries: z.number().optional(), used: z.array(z.string()).optional(), missing: z.array(z.string()).optional() }).optional(),
    anchors: z.array(z.string()).optional(),
    personalization: z.string().optional(),
  }),
});
export type BasedOnDto = z.infer<typeof basedOnDto>;

/** One draft to review, the same shape for a recorded draft (Mail) and a batch draft (Bulk). */
export const reviewDraftDto = z.object({
  id: z.number(),
  clientId: z.number(),
  batchId: z.number().nullable(),
  runId: z.number().nullable(),
  subject: z.string(),
  toAddr: z.string(),
  ccAddr: z.string().nullable(),
  body: z.string(),
  reason: z.string().nullable(),
  notionUrl: z.string().nullable(),
  /** Which Notion page the link is: a `client` row or a `lead` page. Null on a draft recorded before the kind existed. */
  notionKind: z.enum(NOTION_KINDS).nullable(),
  notionPageId: z.string().nullable(),
  mailRef: z.string().nullable(),
  /** The agent's one line, shown beside the typed results. */
  safety: z.string().nullable(),
  status: z.enum(DRAFT_STATUSES),
  checked: z.boolean(),
  tone: z.enum(TONES),
  toneBodies: z.partialRecord(z.enum(TONES), z.string()),
  safetyResults: z.array(safetyResultDto),
  /** True while Checked is refused: the server's own gate, so the screen never re-derives it. */
  blocked: z.boolean(),
  canUndo: z.boolean(),
  /** Set by the draft record (`draft_write`) when the mail it answers looked like an injection: the hub never sends such a draft. */
  injectionSuspected: z.boolean(),
  /** What the draft was based on; null on a draft with no context block and no findings (batch drafts, manual drafts). */
  basedOn: basedOnDto.nullable(),
  /** The mail class the agent recorded (client, partner, ...); autosend admits only listed classes. */
  mailClass: z.string().nullable(),
  /** P58/P60: the project's address the client wrote to and its `## Brands` row, as the hub's writer resolved them; null when unknown. */
  wroteTo: z.string().nullable().default(null),
  brand: z.string().nullable().default(null),
  /** The draft's live send, if any: queued in a window, in progress, or sent by the hub. */
  /** P87: `via` (batch, manual, auto) and `doneAt` give the sent card its line "Sent 20 Nov, 20:06 · Batch". */
  sendState: z.object({ id: z.number(), status: z.enum(["queued", "sending", "sent"]), dueAt: nullableIso, via: z.enum(["batch", "manual", "auto"]).default("manual"), doneAt: nullableIso.default(null) }).nullable(),
  /** P87 (B3): how many other drafts the Hub holds for this client: the card's "Earlier drafts to this client". */
  otherDrafts: z.number().int().min(0).default(0),
  /**
   * P90: on an open draft, a Sent reply in its thread that is not the Hub's (a teammate in a shared mailbox, or the owner from
   * another device): "<by> replied at 14:02 · your draft may be out of date". Null when none, or the draft is finished.
   */
  repliedElsewhere: z.object({ at: iso, by: z.string(), messageId: z.string() }).nullable().default(null),
  /** P90: the client's Notion stamp by another person, newer than the client's last message and this Hub's last send. */
  teamSent: z.object({ at: iso, by: z.string() }).nullable().default(null),
  skipReason: z.string().nullable(),
  sentAt: nullableIso,
  createdAt: iso,
  updatedAt: iso,
  client: clientDto,
  /** The follow-up sequence this draft is a step of (P47): "Follow-up 2 of 4", and the Stop control. Null for every other draft. */
  sequence: z.object({ enrollmentId: z.number(), sequence: z.string(), step: z.number(), steps: z.number(), state: z.enum(ENROLLMENT_STATES) }).nullable(),
});
export type ReviewDraftDto = z.infer<typeof reviewDraftDto>;

const pageOf = { total: z.number(), nextOffset: z.number().nullable() };

export const draftsDto = z.object({
  drafts: z.array(reviewDraftDto),
  counts: filterCounts(CLIENT_FILTERS),
  ...pageOf,
});
export type DraftsDto = z.infer<typeof draftsDto>;

export const batchSummaryDto = z.object({
  id: z.number(),
  name: z.string(),
  intent: z.enum(BATCH_INTENTS),
  status: z.enum(BATCH_STATUSES),
  audience: z.enum(AUDIENCES),
  silentDays: z.number().nullable(),
  total: z.number(),
  brief: z.string().nullable(),
  runId: z.number().nullable(),
  createdAt: iso,
  closedAt: nullableIso,
  excluded: z.partialRecord(z.enum(EXCLUSION_REASONS), z.number()),
  counts: filterCounts(BATCH_FILTERS),
  run: z.object({ status: z.string(), finishedAt: nullableIso, tokensIn: z.number(), tokensOut: z.number(), costUsd: z.number() }).nullable(),
  /** P128 X4: when its last draft was sent or done; the View menu drops the batch 7 days later when nothing in it is open. */
  lastClosedAt: nullableIso,
});
export type BatchSummaryDto = z.infer<typeof batchSummaryDto>;
export const batchesDto = z.object({ batches: z.array(batchSummaryDto) });
/** P87: the reply of "Understood all warnings" of a batch: how many drafts and amber results it acknowledged. */
export const warningsAckedDto = z.object({ ok: z.literal(true), drafts: z.number().int().min(0), results: z.number().int().min(0) });
export type WarningsAckedDto = z.infer<typeof warningsAckedDto>;
export const batchDto = z.object({ batch: batchSummaryDto, drafts: z.array(reviewDraftDto), ...pageOf });
export type BatchDto = z.infer<typeof batchDto>;

export const eventDto = z.object({
  id: z.number(),
  runId: z.number(),
  seq: z.number(),
  at: iso,
  kind: z.enum(EVENT_KINDS),
  tool: z.string().nullable(),
  summary: z.string(),
  detail: z.string().nullable(),
  clientId: z.number().nullable(),
  clientName: z.string().nullable(),
});
export type EventDto = z.infer<typeof eventDto>;

/** What the agent and the owner did for one client: a timeline that needs no mail login. */
export const timelineDto = z.object({ events: z.array(eventDto) });

/**
 * A client's messages the hub holds: stored messenger rows (Telegram when P8 is live), newest first. Mail is not read by
 * the hub (decision 0026): the card offers "Open the client's mail" (More menu) for the full mail thread, and the agent's recorded
 * decisions are the timeline beside it.
 */
const direction = z.enum(["in", "out"]);
export const historyItemDto = z.object({ source: z.literal("messenger"), key: z.string(), at: iso, direction, channel: z.string(), chatId: z.string(), kind: z.string(), text: z.string() });
export type HistoryItemDto = z.infer<typeof historyItemDto>;
export const historyDto = z.object({ items: z.array(historyItemDto), nextCursor: z.string().optional() });
export type HistoryDto = z.infer<typeof historyDto>;

export const okDto = z.object({ ok: z.literal(true) });
export const draftChangedDto = z.object({ ok: z.literal(true), draftId: z.number() });

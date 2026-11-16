import { z } from "zod";
import {
  AUDIENCES,
  BATCH_FILTERS,
  BATCH_INTENTS,
  BATCH_STATUSES,
  CLIENT_FILTERS,
  DRAFT_STATUSES,
  EVENT_KINDS,
  EVIDENCE_LEVELS,
  EVIDENCE_SOURCES,
  EXCLUSION_REASONS,
  INBOX_ACTIONS,
  INBOX_FILTERS,
  MARKS,
  NOTION_KINDS,
  RUN_STATUSES,
  SAFETY_KINDS,
  TONES,
} from "@hub/config";

// What the API answers, once. The server parses its own reply with these (so a column added to a table never leaks
// to the browser), and the admin parses what arrives (so a stale server fails with a sentence, not a render crash).

const iso = z.string();
const nullableIso = z.string().nullable();
const filterCounts = <K extends readonly [string, ...string[]]>(keys: K) => z.record(z.enum(keys), z.number());

export const projectsDto = z.object({ projects: z.array(z.string()) });

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

/** What a recorded draft was based on (P28): the evidence block `hub record-draft` judged and stored. No reply text, only short excerpts of the incoming thread. */
export const basedOnDto = z.object({
  level: z.enum(EVIDENCE_LEVELS),
  source: z.enum(EVIDENCE_SOURCES).nullable(),
  findings: z.array(z.object({ code: z.string(), text: z.string(), amber: z.boolean() })),
  /** The closest other draft of the same batch, by address, when the sketches say so. */
  similarTo: z.string().nullable(),
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

/** One draft to review, the same shape for a recorded draft (Drafts) and a batch draft (Bulk). */
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
  /** Set by `hub record-draft` when the mail it answers looked like an injection: the hub never sends such a draft. */
  injectionSuspected: z.boolean(),
  /** What the draft was based on; null on a draft with no evidence block (older rows, batch drafts). */
  basedOn: basedOnDto.nullable(),
  /** The mail class the agent recorded (client, partner, ...); autosend admits only listed classes. */
  mailClass: z.string().nullable(),
  /** The draft's live send, if any: queued in a window, in progress, or sent by the hub. */
  sendState: z.object({ id: z.number(), status: z.enum(["queued", "sending", "sent"]), dueAt: nullableIso }).nullable(),
  skipReason: z.string().nullable(),
  sentAt: nullableIso,
  createdAt: iso,
  updatedAt: iso,
  client: clientDto,
});
export type ReviewDraftDto = z.infer<typeof reviewDraftDto>;

/** One client the agent touched in a triage (`hub record-client` / `record-draft`). No mail text: the body is read from Mail on demand. */
export const inboxRowDto = z.object({
  id: z.number(),
  email: z.string(),
  name: z.string(),
  subject: z.string().nullable(),
  mailRef: z.string().nullable(),
  lastInboundAt: nullableIso,
  mailClass: z.string().nullable(),
  action: z.enum(INBOX_ACTIONS),
  reason: z.string().nullable(),
  /** The reply is still owed: the agent left it to the owner and no open draft exists. */
  owed: z.boolean(),
  openDraftId: z.number().nullable(),
  notionKind: z.enum(NOTION_KINDS).nullable(),
  notionPageId: z.string().nullable(),
  notionUrl: z.string().nullable(),
  skill: z.string().nullable(),
  firstSeenAt: iso,
  recordedAt: iso,
});
export type InboxRowDto = z.infer<typeof inboxRowDto>;
export const inboxDto = z.object({
  rows: z.array(inboxRowDto),
  counts: filterCounts(INBOX_FILTERS),
  /** When the agent last recorded a client; null = no triage was ever recorded for the project. */
  lastTriageAt: nullableIso,
  total: z.number(),
});
export type InboxDto = z.infer<typeof inboxDto>;

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
});
export type BatchSummaryDto = z.infer<typeof batchSummaryDto>;
export const batchesDto = z.object({ batches: z.array(batchSummaryDto) });
export const batchDto = z.object({ batch: batchSummaryDto, drafts: z.array(reviewDraftDto), ...pageOf });
export type BatchDto = z.infer<typeof batchDto>;

export const audienceDto = z.object({
  counts: filterCounts(AUDIENCES),
  eligible: z.number(),
  clients: z.array(clientDto.extend({ reason: z.enum(EXCLUSION_REASONS).nullable() })),
});
export type AudienceDto = z.infer<typeof audienceDto>;

export const safetyRuleDto = z.object({
  kind: z.enum(SAFETY_KINDS),
  enabled: z.boolean(),
  level: z.enum(["amber", "red"]),
  params: z.object({ words: z.array(z.string()).optional(), days: z.number().optional() }),
});
export type SafetyRuleDto = z.infer<typeof safetyRuleDto>;
export const safetyRulesDto = z.object({ rules: z.array(safetyRuleDto) });
export const safetyRuleSavedDto = z.object({ rule: safetyRuleDto });
export type SafetyRulesDto = z.infer<typeof safetyRulesDto>;

export const runDto = z.object({
  id: z.number(),
  startedAt: iso,
  finishedAt: nullableIso,
  trigger: z.string(),
  skill: z.string().nullable(),
  model: z.string().nullable(),
  status: z.enum(RUN_STATUSES),
  tokensIn: z.number(),
  tokensOut: z.number(),
  costUsd: z.number(),
  eventCount: z.number(),
});
export type RunDto = z.infer<typeof runDto>;
export const runsDto = z.object({ runs: z.array(runDto) });

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
export const eventsDto = z.object({ events: z.array(eventDto) });

/** What the agent and the owner did for one client: a timeline that needs no mail login. */
export const timelineDto = z.object({ events: z.array(eventDto) });

/** A client's thread: mail read live (header level) merged with stored messenger rows, newest first. */
const direction = z.enum(["in", "out"]);
const mailItem = z.object({
  source: z.literal("mail"),
  key: z.string(),
  at: iso,
  direction,
  entry: z.object({ id: z.string(), date: iso, direction, from: z.string(), to: z.array(z.string()), cc: z.array(z.string()), subject: z.string(), attachmentCount: z.number() }),
});
const messengerItem = z.object({ source: z.literal("messenger"), key: z.string(), at: iso, direction, channel: z.string(), chatId: z.string(), kind: z.string(), text: z.string() });
export const historyItemDto = z.discriminatedUnion("source", [mailItem, messengerItem]);
export type HistoryItemDto = z.infer<typeof historyItemDto>;
export const historyDto = z.object({
  items: z.array(historyItemDto),
  nextCursor: z.string().optional(),
  /** Addresses whose mail could not be read; the rest of the thread is still returned. */
  mailUnavailable: z.array(z.object({ address: z.string(), code: z.string() })),
});
export type HistoryDto = z.infer<typeof historyDto>;

export const okDto = z.object({ ok: z.literal(true) });
export const draftChangedDto = z.object({ ok: z.literal(true), draftId: z.number() });
export const batchCreatedDto = z.object({ batchId: z.number(), excluded: z.partialRecord(z.enum(EXCLUSION_REASONS), z.number()) });

// The Project screen: what the files of one project folder say, in numbers. Each section is read on its own, so one
// broken file shows as that section's error and never blanks the screen.
const section = <T extends z.ZodRawShape>(shape: T) =>
  z.discriminatedUnion("state", [z.object({ state: z.literal("absent") }), z.object({ state: z.literal("error"), message: z.string() }), z.object({ state: z.literal("ok"), ...shape })]);

export const projectOverviewDto = z.object({
  project: z.object({ slug: z.string(), name: z.string(), status: z.string(), kind: z.string(), archived: z.boolean(), syncedAt: z.string() }).nullable(),
  question: z.object({ question: z.string(), options: z.array(z.string()) }).nullable(),
  knowledge: section({
    indexed: z.number(),
    approved: z.number(),
    unapproved: z.number(),
    expired: z.number(),
    noAudiences: z.number(),
    noPhrasings: z.number(),
    problems: z.number(),
    consistent: z.boolean(),
    examples: z.array(z.string()),
  }),
  filters: section({ rules: z.number(), whitelist: z.number(), issues: z.array(z.string()) }),
});
export type ProjectOverviewDto = z.infer<typeof projectOverviewDto>;

// Sending. One row of the audit (`send_log`) as the Project screen shows it; the text is the full text that went out.
export const sendRowDto = z.object({
  id: z.number(),
  draftId: z.number().nullable(),
  mode: z.enum(["manual", "auto"]),
  status: z.enum(["queued", "sending", "sent", "failed", "cancelled"]),
  actor: z.string(),
  createdAt: iso,
  dueAt: nullableIso,
  doneAt: nullableIso,
  toAddr: z.string(),
  ccAddr: z.string().nullable(),
  subject: z.string(),
  body: z.string(),
  error: z.string().nullable(),
});
export type SendRowDto = z.infer<typeof sendRowDto>;
/** `stopped` lists the scopes with Stop all on: `*` (every project) and/or project slugs. */
export const sendsDto = z.object({ sends: z.array(sendRowDto), stopped: z.array(z.string()) });
export type SendsDto = z.infer<typeof sendsDto>;
/** The dry run: exactly what Mail would send, for the confirm panel. */
export const sendPreviewDto = z.object({ ok: z.literal(true), dryRun: z.literal(true), from: z.string().nullable(), to: z.array(z.string()), cc: z.array(z.string()), subject: z.string(), body: z.string() });
export type SendPreviewDto = z.infer<typeof sendPreviewDto>;
/**
 * The Mail draft as it is right now, read on demand by its Message-ID and never stored (decision 0013, P27 M2). `hash` is
 * what Checked binds to; `safetyResults` are the checks run on this live text, so the card shows what would really go out.
 */
export const draftMailDto = z.object({
  /** False when this server has no Mailer (Mail-only mode): nothing can be read, and that is not a fault of the draft. */
  configured: z.boolean(),
  found: z.boolean(),
  /** Why the text could not be read (not found, Mail closed, ambiguous). Null when found. */
  reason: z.string().nullable(),
  from: z.string().nullable(),
  to: z.array(z.string()),
  cc: z.array(z.string()),
  subject: z.string(),
  body: z.string(),
  hash: z.string().nullable(),
  safetyResults: z.array(safetyResultDto),
  readAt: z.string(),
});
export type DraftMailDto = z.infer<typeof draftMailDto>;
/**
 * The last messages of the conversation of a draft, read from Mail on demand and never stored (decision 0013, `Mailer.thread`).
 * `read` is false when Mail could not be read or the server has no Mailer; the card then falls back to the stored excerpts
 * and says so. `at` is Mail's local time. At most five, newest first; `last` marks the newest.
 */
export const draftThreadDto = z.object({
  configured: z.boolean(),
  read: z.boolean(),
  reason: z.string().nullable(),
  messages: z.array(z.object({ at: z.string(), who: z.string(), direction: z.enum(["in", "out"]), subject: z.string(), excerpt: z.string(), last: z.boolean() })).max(5),
  readAt: z.string(),
});
export type DraftThreadDto = z.infer<typeof draftThreadDto>;
export const sentDto = z.object({ ok: z.literal(true), sendId: z.number() });
export const sendCancelledDto = z.object({ ok: z.literal(true), sendId: z.number() });
export const stopDto = z.object({ ok: z.literal(true), cancelled: z.number(), stopped: z.array(z.string()) });

// The project doctor (`hub project doctor`) as the Project screen's health view. Checks that need Mail or Notion are
// not run by the server and show as skipped.
export const doctorCheckDto = z.object({ name: z.string(), outcome: z.enum(["pass", "fail", "skipped"]), detail: z.string() });
/** What the Drafts health strip shows about the project: the status, the Mail accounts, and who a draft may go to (`draft.recipients`). */
export const doctorFactsDto = z.object({ status: z.string(), accounts: z.array(z.string()), recipients: z.enum(["test", "any", "list"]) });
export const doctorDto = z.object({ state: z.enum(["ok", "absent"]), checks: z.array(doctorCheckDto), facts: doctorFactsDto.nullable() });
export type DoctorDto = z.infer<typeof doctorDto>;

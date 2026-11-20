import { z } from "zod";
import {
  ADVISOR_MODELS,
  AGENT_MODELS,
  AUDIENCES,
  BATCH_FILTERS,
  BATCH_INTENTS,
  BATCH_STATUSES,
  CLIENT_FILTERS,
  DRAFT_STATUSES,
  ENROLLMENT_STATES,
  EVENT_KINDS,
  EVIDENCE_LEVELS,
  EVIDENCE_SOURCES,
  EXCLUSION_REASONS,
  INBOX_ACTIONS,
  INBOX_FILTERS,
  INBOX_KINDS,
  MARKS,
  NOTION_KINDS,
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
  /** P58/P60: the project's address the client wrote to and its `## Brands` row, as the hub's writer resolved them; null when unknown. */
  wroteTo: z.string().nullable().default(null),
  brand: z.string().nullable().default(null),
  /** The draft's live send, if any: queued in a window, in progress, or sent by the hub. */
  sendState: z.object({ id: z.number(), status: z.enum(["queued", "sending", "sent"]), dueAt: nullableIso }).nullable(),
  skipReason: z.string().nullable(),
  sentAt: nullableIso,
  createdAt: iso,
  updatedAt: iso,
  client: clientDto,
  /** The follow-up sequence this draft is a step of (P47): "Follow-up 2 of 4", and the Stop control. Null for every other draft. */
  sequence: z.object({ enrollmentId: z.number(), sequence: z.string(), step: z.number(), steps: z.number(), state: z.enum(ENROLLMENT_STATES) }).nullable(),
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
  kind: z.enum(INBOX_KINDS).nullable(),
  phone: z.string().nullable(),
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
/** The clients not answered by email (P27 M6): read-only, grouped by why. */
export const notByEmailDto = z.object({ rows: z.array(inboxRowDto), counts: z.object({ call: z.number(), no_action: z.number(), crossed_off: z.number(), unknown_sender: z.number() }), total: z.number() });
export type NotByEmailDto = z.infer<typeof notByEmailDto>;

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

/** P55: the project's agent settings, Claude Code only (`advisorModel` is kept while the advisor is off). */
export const agentSettingsDto = z.object({ agent: z.object({ model: z.enum(AGENT_MODELS), advisor: z.boolean(), advisorModel: z.enum(ADVISOR_MODELS) }).strict() });
export type AgentSettingsDto = z.infer<typeof agentSettingsDto>;

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
  /** Why the text could not be read (not found, Mail closed). Null when found. */
  reason: z.string().nullable(),
  /**
   * Found, but Mail holds more than one version (P53): which one is shown and what to delete. Such a read has no `hash`,
   * so it cannot be Checked and the send refuses it. Optional for a server older than API 10.
   */
  note: z.string().nullable().optional(),
  /** Found, and other drafts with this subject exist that the hub did not write for this thread (P56): named, never touched, never sent. Optional before API 11. */
  aside: z.string().nullable().optional(),
  /**
   * Not found, and Mail answered: no draft for it at all (P56). `trashRef` is the newest copy the hub wrote for this
   * thread that is in Mail's Trash (what Restore writes again), else null. Optional before API 11.
   */
  gone: z.object({ trashRef: z.string().nullable() }).nullable().optional(),
  /** Whether Checked is bound to this very text (the row's hash equals this read's); false after any revision. Optional before API 11. */
  checkedCurrent: z.boolean().optional(),
  /** The From header the client will see: Mail's own read of the draft (P58). */
  from: z.string().nullable(),
  /** P58 R1: the Mail draft's own Message-ID, bare (what Open draft in Mail links to); null when Mail gave none. Optional before API 22. */
  messageId: z.string().nullable().optional(),
  to: z.array(z.string()),
  cc: z.array(z.string()),
  subject: z.string(),
  body: z.string(),
  hash: z.string().nullable(),
  safetyResults: z.array(safetyResultDto),
  readAt: z.string(),
});
export type DraftMailDto = z.infer<typeof draftMailDto>;

export const sentDto = z.object({ ok: z.literal(true), sendId: z.number() });
/** A single-use ticket for one apply (P49 S12): minted only for the admin's exact origin, valid for seconds. */
export const sendTicketDto = z.object({ ticket: z.string(), expiresAt: z.string() });
export const sendCancelledDto = z.object({ ok: z.literal(true), sendId: z.number() });
export const stopDto = z.object({ ok: z.literal(true), cancelled: z.number(), stopped: z.array(z.string()) });

// The project doctor (`hub project doctor`) as the Project screen's health view. Checks that need Mail or Notion are
// not run by the server and show as skipped.
export const doctorCheckDto = z.object({ name: z.string(), outcome: z.enum(["pass", "warn", "fail", "skipped"]), detail: z.string() });
/**
 * What Settings ▸ Sending and Overview's setup part show about the project: the status, the Mail accounts, who a draft may go to
 * (`draft.recipients`; a list is said as its size, never its addresses: decision 0013) and autosend (P70: `send.mode`, the classes
 * it may send, the daily cap). The last two are the send policy (P49 S11), changed only by `hub send policy set` in a person's shell.
 */
export const doctorFactsDto = z.object({
  status: z.string(),
  accounts: z.array(z.string()),
  recipients: z.enum(["test", "any", "list"]),
  listed: z.number().int(),
  autosend: z.object({ mode: z.string(), classes: z.array(z.string()), dailyCap: z.number().int() }),
});
export const doctorDto = z.object({ state: z.enum(["ok", "absent"]), checks: z.array(doctorCheckDto), facts: doctorFactsDto.nullable() });
export type DoctorDto = z.infer<typeof doctorDto>;

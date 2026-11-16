import { z } from "zod";
import { healthDto } from "./health";

/**
 * The Overview (P31): one picture of every project. Three source classes, said on every number: local (SQLite and the
 * project folders, read in the request, always fresh), live (Mail or Notion, read only on a Refresh, kept in server
 * memory with the time it was read) and agent (what a triage run reported). The page never shows a live number without
 * its `asOf`. No schema here has a field for a client name, address, subject, body, deal value or Notion property
 * (decision 0013, `@docs/core/06`): `strictObject` makes a stray field a parse failure on the server.
 */

/** A live number is `fresh` for this long after it was read, then `stale` (still shown, labelled). Minutes. */
export const FRESH_MINUTES = { mail: 15, notion: 60 } as const;
/** Two Refresh calls for one project and source closer than this share the earlier read. Seconds. */
export const MIN_REFRESH_SECONDS = 30;

export const LIVE_SOURCES = ["mail", "notion"] as const;
export type LiveSource = (typeof LIVE_SOURCES)[number];

/** Why a read failed, in terms of what to fix. The provider's own text is never carried. */
export const READ_ERROR_CODES = ["token-missing", "token-rejected", "not-shared", "login-refused", "timeout", "unreachable", "failed"] as const;
export type ReadErrorCode = (typeof READ_ERROR_CODES)[number];

const stamp = z.string();

const liveStates = <T extends z.ZodType>(value: T) =>
  [
    z.strictObject({ state: z.literal("fresh"), asOf: stamp, value }),
    z.strictObject({ state: z.literal("stale"), asOf: stamp, value }),
    z.strictObject({ state: z.literal("never") }),
    z.strictObject({ state: z.literal("refreshing"), asOf: stamp.optional(), value: value.optional() }),
    z.strictObject({ state: z.literal("error"), code: z.enum(READ_ERROR_CODES), message: z.string(), fix: z.string(), asOf: stamp.optional(), value: value.optional() }),
  ] as const;

/**
 * One live number with its state. `value` is kept with `stale`, `refreshing` and `error` (the last good number), and is
 * absent with `never`. There is no `off` here: a source that must exist (Notion) is an error with a fix line, never a quiet state.
 */
export const liveBlock = <T extends z.ZodType>(value: T) => z.discriminatedUnion("state", liveStates(value));

/** `liveBlock` plus `off`: the source has no setup here and nothing is wrong (a mailbox with no login yet, the agent's count before P26). `off` never renders as 0. */
export const readBlock = <T extends z.ZodType>(value: T) => z.discriminatedUnion("state", [...liveStates(value), z.strictObject({ state: z.literal("off"), message: z.string() })]);

export const FRESHNESS = ["fresh", "stale", "never", "refreshing", "error", "off"] as const;
export type Freshness = (typeof FRESHNESS)[number];

export const ATTENTION_KINDS = [
  "mail-off",
  "mail-error",
  "notion-token",
  "send-stopped",
  "sent-loop-error",
  "doctor-fail",
  "project-draft",
  "injection-flagged",
  "recipients-test",
  "send-failed",
  "sending-stuck",
  "notion-error",
  "owe-reply",
  "drafts-ready",
  "stale-read",
  "cap-near",
  "knowledge-expired",
  "never-triaged",
  "context-block-soon",
] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];
/** `blocker`: nothing can work or send. `needs-owner`: a person must decide. `watch`: look when convenient. */
export const SEVERITIES = ["blocker", "needs-owner", "watch"] as const;
export type Severity = (typeof SEVERITIES)[number];
/** Where an item leads. The server never writes a URL: the admin maps (focus, filter, project) to `paths.*`. */
export const ATTENTION_FOCUS = ["drafts", "project", "overview"] as const;
export const ATTENTION_FILTERS = ["ready", "hold"] as const;

export const attentionItem = z.strictObject({
  kind: z.enum(ATTENTION_KINDS),
  severity: z.enum(SEVERITIES),
  project: z.string().nullable(),
  /** The only number the admin may reword. */
  count: z.number().int().optional(),
  sentence: z.string(),
  focus: z.enum(ATTENTION_FOCUS),
  filter: z.enum(ATTENTION_FILTERS).optional(),
});
export type AttentionItem = z.infer<typeof attentionItem>;

export const VERDICT_LEVELS = ["clear", "attention", "blocked"] as const;
export const verdictDto = z.strictObject({ level: z.enum(VERDICT_LEVELS), headline: z.string() });
export type VerdictDto = z.infer<typeof verdictDto>;

/** `mayOverstate`: no filter rules exclude newsletters, or no Sent folder could be read, so the count is an upper bound. */
export const mailCount = z.strictObject({ count: z.number().int(), since: stamp, mayOverstate: z.boolean() });
/** `capped`: the data source holds at least `count` rows; counting stops at 2 000. */
export const notionCount = z.strictObject({ count: z.number().int(), capped: z.boolean() });

export const mailboxDto = z.strictObject({
  account: z.string(),
  /** The account is listed by more than one project (each shows the same read). */
  shared: z.boolean(),
  newSinceTriage: readBlock(mailCount),
});
export type MailboxDto = z.infer<typeof mailboxDto>;

export const notionSourceDto = z.strictObject({ dataSourceId: z.string(), count: liveBlock(notionCount) });
/** `null`: the project's `project.md` lists no such data source. */
export const notionDto = z.strictObject({ clients: notionSourceDto.nullable(), leads: notionSourceDto.nullable() });
export type NotionDto = z.infer<typeof notionDto>;

export const draftCountsDto = z.strictObject({ ready: z.number().int(), hold: z.number().int(), done: z.number().int(), skipped: z.number().int(), sent: z.number().int() });
export const RECIPIENT_MODES = ["test", "listed", "any"] as const;

export const projectCardDto = z.strictObject({
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  kind: z.string(),
  archived: z.boolean(),
  lastTriageAt: z.string().nullable(),
  /** Clients that wait for an answer, as of the last triage (agent-reported). `off` ("Not recorded yet") until the inbox rows of P26 exist. */
  owe: readBlock(z.number().int()),
  drafts: draftCountsDto,
  injectionHeld: z.number().int(),
  sends: z.strictObject({
    /** Sent since local midnight (`overviewDto.timeZone`): manual and auto. */
    today: z.number().int(),
    since: stamp,
    failed24h: z.number().int(),
    stuck: z.number().int(),
    stopped: z.boolean(),
    /** The cap applies to auto sends only; a manual send has none. */
    auto: z.strictObject({ mode: z.enum(["draft", "auto"]), cap: z.number().int(), used24h: z.number().int() }),
  }),
  recipients: z.enum(RECIPIENT_MODES),
  mailboxes: z.array(mailboxDto),
  notion: notionDto,
  setupQuestion: z.boolean(),
});
export type ProjectCardDto = z.infer<typeof projectCardDto>;

export const overviewDto = z.strictObject({
  serverTime: stamp,
  /** The host's IANA zone. A project's own `timezone` setting cuts its `sends.today` (see `sends.since`), so each card says where its day began. */
  timeZone: z.string(),
  dataVersion: z.number().int(),
  /** The oldest `asOf` among the live numbers shown, or null when none was read yet. */
  oldestAsOf: z.string().nullable(),
  verdict: verdictDto,
  attention: z.array(attentionItem),
  projects: z.array(projectCardDto),
  system: healthDto,
});
export type OverviewDto = z.infer<typeof overviewDto>;

export const refreshRequest = z.strictObject({ project: z.string().min(1), sources: z.array(z.enum(LIVE_SOURCES)).min(1) });
export type RefreshRequest = z.infer<typeof refreshRequest>;

/** `read`: this call read the provider. `joined`: another call was reading, this one shared it. `too-soon`: the last read was under `MIN_REFRESH_SECONDS` ago, its result is returned. */
export const REFRESH_OUTCOMES = ["read", "joined", "too-soon"] as const;
export const refreshResponse = z.strictObject({
  outcomes: z.strictObject({ mail: z.enum(REFRESH_OUTCOMES).optional(), notion: z.enum(REFRESH_OUTCOMES).optional() }),
  project: projectCardDto,
  attention: z.array(attentionItem),
  verdict: verdictDto,
  oldestAsOf: z.string().nullable(),
});
export type RefreshResponse = z.infer<typeof refreshResponse>;

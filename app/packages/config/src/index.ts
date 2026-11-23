// Shared constants and types. Browser-safe: no Node imports, no dependencies.

export const HOST = "127.0.0.1";
export const SERVER_PORT = 4317;
export const ADMIN_PORT = 5173;

/** Hostnames the API accepts (DNS-rebinding guard). Any port. */
export const ALLOWED_HOSTNAMES = ["127.0.0.1", "localhost", "[::1]"] as const;

/** Draft states. The agent never sends: `sent` is logged by a mail reader, never by the app (see SETTABLE_STATUSES). */
export const DRAFT_STATUSES = ["ready", "hold", "done", "sent", "skipped"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/**
 * The states the app, the API and the agent may write. `sent` is deliberately missing: the draft-only invariant
 * lives in this type. A route, a repository method or a skill that takes a status takes this one, so writing
 * `sent` does not compile, and the API and the repository refuse it at run time too.
 */
export const SETTABLE_STATUSES = ["ready", "hold", "done", "skipped"] as const;
export type SettableStatus = (typeof SETTABLE_STATUSES)[number];

/** Filters of the Mail list (drafts): each shows a count. `sequences`: the open drafts that are a step of a follow-up sequence (P47). */
export const CLIENT_FILTERS = ["all", "ready", "hold", "owed", "done", "sent", "skipped", "thin_basis", "sequences"] as const;
export type ClientFilter = (typeof CLIENT_FILTERS)[number];
export type ClientCounts = Record<ClientFilter, number>;

/**
 * The views of the admin's Mail list, in their menu order. P99 (verdict 3): Mail lists people, one row per client, and the views
 * shrink to Needs you (they wrote, or a draft is ready; the default), Waiting (for them) and All; Follow-ups and Not by email are
 * filters of All. Hold, Thin basis, Sent and Finished became words and chips on the row. One source for the address
 * (`apps/admin/src/routes/search.ts`).
 */
export const DRAFT_VIEWS = ["needs_you", "waiting", "all", "sequences", "not_by_email"] as const;
export type DraftView = (typeof DRAFT_VIEWS)[number];

export const FILTER_LABELS: Record<ClientFilter, string> = {
  all: "All",
  ready: "Ready",
  hold: "Hold",
  owed: "Replies owed",
  done: "Done",
  sent: "Sent",
  skipped: "Skipped",
  thin_basis: "Thin basis",
  sequences: "Follow-ups",
};

// ---- Follow-up sequences (P47, `@docs/core/23-sequences.md`). The owner enrols; the agent drafts each due step; nothing here sends.
// The code name is `sequence`; the admin says "Follow-ups". The rules over these words live in `@hub/sequences`.

/** Stored states of an enrollment. `waiting`, `due` and `draft ready` are derived, never stored (`displayStateOf` in `@hub/sequences`). */
export const ENROLLMENT_STATES = ["active", "paused", "finished"] as const;
export type EnrollmentState = (typeof ENROLLMENT_STATES)[number];
export const ENROLLMENT_STATE_LABELS: Record<EnrollmentState, string> = { active: "Active", paused: "Paused", finished: "Finished" };

/** Why an enrollment finished. `completed`: every step was sent or skipped; `stopped`: the owner (or the agent) stopped it. */
export const FINISH_REASONS = ["replied", "bounced", "opted_out", "closed", "excluded", "completed", "stopped"] as const;
export type FinishReason = (typeof FINISH_REASONS)[number];
export const FINISH_REASON_LABELS: Record<FinishReason, string> = {
  replied: "Replied",
  bounced: "Bounced",
  opted_out: "Opted out",
  closed: "Lead closed",
  excluded: "Excluded",
  completed: "All steps done",
  stopped: "Stopped",
};
/** The reasons a person or a session may give to `stop` (a finish that is not the engine's own `completed`). */
export const STOP_REASONS = ["replied", "bounced", "opted_out", "closed", "excluded", "stopped"] as const;
export type StopReason = (typeof STOP_REASONS)[number];

/** What a follow-up row shows, derived: waiting for its date, due (no draft yet), a step draft is in the queue, paused, finished. */
export const SEQUENCE_DISPLAY_STATES = ["waiting", "due", "draft_ready", "paused", "finished"] as const;
export type SequenceDisplayState = (typeof SEQUENCE_DISPLAY_STATES)[number];
export const SEQUENCE_DISPLAY_LABELS: Record<SequenceDisplayState, string> = { waiting: "Waiting", due: "Due", draft_ready: "Draft ready", paused: "Paused", finished: "Finished" };

/** The lists the API serves: due now, every open one (active or paused), the finished ones. */
export const ENROLLMENT_VIEWS = ["due", "active", "finished"] as const;
export type EnrollmentView = (typeof ENROLLMENT_VIEWS)[number];

/** The skill that drafts the due steps. A record by any OTHER skill for an enrolled client is a reply (P47 design). */
export const SEQUENCE_SKILL = "sequence-drafts";

/** P85: the skill that writes on the owner's purpose to one client or many. Its records of one run (`batchKey`) are one batch in Mail. */
export const BULK_SKILL = "bulk-drafts";

export const MARKS = ["follow_up", "do_not_contact", "vip"] as const;
export type Mark = (typeof MARKS)[number];
export const MARK_LABELS: Record<Mark, string> = {
  follow_up: "Follow up",
  do_not_contact: "Do not contact",
  vip: "VIP",
};

export const RUN_STATUSES = ["ok", "needs_human", "failed"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const EVENT_KINDS = [
  "thought",
  "tool_call",
  "tool_result",
  "decision",
  "draft_created",
  "notion_write",
  "needs_human",
  "error",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

// ---- Inbox (P26). A client the agent touched in a triage, drafted or not. Nothing here sends.

/** What the agent did with a client's mail: wrote a draft, decided no reply is needed, left it to the owner, or refused to act on it. */
export const INBOX_ACTIONS = ["drafted", "skipped", "escalated", "injection_suspected"] as const;
export type InboxAction = (typeof INBOX_ACTIONS)[number];
export const INBOX_ACTION_LABELS: Record<InboxAction, string> = {
  drafted: "Draft made",
  skipped: "No reply needed",
  escalated: "Left to you",
  injection_suspected: "Suspicious mail",
};

/** Views of the inbox queue: `owed` is a reply owed with no open draft, `new` is first seen in the latest triage. */
export const INBOX_FILTERS = ["owed", "new", "all"] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];
export type InboxCounts = Record<InboxFilter, number>;
export const INBOX_FILTER_LABELS: Record<InboxFilter, string> = { owed: "Owed a reply", new: "New in the last triage", all: "All" };

/**
 * A client who is not answered by email, and why (P27 M6): the agent recorded a phone call to make, a mail that needs nothing,
 * a client the owner crossed off, or a sender it could not place. A row with a kind is shown in "Not by email", never in the
 * reply queue, and nothing here sends.
 */
export const INBOX_KINDS = ["call", "no_action", "crossed_off", "unknown_sender"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];
export const INBOX_KIND_LABELS: Record<InboxKind, string> = { call: "Call", no_action: "No reply needed", crossed_off: "Crossed off", unknown_sender: "Unknown sender" };
/** The words that put a client in each group, shown when it is empty so the owner knows what fills it. */
export const INBOX_KIND_HINTS: Record<InboxKind, string> = {
  call: "Say \"call him\" or \"he wants a call\" to the agent and the client is listed here with a phone number if there is one.",
  no_action: "A mail that needs no answer, such as a receipt or a thank-you, is listed here.",
  crossed_off: "A client you tell the agent to leave alone is listed here.",
  unknown_sender: "A sender the agent could not match to a client or a lead is listed here.",
};
export type InboxKindCounts = Record<InboxKind, number>;

/** Triage runs closer together than this belong to one triage (one `hub agent` session records many clients). */
export const TRIAGE_GAP_MINUTES = 30;

/** Where the client's Notion page is: the `clients` data source, the `leads` one, or nowhere (a gap to report). */
export const NOTION_KINDS = ["client", "lead", "none"] as const;
export type NotionKind = (typeof NOTION_KINDS)[number];
export const NOTION_KIND_LABELS: Record<NotionKind, string> = { client: "Client", lead: "Lead", none: "No profile" };

/** What a session reports of the client's Notion page: which source it came from and where it is. `none` carries neither id nor url. */
export type NotionRef = { kind: NotionKind; pageId?: string | null; url?: string | null };

// ---- Bulk send (P9, doc 14). A batch is a set of drafts made from one audience and one intent. Nothing here sends.

export const TONES = ["short", "standard", "warm"] as const;
export type Tone = (typeof TONES)[number];
export type ToneBodies = Partial<Record<Tone, string>>;

/** Who a batch is for. Each is a chip with a count. `agent` (P85): a `bulk-drafts` run, whose clients the agent chose from the owner's words. */
export const AUDIENCES = ["all", "owed", "silent", "follow_up", "vip", "agent"] as const;
export type Audience = (typeof AUDIENCES)[number];
export type AudienceCounts = Record<Audience, number>;
export const AUDIENCE_LABELS: Record<Audience, string> = {
  all: "All clients",
  owed: "Replies owed",
  silent: "Silent",
  follow_up: "Follow up",
  vip: "VIP",
  agent: "Chosen by the agent",
};
export const DEFAULT_SILENT_DAYS = 14;

export const BATCH_INTENTS = ["follow_up", "notice", "custom"] as const;
export type BatchIntent = (typeof BATCH_INTENTS)[number];
export const INTENT_LABELS: Record<BatchIntent, string> = {
  follow_up: "Follow-up to silent clients",
  notice: "Notice to a segment",
  custom: "Other",
};

/** `queued`: waiting for the agent's drafts. `ready`: the drafts exist. `failed`: the agent stopped early. */
export const BATCH_STATUSES = ["queued", "ready", "failed"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

/** Why a client was left out of a batch. */
export const EXCLUSION_REASONS = ["do_not_contact", "open_draft", "not_in_project"] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];
export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  do_not_contact: "Marked do not contact",
  open_draft: "Already has an open draft",
  not_in_project: "Not in this project",
};

/** Filters of a batch's review list; each shows a count. */
export const BATCH_FILTERS = ["all", "review", "checked", "hold", "done", "skipped"] as const;
export type BatchFilter = (typeof BATCH_FILTERS)[number];
export type BatchFilterCounts = Record<BatchFilter, number>;
export const BATCH_FILTER_LABELS: Record<BatchFilter, string> = {
  all: "All",
  review: "To review",
  checked: "Checked",
  hold: "Hold",
  done: "Done",
  skipped: "Skipped",
};

// ---- Safety rules: data, not prose. A rule that fires blocks Checked until the person acknowledges it.

export const SAFETY_KINDS = [
  "do_not_contact",
  "unresolved_marker",
  "cc_present",
  "unknown_recipients",
  "risky_word",
  "wrong_thread",
  "already_sent_recently",
  // What the draft was based on (P28): judged from the evidence block `hub record-draft` stored, never from the body.
  "no_thread_read",
  "no_profile_read",
  "near_duplicate",
  "template_echo",
  "profile_empty",
  "profile_stale",
  "claim_exceeds_observation",
  "evidence_claimed",
  "fact_without_source",
  // P60: a knowledge entry the draft used belongs to another brand of the project (knowledge.scope by-brand).
  "fact_other_brand",
  "evidence_weak",
  // P65 S2 (P60 finding 2): the project has no sign-off or signature line in the reply's language; the writer signed in English.
  "signature_language",
] as const;
export type SafetyKind = (typeof SAFETY_KINDS)[number];
export type SafetyLevel = "amber" | "red";
export type SafetyParams = { words?: string[]; days?: number };
export type SafetyRule = { kind: SafetyKind; enabled: boolean; level: SafetyLevel; params: SafetyParams };
export type SafetyResult = { kind: SafetyKind; level: SafetyLevel; text: string; acked: boolean };

export const SAFETY_LABELS: Record<SafetyKind, string> = {
  do_not_contact: "Do not contact",
  unresolved_marker: "Unresolved placeholder",
  cc_present: "Cc on the draft",
  unknown_recipients: "Unknown recipients",
  risky_word: "Risky words",
  wrong_thread: "Wrong thread",
  already_sent_recently: "Already written to recently",
  no_thread_read: "Thread not read",
  no_profile_read: "Profile not read",
  near_duplicate: "Near-duplicate of another draft",
  template_echo: "Similar to another draft",
  profile_empty: "Notion profile is empty",
  profile_stale: "Profile may be out of date",
  claim_exceeds_observation: "Claims more than the session did",
  evidence_claimed: "Reads are the agent's own count",
  fact_without_source: "Figure without a knowledge entry",
  fact_other_brand: "Fact of another brand",
  evidence_weak: "Thin evidence",
  signature_language: "Signature not in the reply's language",
};

/** How well a recorded draft's own evidence block holds up (`hub record-draft`, rules V1 to V5). Null on a draft with no block (older rows, batch drafts). */
export const EVIDENCE_LEVELS = ["ok", "weak", "missing"] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];
/** `observed`: the hook ledger confirmed the counts; `claimed`: only the agent said so. */
export const EVIDENCE_SOURCES = ["observed", "claimed"] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];
/** One finding of the evidence check, as `hub record-draft` reported it. */
export type EvidenceFinding = { code: string; text: string; amber: boolean };

/** Which safety kind a finding code belongs to. Codes no kind names land on `evidence_weak`. */
export const FINDING_KIND: Record<string, SafetyKind> = {
  "context-missing": "no_thread_read",
  "no-thread-read": "no_thread_read",
  "first-contact-claim": "no_thread_read",
  "no-profile-read": "no_profile_read",
  "near-duplicate": "near_duplicate",
  "anchor-duplicate": "near_duplicate",
  "personalization-duplicate": "near_duplicate",
  "similar-to-another": "template_echo",
  "profile-stale": "profile_stale",
  "claim-exceeds-observation": "claim_exceeds_observation",
  "fact-without-source": "fact_without_source",
  "fact-other-brand": "fact_other_brand",
};

/** The owner edits these per project (the `safety_rules` table); a project with no row uses the default. */
export const DEFAULT_SAFETY_RULES: readonly SafetyRule[] = [
  { kind: "do_not_contact", enabled: true, level: "red", params: {} },
  { kind: "unresolved_marker", enabled: true, level: "red", params: {} },
  { kind: "cc_present", enabled: true, level: "amber", params: {} },
  { kind: "unknown_recipients", enabled: true, level: "amber", params: {} },
  { kind: "risky_word", enabled: true, level: "amber", params: { words: ["commission", "discount", "guarantee", "price list", "pricing sheet", "HOA"] } },
  { kind: "wrong_thread", enabled: true, level: "amber", params: {} },
  { kind: "already_sent_recently", enabled: true, level: "amber", params: { days: 7 } },
  { kind: "no_thread_read", enabled: true, level: "red", params: {} },
  { kind: "no_profile_read", enabled: true, level: "red", params: {} },
  { kind: "near_duplicate", enabled: true, level: "red", params: {} },
  { kind: "template_echo", enabled: true, level: "amber", params: {} },
  { kind: "profile_empty", enabled: true, level: "amber", params: {} },
  { kind: "profile_stale", enabled: true, level: "amber", params: {} },
  { kind: "claim_exceeds_observation", enabled: true, level: "amber", params: {} },
  { kind: "evidence_claimed", enabled: true, level: "amber", params: {} },
  { kind: "fact_without_source", enabled: true, level: "amber", params: {} },
  { kind: "fact_other_brand", enabled: true, level: "red", params: {} },
  { kind: "evidence_weak", enabled: true, level: "amber", params: {} },
  { kind: "signature_language", enabled: true, level: "amber", params: {} },
];

// ---- The agent's model and its advisor, per project (P55). Claude Code only: Codex keeps its own default and has no advisor.

/** The main model of a hub Claude session: the CLI's aliases for the newest of each. */
export const AGENT_MODELS = ["sonnet", "opus"] as const;
export type AgentModel = (typeof AGENT_MODELS)[number];
/** The advisor's model; it must be at least as capable as the main model (Claude Code skips it otherwise), which both are. */
export const ADVISOR_MODELS = ["fable", "opus"] as const;
export type AdvisorModel = (typeof ADVISOR_MODELS)[number];
export const MODEL_LABELS: Record<AgentModel | AdvisorModel, string> = { sonnet: "Sonnet", opus: "Opus", fable: "Fable" };

/** `advisorModel` is kept while the advisor is off, so switching it back on restores the last choice. */
export type AgentSettings = { model: AgentModel; advisor: boolean; advisorModel: AdvisorModel };
/** The owner edits these per project (the `agent_settings` table); a project with no row uses the default. */
export const DEFAULT_AGENT_SETTINGS: Readonly<AgentSettings> = { model: "sonnet", advisor: false, advisorModel: "fable" };

// ---- Placeholders: no batch renders one text for many clients (P28 C5); the agent writes each draft from the owner's brief.

/** The placeholders left in a text (`{first_name}`, `{{x}}`, `[Owner: price]`): what `unresolved_marker` flags. */
export function unresolvedMarkers(text: string): string[] {
  return text.match(/\{\{[^}]*\}\}|\{[a-z][a-z0-9_]*\}|\[[A-Z][\w ]*:[^\]]*\]/g) ?? [];
}

/**
 * P68: how worth it a newer core is for this instance (`@hub/config/core-version` judges, `@hub/contract/instance` carries it).
 * `unknown`: not checked, or the pin moved since; `follows`: the instance follows a branch, which has no level.
 */
export const CORE_LEVELS = ["unknown", "current", "available", "recommended", "required", "follows"] as const;
export type CoreLevel = (typeof CORE_LEVELS)[number];

// ---- Send all Checked of a batch (P85b, decision 0011 amendment of 2026-11-20 point 4).

/**
 * The guards of one batch send, its own and stricter than one click: at most this many batch mails per project in a rolling 24
 * hours (the dry run lists the rest as held), and this many seconds between two mails of the run (so 30 drafts take about ten
 * minutes, run by the server, with progress and a Stop). A manual Send of one draft and autosend keep their own rules.
 */
export const BATCH_SEND_DAILY_CAP = 50;
export const BATCH_SEND_SPACING_SECONDS = 20;
/** The `send_log.actor` of a batch send: what its daily cap counts. One click mints it once per run. */
export const BATCH_SEND_ACTOR = "admin-batch";
/**
 * Decision 0046 (P132 B1): the `send_log.actor` of a messenger draft the agent sent on the owner's word in an attended
 * session (`messenger_send`, through the same door as the owner's Send). Activity calls it "Agent (your word)".
 */
export const AGENT_WORD_SEND_ACTOR = "agent_on_owner_word";
/** Its label in Activity, beside "By hand" and "Batch". */
export const AGENT_WORD_SEND_LABEL = "Agent (your word)";
/** How old an owner's word may be when the agent sends on it (P129 verdict 7's window). */
export const OWNER_WORD_MAX_AGE_HOURS = 12;

/**
 * P85b: a brand-new thread (a first message to a client with no thread at all) answers no message, so its draft has no
 * `mailRef`; its Mail versions and write records (`mail_versions.mail_ref`, `mail_writes.mail_ref`) are keyed by this, one per client.
 */
export const newThreadKey = (email: string): string => `new:${email.trim().toLowerCase()}`;
export const isNewThreadKey = (ref: string | null | undefined): boolean => !!ref && ref.startsWith("new:");

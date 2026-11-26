// The daily lead pass (decision 0055, P147): its vocabulary, its numbers and the brain's port, once here so the database, the
// server's pass, the agent's tools and brain, the contract and the admin read the same values. Browser-safe: no node imports.
// The decision is the agent's notes (verdicts 1 and 3): the criteria are skill text, never code; only the mechanical limits of
// verdict 13 and the bindings of D2 and D5 are numbers or checks.

/** What one turn decides for one lead (verdict 1). */
export const LEAD_PASS_DECISIONS = ["reply", "client", "spam", "not_now", "hand_over"] as const;
export type LeadPassDecision = (typeof LEAD_PASS_DECISIONS)[number];
/** The two decisions that come with a draft (verdict 2): its draft waits in the day's lead batch. */
export const LEAD_PASS_DRAFTED: readonly LeadPassDecision[] = ["reply", "client"];
/** The two proposals the owner's batch click applies (decision 0055 point 4); the agent never sets them. */
export const LEAD_PASS_PROPOSED: readonly LeadPassDecision[] = ["spam", "not_now"];

export const LEAD_PASS_DECISION_LABELS: Record<LeadPassDecision, string> = { reply: "Reply", client: "Client", spam: "Spam proposed", not_now: "Not now proposed", hand_over: "For you" };

/**
 * What the admin shows for a lead (verdict 2, D7), derived and never stored: `new` open with no decision; `drafted` a reply or
 * client decision whose draft is unsent; `draft_gone` that draft was deleted or skipped in Mail; `proposed` spam or not_now
 * awaiting the owner; `for_you` hand_over; `sent` converted at the send; `spam` and `not_now` the owner's click; `excluded` he
 * unticked it in the review.
 */
export const LEAD_PASS_DISPLAY = ["new", "drafted", "draft_gone", "proposed", "for_you", "excluded", "sent", "spam", "not_now"] as const;
export type LeadPassDisplay = (typeof LEAD_PASS_DISPLAY)[number];
export const LEAD_PASS_DISPLAY_LABELS: Record<LeadPassDisplay, string> = {
  new: "New",
  drafted: "Reply ready",
  draft_gone: "Prepare reply again",
  proposed: "Proposed",
  for_you: "Needs decision",
  excluded: "Review needed",
  sent: "Answered",
  spam: "Spam",
  not_now: "Not now",
};

/** The facts of one lead row the display state reads. `draftStatus`: the pass draft's status, null when the row is gone. */
export interface LeadPassFacts {
  passDecision: LeadPassDecision | null;
  /** 3i P3: a reason starting `needs your input` puts a drafted lead under For you. */
  passReason?: string | null;
  passDraftId: number | null;
  passExcludedAt: string | null;
  convertedAt: string | null;
  dismissedReason: "not_now" | "spam" | null;
  notionStatus: string | null;
  draftStatus: string | null;
}

/** 3i P3: the reason a draft with an `[Owner: …]` placeholder is recorded with. */
export const LEAD_NEEDS_INPUT = "needs your input";
export const needsInput = (reason: string | null | undefined): boolean => (reason ?? "").trim().toLowerCase().startsWith(LEAD_NEEDS_INPUT);

/** The derived display state (verdict 2). Pure: the owner's own marks first, then the pass's decision, else New. */
export function leadPassDisplay(r: LeadPassFacts): LeadPassDisplay {
  if (r.convertedAt) return "sent";
  if (r.dismissedReason === "spam" || r.notionStatus === "Spam") return "spam";
  if (r.dismissedReason === "not_now") return "not_now";
  if (!r.passDecision) return "new";
  if (r.passExcludedAt) return "excluded";
  if (r.passDecision === "hand_over") return "for_you";
  if (r.passDecision === "spam" || r.passDecision === "not_now") return "proposed";
  // A reply or client decision: its draft waits, or the owner deleted it (verdict 3: "draft gone", redone only on Redo).
  if (r.passDraftId === null) return "draft_gone";
  if (r.draftStatus === "ready" || r.draftStatus === "hold") return needsInput(r.passReason) ? "for_you" : "drafted";
  if (r.draftStatus === "sent" || r.draftStatus === "done") return "sent";
  return "draft_gone";
}

/** What started a pass (verdict 4). `dock`: an attended session wrote decisions with no runner (the skill's own pass). */
export const LEAD_PASS_TRIGGERS = ["schedule", "button", "catch_up", "dock"] as const;
export type LeadPassTrigger = (typeof LEAD_PASS_TRIGGERS)[number];

/** `project.md` Settings (verdict 14, D9): `leads.pass` and `leads.pass_at`. Off in the core; not protected (the pass sends nothing). */
export const LEAD_PASS_SCHEDULES = ["daily", "off"] as const;
export type LeadPassSchedule = (typeof LEAD_PASS_SCHEDULES)[number];
export const LEAD_PASS_DEFAULT_SCHEDULE: LeadPassSchedule = "off";
export const LEAD_PASS_DEFAULT_AT = "09:30";
export const LEAD_PASS_AT = /^([01]\d|2[0-3]):[0-5]\d$/;
/** D8: the scheduled pass waits for the day's follow-up sweep to finish, at most this long after its own time. */
export const LEAD_PASS_SWEEP_WAIT_MS = 30 * 60_000;

/** Budgets (verdict 13). */
export const LEAD_PASS_TURNS = 30;
export const LEAD_PASS_INSTANCE_TURNS_PER_DAY = 60;
export const LEAD_PASS_RUN_NOW_PER_DAY = 3;
export const LEAD_PASS_FAILURES_STOP = 3;
/** One turn: P142's model calls and wall clock. */
export const LEAD_PASS_MAX_TURNS = 12;
export const LEAD_PASS_TURN_TIMEOUT_MS = 120_000;
export const LEAD_PASS_MODEL = "sonnet";
/** The earlier requests of the same person the prefetch carries (verdict 3). */
export const LEAD_PASS_PREFETCH_EARLIER = 5;
/** `reason` (verdict 2): one sentence. */
export const LEAD_PASS_REASON_MAX = 200;

/** The core skill a turn follows (its text is the turn's system prompt), and the one a dock session starts with the phrase. */
export const LEAD_PASS_SKILL = "lead-pass";
/** The env var that binds a `hub mcp` process to the one lead of a turn (verdict 4): its normalised Notion page id (32 hex). */
export const LEAD_PAGE_ENV = "HUB_LEAD_PAGE";
/** The env var naming the turn's `lead_passes` row id, so the turn's draft and decision join the pass and its batch. */
export const LEAD_PASS_ENV = "HUB_LEAD_PASS";
/** A page id as the binding accepts it: 32 hex, dashes removed, lower case; anything else binds to no lead at all. */
export const leadPageOf = (raw: string | undefined): string | undefined => {
  const v = raw?.trim();
  if (!v) return undefined;
  const id = v.replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(id) ? id : "0".repeat(32);
};

/** The six hub tools of a turn (verdict 5, D2), each bound to the turn's lead; nothing else (no built-in, no mail-mcp, no Notion). */
/** 3e S5: `link_fetch` joins them, bound to the lead's own site domain (`leadSiteHosts`); 3g H5: `bug_report`, bound to its lead. */
export const LEAD_PASS_HUB_TOOLS = ["knowledge_search", "knowledge_get", "client_show", "message_show", "link_fetch", "draft_write", "lead_decide", "bug_report"] as const;

/** Verdict 6: the day's lead batch. One per project per day while open; a pass that drafts nothing makes none. */
export const LEAD_REPLY_INTENT = "lead_reply";
export const LEAD_BATCH_BRIEF = "Daily lead pass";
export const leadBatchName = (day: string): string => {
  const d = new Date(`${day}T00:00:00Z`);
  return `Leads ${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
/** Verdict 5: the `owner_request` a turn's `draft_write` carries, from the server (the `leadPhrase()` shape), never the model's. */
export const leadPassRequest = (day: string, pageId: string): string => `daily lead pass ${day}, Notion lead ${pageId}`;
/** Verdict 11: the reason autosend refuses a lead batch draft. */
export const LEAD_FIRST_REPLY_REASON = "lead-first-reply: the first reply to a lead is sent by your click";

/** The Hub-owned Notion properties on Leads (verdict 8; `schema/leads.json`, writer Hub; the installer step `notion.lead-pass`). */
export const LEAD_PASS_NOTION = { decision: "Hub decision", reason: "Hub reason" } as const;
export const LEAD_PASS_NOTION_DECISION: Record<LeadPassDecision, string> = { reply: "Reply", client: "Client", spam: "Spam proposed", not_now: "Not now proposed", hand_over: "For you" };

// ---- The mail pass (decision 0055 point 9, P147 3h): the same runner over the Mail reader's open rows.

/** The two kinds of pass of one runner (`lead_passes.kind`). */
export const PASS_KINDS = ["lead", "mail"] as const;
export type PassKind = (typeof PASS_KINDS)[number];
/** What one mail turn decides for one inbound thread (M2). `no_reply` covers notifications, receipts and phishing. */
export const MAIL_PASS_DECISIONS = ["reply", "client", "no_reply", "spam", "hand_over"] as const;
export type MailPassDecision = (typeof MAIL_PASS_DECISIONS)[number];
/** Any decision of either kind. */
export type PassDecision = LeadPassDecision | MailPassDecision;
/** The mail pass's proposals the owner's review click applies: Spam, and No reply needed. */
export const MAIL_PASS_PROPOSED: readonly MailPassDecision[] = ["spam", "no_reply"];
export const MAIL_PASS_DECISION_LABELS: Record<MailPassDecision, string> = { reply: "Reply", client: "Client", no_reply: "No reply proposed", spam: "Junk proposed", hand_over: "For you" };
/** The env var that binds a `hub mcp` process to the one inbound row of a mail turn (its `inbound_mail.id`). */
export const MAIL_INBOUND_ENV = "HUB_MAIL_INBOUND";
export const mailInboundOf = (raw: string | undefined): number | undefined => {
  const v = raw?.trim();
  if (!v) return undefined;
  return /^[1-9]\d{0,12}$/.test(v) ? Number(v) : 0;
};
/** The hub tools of a mail turn, each bound to the turn's inbound row; nothing else. */
export const MAIL_PASS_HUB_TOOLS = ["knowledge_search", "knowledge_get", "client_show", "message_show", "link_fetch", "draft_write", "mail_decide", "bug_report"] as const;
/** The turn's rules: the triage-mail skill's pass reference (M5: a section of triage-mail, not a new skill). */
export const MAIL_PASS_SKILL = "triage-mail";
export const MAIL_PASS_SKILL_FILE = "references/mail-pass.md";
/** `project.md` Settings (M4): `mail.pass` (off in the core), `mail.pass_at` (after the lead pass), `mail.pass_window_days`. */
export const MAIL_PASS_DEFAULT_AT = "10:00";
export const MAIL_PASS_DEFAULT_WINDOW_DAYS = 3;
/** M3: the reason autosend refuses a mail-pass draft to someone who is not a client yet. */
export const MAIL_PASS_FIRST_REPLY_REASON = "mail-pass-first-reply: a first reply from the mail pass is sent by your click";
/** The `owner_request` of a mail turn's draft, from the server. */
export const mailPassRequest = (day: string, inboundId: number): string => `daily mail pass ${day}, inbound ${inboundId}`;

/** One lead turn: the project, the lead it is bound to, its pass, the action id, and the facts the server prefetched as data. */
export interface LeadPassTurn {
  /** Absent: a lead turn. `mail`: `pageId` is the inbound row id, as a string. */
  kind?: PassKind;
  project: string;
  pageId: string;
  passId: number;
  actionId: string;
  /** The prefetched lead, checks, identity match and earlier requests (verdict 5), rendered as the prompt's data block. */
  context: string;
}

/** What a turn's own calls wrote (read from its stream, never from a row): the decision, if any. */
export type LeadPassTurnResult =
  | { kind: "decided"; decision: PassDecision; costUsd: number | null }
  | { kind: "undecided"; reason: string; costUsd: number | null }
  | { kind: "failed"; code: "mcp_not_ready" | "failed" | "timeout"; detail: string; costUsd?: number | null };

/** The model behind a lead turn: `claudeBrain`'s `lead_pass` kind, or a test's fake. It holds no send. */
export interface LeadPassBrain {
  readonly name: string;
  turn(t: LeadPassTurn, signal: { readonly aborted: boolean; addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void }): Promise<LeadPassTurnResult>;
}

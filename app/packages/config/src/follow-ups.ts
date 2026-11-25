// The daily follow-up sweep (decision 0050, P142): its vocabulary, its numbers and the brain's port, once here so the database,
// the server's sweep, the agent's tools and brain, the contract and the admin read the same values. Browser-safe: no node imports.
// The plan is the agent's notes (verdict 3): nothing here refuses a draft or a send because of a plan; only the mechanical limits
// of verdicts 8 and 19 are numbers.
import { AUTOPILOT_CHAT_ENV } from "./autopilot";
import { LEAD_PAGE_ENV } from "./lead-pass";

/** A plan's stored state (verdict 10). "Ready" (an open nudge draft) and "due" (waiting, its date passed) are derived, never stored. */
export const FOLLOW_UP_STATES = ["waiting", "stopped", "handed_over", "answered"] as const;
export type FollowUpState = (typeof FOLLOW_UP_STATES)[number];

/** What one turn decides for one client (verdict 1). */
export const FOLLOW_UP_DECISIONS = ["nudge", "wait", "stop", "hand_over"] as const;
export type FollowUpDecision = (typeof FOLLOW_UP_DECISIONS)[number];

/** Why a plan stopped (verdict 9). */
export const FOLLOW_UP_STOP_REASONS = ["no_answer", "not_interested", "lost", "done", "do_not_contact"] as const;
export type FollowUpStopReason = (typeof FOLLOW_UP_STOP_REASONS)[number];

/** Who owes the next message (verdict 9). */
export const FOLLOW_UP_WAITING_ON = ["them", "us"] as const;
export type FollowUpWaitingOn = (typeof FOLLOW_UP_WAITING_ON)[number];

/** The channel of a nudge: Mail or one of the messenger channels. */
export const FOLLOW_UP_CHANNELS = ["mail", "telegram_user", "telegram_bot", "whatsapp"] as const;
export type FollowUpChannel = (typeof FOLLOW_UP_CHANNELS)[number];

/** What started a sweep (verdict 10). */
export const FOLLOW_UP_TRIGGERS = ["schedule", "button", "catch_up"] as const;
export type FollowUpTrigger = (typeof FOLLOW_UP_TRIGGERS)[number];

export const FOLLOW_UP_DECIDED_BY = ["agent", "owner"] as const;
export type FollowUpDecidedBy = (typeof FOLLOW_UP_DECIDED_BY)[number];

/** What the admin shows for a plan: the stored state, or one of the two derived ones. */
export const FOLLOW_UP_DISPLAY = ["ready", "due", "waiting", "stopped", "handed_over", "answered"] as const;
export type FollowUpDisplay = (typeof FOLLOW_UP_DISPLAY)[number];
export const FOLLOW_UP_DISPLAY_LABELS: Record<FollowUpDisplay, string> = {
  ready: "Nudge ready",
  due: "Due",
  waiting: "Waiting",
  stopped: "Stopped",
  handed_over: "For you",
  answered: "Answered",
};

export const FOLLOW_UP_DECISION_LABELS: Record<FollowUpDecision, string> = { nudge: "nudged", wait: "waits", stop: "stopped", hand_over: "handed to you" };
export const FOLLOW_UP_STOP_LABELS: Record<FollowUpStopReason, string> = { no_answer: "no answer", not_interested: "not interested", lost: "lost", done: "done", do_not_contact: "do not contact" };
export const FOLLOW_UP_CHANNEL_LABELS: Record<FollowUpChannel, string> = { mail: "Mail", telegram_user: "Telegram", telegram_bot: "Telegram bot", whatsapp: "WhatsApp" };

/** The derived display state (verdict 10): an open nudge draft is ready; a waiting plan whose date passed is due. Pure. */
export function followUpDisplay(p: { state: FollowUpState; nextAt: string | null; nudgeReady: boolean }, now: Date): FollowUpDisplay {
  if (p.nudgeReady) return "ready";
  if (p.state === "waiting" && (!p.nextAt || p.nextAt.slice(0, 10) <= now.toISOString().slice(0, 10))) return "due";
  return p.state;
}

/** `project.md` Settings (verdict 17): `follow_ups.schedule` and `follow_ups.at`. Not protected: they only start or stop runs. */
export const FOLLOW_UP_SCHEDULES = ["daily", "off"] as const;
export type FollowUpSchedule = (typeof FOLLOW_UP_SCHEDULES)[number];
export const FOLLOW_UP_DEFAULT_AT = "09:00";
export const FOLLOW_UP_AT = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Budgets (verdict 19) and failure (verdict 20). */
export const FOLLOW_UP_SWEEP_TURNS = 30;
export const FOLLOW_UP_INSTANCE_TURNS_PER_DAY = 60;
export const FOLLOW_UP_RUN_NOW_PER_DAY = 3;
export const FOLLOW_UP_FAILURES_STOP = 3;
/** Autopilot nudges (verdict 8, decision 0050 point 6): one a chat a day, three in a row without a client message. */
export const FOLLOW_UP_NUDGES_PER_CHAT_PER_DAY = 1;
export const FOLLOW_UP_NUDGES_IN_A_ROW = 3;
/** One turn (verdict 5): its model calls and its wall clock, as autopilot's. */
export const FOLLOW_UP_MAX_TURNS = 12;
export const FOLLOW_UP_TURN_TIMEOUT_MS = 120_000;
/** The model of a turn (A0's measurement, the same as autopilot's). */
export const FOLLOW_UP_MODEL = "sonnet";
/** The messages of the client's history the server puts into the turn's prompt as data (verdict 5). */
export const FOLLOW_UP_PREFETCH_MESSAGES = 30;

/** `reason` and the profile line (verdicts 9 and 13). */
export const FOLLOW_UP_REASON_MAX = 200;
export const FOLLOW_UP_LINE_MAX = 160;

/** The core skill a turn follows (its text is the turn's system prompt) and the one a dock session starts with the phrase. */
export const FOLLOW_UP_SKILL = "follow-up-sweep";
/** The env var that binds a `hub mcp` process to the one client of a turn (verdict 5): the `clients` row id. */
export const FOLLOW_UP_CLIENT_ENV = "HUB_FOLLOWUP_CLIENT";

/**
 * Whether this process belongs to a background run the Hub started itself (an autopilot turn, a follow-up sweep turn, a lead
 * pass turn, decision 0055): the runner sets one of the three variables on the turn's `hub mcp`. The only source of "unattended" (decisions 0046, 0048, 0050):
 * every other session was started by the owner (the dock, a terminal, a resumed session) and is attended, whatever its
 * permission mode. A background run never sends on the agent's call.
 */
export const backgroundRunOf = (env: Readonly<Record<string, string | undefined>>): boolean => !!(env[AUTOPILOT_CHAT_ENV]?.trim() || env[FOLLOW_UP_CLIENT_ENV]?.trim() || env[LEAD_PAGE_ENV]?.trim());
/** The `messenger_drafts.created_by` of a sweep turn's draft, and the reason the autopilot authority carries for a nudge. */
export const FOLLOW_UP_DRAFT_AUTHOR = "follow_up";
export const FOLLOW_UP_SEND_REASON = "nudge";

/** The nine hub tools of a turn (verdict 5; P145 B3 added `bug_report`), each bound to the turn's client; nothing else (no built-in, no mail-mcp, no Notion connector). */
export const FOLLOW_UP_HUB_TOOLS = ["client_show", "client_map", "message_show", "knowledge_search", "knowledge_get", "draft_write", "messenger_draft_write", "follow_up_plan", "bug_report"] as const;

/** The Hub-owned Notion properties of verdict 12 (`schema/clients.json`, writer Hub; the installer step `notion.follow-ups`). */
export const FOLLOW_UP_NOTION = { next: "Next follow-up", status: "Follow-up status", sent: "Follow-ups sent", waitingOn: "Waiting on" } as const;
export const FOLLOW_UP_NOTION_STATUS = ["Waiting", "Nudge ready", "Stopped", "Handed over", "Answered"] as const;
export const FOLLOW_UP_NOTION_WAITING_ON = ["Them", "Us"] as const;
/** The heading the dated lines are appended under on the client's page (verdict 13): created once, never rewritten. */
export const FOLLOW_UP_NOTION_HEADING = "Follow-ups";

/** The Notion status word of a plan (verdict 12). */
export function followUpNotionStatus(p: { state: FollowUpState; nudgeReady: boolean }): (typeof FOLLOW_UP_NOTION_STATUS)[number] {
  if (p.nudgeReady) return "Nudge ready";
  return { waiting: "Waiting", stopped: "Stopped", handed_over: "Handed over", answered: "Answered" }[p.state] as (typeof FOLLOW_UP_NOTION_STATUS)[number];
}

/** One sweep turn: the project, the client it is bound to, the action id, and the facts the server prefetched as data. */
export interface FollowUpTurn {
  project: string;
  client: number;
  actionId: string;
  /** The prefetched history and plan (verdict 5), already rendered as the prompt's data block. */
  context: string;
  /** Whether the client's chat with autopilot on allows a send at `send_after` (the server's reading of the switches, verdict 8). */
  autopilotChat: number | null;
  /** Project mode for that chat: in `dry_run` the server never sends. */
  mode: "on" | "dry_run" | null;
}

/** What a turn's own calls wrote (read from its stream, never from a row): the decision and the nudge draft, if any. */
export type FollowUpTurnResult =
  | {
      kind: "decided";
      decision: FollowUpDecision;
      /** The messenger draft the turn wrote with `follow_up`, its text and its `send_after`, when it carried an autopilot send. */
      nudge: { draftId: number; text: string; sendAfter: string | null; chat: number | null } | null;
      costUsd: number | null;
    }
  | { kind: "undecided"; reason: string; costUsd: number | null }
  | { kind: "failed"; code: "mcp_not_ready" | "failed" | "timeout"; detail: string; costUsd?: number | null };

/** The model behind a sweep turn: `claudeBrain`'s `follow_up` kind, or a test's fake. It holds no send. */
export interface FollowUpBrain {
  readonly name: string;
  turn(t: FollowUpTurn, signal: { readonly aborted: boolean; addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void }): Promise<FollowUpTurnResult>;
}

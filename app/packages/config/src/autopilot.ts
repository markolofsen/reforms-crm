// The messenger autopilot (decision 0048, P139): its vocabulary, its numbers and the brain's port, once here so the policy
// (`@hub/projects/autopilot`), the server's scheduler, the agent's brain (A3), the contract and the admin read the same values.
// Browser-safe: no node imports. Every number is A0's measurement or a verdict of the plan (P139 section 3 and section 6).

/** The channels a chat can be on (the same three as `@hub/db`'s `MessengerChannel`). */
export const AUTOPILOT_CHANNELS = ["telegram_user", "telegram_bot", "whatsapp"] as const;
export type AutopilotChannel = (typeof AUTOPILOT_CHANNELS)[number];

/** The project's mode: `off`, `dry_run` (everything but the send; the draft waits, marked) or `on`. Default `off`. */
export const AUTOPILOT_MODES = ["off", "dry_run", "on"] as const;
export type AutopilotMode = (typeof AUTOPILOT_MODES)[number];
export const AUTOPILOT_MODE_LABELS: Record<AutopilotMode, string> = { off: "Off", dry_run: "Dry run", on: "On" };

/** `daily`: the first autopilot message of a day ends with a short "the owner's assistant" line (verdict 18). `when_asked`: only when asked. */
export const AUTOPILOT_DISCLOSE = ["daily", "when_asked"] as const;
export type AutopilotDisclose = (typeof AUTOPILOT_DISCLOSE)[number];
export const AUTOPILOT_DISCLOSE_LABELS: Record<AutopilotDisclose, string> = { daily: "Once a day", when_asked: "Only when asked" };

/** Why a chat's autopilot does not run: the first switch that is off (instance, project, chat), Stop sending, or a reply mode other than `draft` (verdict 2). */
export const AUTOPILOT_OFF_REASONS = ["instance", "project", "chat", "reply_mode", "stopped"] as const;
export type AutopilotOff = (typeof AUTOPILOT_OFF_REASONS)[number];

/** Why a chat's autopilot is off, in the owner's words (the admin's switch and state line). */
export const AUTOPILOT_OFF_WORDS: Record<AutopilotOff, string> = {
  instance: "autopilot is off on this Mac",
  project: "autopilot is off for this project",
  chat: "off in this chat",
  reply_mode: "needs the reply mode Draft",
  stopped: "Stop sending is on",
};

/** A chat in the policy's `chats` list: `<channel>:<chatId>` (`telegram_user:123`, `whatsapp:+4915…`). */
export const autopilotChatKey = (channel: AutopilotChannel, chatId: string): string => `${channel}:${chatId}`;

/** The quiet start after a client's last message (verdict 9), and the most a burst may defer the turn. */
export const AUTOPILOT_DEBOUNCE_MS = 8_000;
export const AUTOPILOT_BURST_MAX_MS = 45_000;
/** Turns at once on this Mac (verdict 8; A0: at most 603 MB per turn, two at once moved no swap). */
export const AUTOPILOT_POOL = 2;
/** One turn's wall clock (verdict 19, A0): killed after, counted as `refused: timeout`. */
export const AUTOPILOT_TURN_TIMEOUT_MS = 120_000;
/** Budgets (verdicts 10, 11, 19; A0 section 6 for the instance's). */
export const AUTOPILOT_CHAT_SENDS_PER_DAY = 15;
export const AUTOPILOT_CHAT_SENDS_PER_10_MIN = 4;
export const AUTOPILOT_CHAT_TURNS_PER_DAY = 20;
export const AUTOPILOT_INSTANCE_TURNS_PER_DAY = 100;
/** Of the door's 30 sends a day per account, autopilot may use this many; the rest stay for the owner's own Send (verdict 11). */
export const AUTOPILOT_ACCOUNT_SHARE = 20;
/** The scheduled send waits this jitter on top of the door's spacing, at most (verdict 11). */
export const AUTOPILOT_SPACING_JITTER_MS = 5_000;
/** The model of a turn (A0: `sonnet` resolves to the newest Sonnet; cheaper on plan usage than opus) and its model-call cap (verdict 19). */
export const AUTOPILOT_MODEL = "sonnet";
export const AUTOPILOT_MAX_TURNS = 12;
/** The `send_log.actor` of an autopilot send and the `messenger_drafts.created_by` of its draft (decision 0048 point 9). */
export const AUTOPILOT_SEND_ACTOR = "autopilot";
export const AUTOPILOT_DRAFT_AUTHOR = "autopilot";
/** The core skill whose rules a turn follows (its text is the turn's system prompt: `--tools ""` leaves no Skill tool). */
export const AUTOPILOT_SKILL = "autopilot-reply";
/** The env var that binds a `hub mcp` process to the one chat of a turn (verdict 20): the `messenger_chats` row id. */
export const AUTOPILOT_CHAT_ENV = "HUB_AUTOPILOT_CHAT";
/**
 * The hub MCP tools of a turn, and nothing else (verdict 28 as built): read the chat, the client's card (it carries the map),
 * the project's knowledge, and write one draft. `client_map` is left out: it writes the map and its Notion copy, and verdict 20
 * keeps the map read-only for autopilot (`client_show` returns it).
 */
export const AUTOPILOT_HUB_TOOLS = ["messenger_history", "client_show", "knowledge_search", "knowledge_get", "messenger_draft_write"] as const;
/** Pacing before a send (verdict 13): a read delay, then the typing status for a length-based time, each with jitter. */
export const AUTOPILOT_READ_DELAY_MS = { min: 2_000, max: 6_000 } as const;
export const AUTOPILOT_TYPING = { baseMs: 1_500, perCharMs: 35, maxMs: 12_000, jitter: 0.2 } as const;

/** After a restart, an unanswered client message at most this old is answered; an older one hands back (verdict 23). */
export const AUTOPILOT_RESTART_WINDOW_MS = 15 * 60_000;
/** An outbound message stored this soon after autopilot's own send is its echo, not the owner taking over (verdict 16). */
export const AUTOPILOT_ECHO_MS = 30_000;

/**
 * Why a turn ended without a send, as one closed list: the Activity line, the pause reason, the ops line and the admin's words
 * read these. `skipped` ones leave the chat on; `handed_back` ones pause it until the owner switches it on again (verdict 15).
 */
export const AUTOPILOT_REASONS = [
  // handed back: the chat pauses
  "owner_replied", // he wrote in the chat himself (verdict 16)
  "still_writing", // the client interrupted a second time (verdict 9)
  "looks_like_bot", // over 4 sends in 10 minutes (verdict 10)
  "chat_budget", // the chat's sends or turns of today are used up (verdicts 11, 19)
  "instance_budget", // this Mac's turns of today are used up (A0)
  "missed_while_off", // the client wrote while the Hub was off, over 15 minutes ago (verdict 23)
  "model_hand_back", // the model's own verdict (A3: the skill's rules, the owner's choice of 2026-11-24 over a code check of the text)
  "account_budget", // autopilot's share of the account's sends today is used up (verdict 11)
  "quiet_hours", // the project's quiet hours: the draft waits, nothing is sent (verdict 12)
  // skipped: nothing happens, the chat stays on
  "switched_off", // a switch went off before the turn ran
  "paused",
  "hidden", // the newest message is one the pre-analysis hid (verdict 10)
  "not_inbound", // the newest message is not the client's
  "your_draft", // the owner's own draft waits (verdict 29)
  "interrupted", // a newer client message: the turn runs again for the whole burst
  "no_brain", // no brain on this server (a test's wiring)
  "no_sender", // the brain said send, and this server has no autopilot sender (a test's wiring)
  // refused
  "timeout",
  "brain_failed",
  "door", // the send door refused, or the send failed (A4)
] as const;
export type AutopilotReason = (typeof AUTOPILOT_REASONS)[number];

/** What one turn came to (verdict 22). */
export const AUTOPILOT_OUTCOMES = ["sent", "handed_back", "refused", "dry_run", "skipped"] as const;
export type AutopilotOutcome = (typeof AUTOPILOT_OUTCOMES)[number];

/** The reasons that pause a chat: a hand-back (verdict 15). */
export const PAUSING_REASONS = ["owner_replied", "still_writing", "looks_like_bot", "chat_budget", "instance_budget", "missed_while_off", "model_hand_back", "account_budget", "quiet_hours"] as const satisfies readonly AutopilotReason[];
export type PausingReason = (typeof PAUSING_REASONS)[number];
export const isPausingReason = (v: unknown): v is PausingReason => typeof v === "string" && (PAUSING_REASONS as readonly string[]).includes(v);

/** Each reason in the owner's words (the pause line, Activity). */
export const AUTOPILOT_REASON_WORDS: Record<AutopilotReason, string> = {
  owner_replied: "you replied yourself",
  still_writing: "the client is still writing",
  looks_like_bot: "looks like a bot",
  chat_budget: "today's autopilot budget for this chat is used up",
  instance_budget: "today's autopilot budget is used up",
  missed_while_off: "missed while the Hub was off",
  model_hand_back: "the assistant handed it back",
  account_budget: "today's autopilot share of this account is used up",
  quiet_hours: "quiet hours: the reply waits for you",
  switched_off: "autopilot was switched off",
  paused: "autopilot is paused in this chat",
  hidden: "the newest message needs no answer",
  not_inbound: "the newest message is not the client's",
  your_draft: "your draft waits",
  interrupted: "a newer message arrived",
  no_brain: "no autopilot model on this server",
  no_sender: "this server cannot send for autopilot",
  timeout: "the turn took over two minutes",
  brain_failed: "the turn failed",
  door: "the send was refused",
};

/** The one chat a turn answers. `chat` is the `messenger_chats` row id (the `chat:<id>` ref the hub MCP binds to, verdict 20). */
export interface AutopilotChat {
  project: string;
  channel: AutopilotChannel;
  chatId: string;
  chat: number;
}

/** The model's verdict on the draft it wrote (the `autopilot-reply` skill decides it; no code checks the text, owner 2026-11-24). */
export const AUTOPILOT_VERDICTS = ["send", "hand_back"] as const;
export type AutopilotVerdict = (typeof AUTOPILOT_VERDICTS)[number];

/** What the brain is asked: one chat, one burst, the action id carried from the wake to the send (P137). */
export interface BrainTurn {
  chat: AutopilotChat;
  actionId: string;
  /** How many client messages this turn answers, and when the first of them arrived. */
  burst: { messages: number; firstAt: string };
  /** The project's mode when the turn started: in `dry_run` nothing is sent. */
  mode: Exclude<AutopilotMode, "off">;
  /** Autopilot's own draft that still waits in the chat (a dry run's, a handed-back one): the turn revises it (verdict 29). */
  revise: number | null;
  /** Verdict 18: this reply is the chat's first autopilot message today and the project discloses daily, so it ends with the line. */
  disclose: boolean;
}

/**
 * What the brain answers: the draft it wrote with its verdict, nothing written, or a failure. Never a send. `text` and `draftId`
 * are what the turn's own `messenger_draft_write` call carried and answered (its stream), never a row read back: a row of
 * `app.db` never authorizes a send, and the door refuses when the stored text differs from this one.
 */
export type BrainResult =
  | { kind: "draft"; draftId: number; text: string; verdict: AutopilotVerdict; reason: string; costUsd: number | null }
  | { kind: "no_draft"; reason: string; costUsd: number | null }
  | { kind: "failed"; code: "mcp_not_ready" | "failed"; detail: string; costUsd?: number | null };

/** What a brain is handed to stop on: a Node or DOM `AbortSignal` (named structurally, so this module needs neither's types). */
export interface TurnSignal {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
}

/**
 * The model behind a turn (verdict 7): A3's `claudeBrain` (one headless `claude -p` per turn, `packages/agent`) or a test's fake.
 * It writes a draft through the recorder and returns; it holds no send. `signal` aborts it (a timeout, a newer message).
 */
export interface AutopilotBrain {
  readonly name: string;
  turn(t: BrainTurn, signal: TurnSignal): Promise<BrainResult>;
}

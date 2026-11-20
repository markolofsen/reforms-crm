// The rules of one linked messenger chat (P71 M2b, research 23 section 2): what the agent may draft there. One owner of the
// vocabulary, the defaults and the bounds: the migration's CHECKs (`@hub/db` 0025), the repo's setter, the agent's
// `messenger_draft_write` and, in M3, the admin's Messengers ▸ Settings read these. No value sends: Send stays a person's
// click (decision 0036 point 8), so `reply_mode` has no `auto`.

/** `off`: never draft here. `on_request`: only when the owner asks for this chat in the session. `draft`: triage drafts a reply. */
export const REPLY_MODES = ["off", "on_request", "draft"] as const;
export type ReplyMode = (typeof REPLY_MODES)[number];
export const REPLY_MODE_LABELS: Record<ReplyMode, string> = { off: "Never draft", on_request: "Only when I ask", draft: "Draft replies" };

/** The owner's words for one chat (`instruction`): at most this many characters. */
export const CHAT_INSTRUCTION_MAX = 4000;
/** Silence before a follow-up may be proposed, in days. */
export const NUDGE_DAYS_MIN = 1;
export const NUDGE_DAYS_MAX = 60;
/** A messenger draft's text: Telegram's own message limit. */
export const MESSENGER_TEXT_MAX = 4096;
/** The owner's words that admit a draft in an `on_request` chat: long enough to be words, short enough to be a request. */
export const OWNER_REQUEST_MIN = 3;
export const OWNER_REQUEST_MAX = 500;

/**
 * The send guards of a user account (decision 0036 point 7), once here so the send door (P71 M4) enforces the same numbers that
 * Messengers ▸ Settings prints today (M3). The hub never makes first contact: a chat needs an inbound message before a send.
 */
export const MESSENGER_DAILY_CAP = 30;
export const MESSENGER_SPACING_SECONDS = 20;

/**
 * P84c (owner, 2026-11-20: "only the fresh ones"): an unlinked chat shows on Messengers ▸ Chats only while its newest message is at
 * most this many days old; an older one is never shown, so the list is what wrote lately, not every contact of the phone.
 */
export const UNLINKED_FRESH_DAYS = 14;

export interface ChatRules {
  replyMode: ReplyMode;
  /** The agent may propose a follow-up after our own last message, in a chat the client already wrote in (never first contact). */
  mayNudge: boolean;
  nudgeAfterDays: number;
  /** The owner's text for this chat, written only by him; null: none. */
  instruction: string | null;
  /** BCP-47; null: reply in the client's language. */
  language: string | null;
  /** The pre-analysis of M-P (off until the owner turns it on). */
  prefilter: boolean;
}

/** A linked chat with no rule set by the owner. */
export const DEFAULT_CHAT_RULES: Readonly<ChatRules> = Object.freeze({ replyMode: "draft", mayNudge: false, nudgeAfterDays: 3, instruction: null, language: null, prefilter: false });

export const isReplyMode = (v: unknown): v is ReplyMode => typeof v === "string" && (REPLY_MODES as readonly string[]).includes(v);

/** Why a rules change is refused, or null when it may be stored. One check for the setter and the admin (M3). */
export function chatRulesProblem(r: Partial<ChatRules>): string | null {
  if (r.replyMode !== undefined && !isReplyMode(r.replyMode)) return `reply_mode must be one of ${REPLY_MODES.join(", ")}`;
  if (r.nudgeAfterDays !== undefined && (!Number.isInteger(r.nudgeAfterDays) || r.nudgeAfterDays < NUDGE_DAYS_MIN || r.nudgeAfterDays > NUDGE_DAYS_MAX)) return `nudge_after_days must be a whole number from ${NUDGE_DAYS_MIN} to ${NUDGE_DAYS_MAX}`;
  if (r.instruction != null && r.instruction.length > CHAT_INSTRUCTION_MAX) return `instruction is ${r.instruction.length} characters, the limit is ${CHAT_INSTRUCTION_MAX}`;
  if (r.language != null && !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(r.language)) return `language "${r.language}" is not a BCP-47 tag`;
  return null;
}

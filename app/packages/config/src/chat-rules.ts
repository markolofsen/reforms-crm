// The rules of one linked messenger chat (P71 M2b, research 23 section 2): what the agent may draft there. One owner of the
// vocabulary, the defaults and the bounds: the migration's CHECKs (`@hub/db` 0025), the repo's setter, the agent's
// `messenger_draft_write` and, in M3, the admin's Settings ▸ Messengers read these. No value sends: Send stays a person's
// click (decision 0036 point 8), so `reply_mode` has no `auto`.

/** `off`: never draft here. `on_request`: only when the owner asks for this chat in the session. `draft`: triage drafts a reply. */
export const REPLY_MODES = ["off", "on_request", "draft"] as const;
export type ReplyMode = (typeof REPLY_MODES)[number];
export const REPLY_MODE_LABELS: Record<ReplyMode, string> = { off: "Never draft", on_request: "Only when I ask", draft: "Draft replies" };

/** The owner's words for one chat (`instruction`): at most this many characters. */
export const CHAT_INSTRUCTION_MAX = 4000;
/** A messenger draft's text: Telegram's own message limit. */
export const MESSENGER_TEXT_MAX = 4096;
/** The owner's words that admit a draft in an `on_request` chat: long enough to be words, short enough to be a request. */
export const OWNER_REQUEST_MIN = 3;
export const OWNER_REQUEST_MAX = 500;

/**
 * The send guards of a user account (decision 0036 point 7), once here so the send door (P71 M4) enforces the same numbers that
 * Settings ▸ Messengers prints today (M3). The hub never makes first contact: a chat needs an inbound message before a send.
 */
export const MESSENGER_DAILY_CAP = 30;
export const MESSENGER_SPACING_SECONDS = 20;

/**
 * P84c (owner, 2026-11-20: "only the fresh ones"): an unlinked chat shows on Messengers ▸ Chats only while its newest message is at
 * most this many days old; an older one is never shown, so the list is what wrote lately, not every contact of the phone.
 */
export const UNLINKED_FRESH_DAYS = 14;

/**
 * The pre-analysis of a linked chat (P71 M-P, decision 0039, research 23 sections 1 and 3): a cheap model labels each inbound text
 * message of a chat whose `prefilter` is on. One owner of the vocabulary for the migration's CHECK (`@hub/db` 0029), the server's
 * job, the agent's `messenger_history` and the admin. The fail-open labels come first: the fake transport answers the first value
 * of an enum, so an unscripted `HUB_LLM=fake` run hides nothing.
 */
export const TRIAGE_LABELS = ["needs_reply", "unclear", "fyi", "closing", "automated", "personal"] as const;
export type TriageLabel = (typeof TRIAGE_LABELS)[number];
/** What is hidden from the agent: kept, counted by reason, readable when asked. Everything else, unjudged included, reaches it. */
export const HIDDEN_LABELS = ["closing", "automated", "personal"] as const satisfies readonly TriageLabel[];
export type HiddenLabel = (typeof HIDDEN_LABELS)[number];
/** A stored verdict: a label, or `unjudged` (the model answered twice and neither answer was usable; never hidden, never re-asked). */
export const TRIAGE_VERDICTS = [...TRIAGE_LABELS, "unjudged"] as const;
export type TriageVerdict = (typeof TRIAGE_VERDICTS)[number];
export const isHiddenLabel = (v: unknown): v is HiddenLabel => typeof v === "string" && (HIDDEN_LABELS as readonly string[]).includes(v);
/** Each reason in the owner's words (the panel's counts, the Settings note). */
export const HIDDEN_LABEL_WORDS: Record<HiddenLabel, string> = { closing: "closing", automated: "automated", personal: "personal" };
/** Bumped when the prompt changes meaning: a stored verdict records the version it was judged under. */
export const PREANALYSIS_PROMPT_VERSION = 1;
/** Messages per model call (research 23 section 3.3), and at most this many judged in one pass. */
export const PREANALYSIS_PER_CALL = 20;
export const PREANALYSIS_PER_PASS = 100;
/** Only messages sent this recently are judged: turning the switch on does not send a chat's whole history to the model. */
export const PREANALYSIS_LOOKBACK_DAYS = 7;
/** How far back a link imports a chat's history (0036 point 3), and so how far back linking again reloads it after an Unlink. Days. */
export const IMPORT_DAYS = 30;

export interface ChatRules {
  replyMode: ReplyMode;
  /** The owner's text for this chat, written only by him; null: none. */
  instruction: string | null;
  /** BCP-47; null: reply in the client's language. */
  language: string | null;
  /** The pre-analysis (P71 M-P): a cheap model hides closing, automated and personal messages from the agent. Off until the owner turns it on. */
  prefilter: boolean;
}

/** A linked chat with no rule set by the owner. */
export const DEFAULT_CHAT_RULES: Readonly<ChatRules> = Object.freeze({ replyMode: "draft", instruction: null, language: null, prefilter: false });

export const isReplyMode = (v: unknown): v is ReplyMode => typeof v === "string" && (REPLY_MODES as readonly string[]).includes(v);

/** Why a rules change is refused, or null when it may be stored. One check for the setter and the admin (M3). */
export function chatRulesProblem(r: Partial<ChatRules>): string | null {
  if (r.replyMode !== undefined && !isReplyMode(r.replyMode)) return `reply_mode must be one of ${REPLY_MODES.join(", ")}`;
  if (r.instruction != null && r.instruction.length > CHAT_INSTRUCTION_MAX) return `instruction is ${r.instruction.length} characters, the limit is ${CHAT_INSTRUCTION_MAX}`;
  if (r.language != null && !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(r.language)) return `language "${r.language}" is not a BCP-47 tag`;
  return null;
}

import { OWNER_REQUEST_MIN, type ChatRules } from "@hub/config/chat-rules";
import type { ChatActivity } from "@hub/db";

// What a linked chat's rules let the agent draft (P71 M2b, research 23 section 2.2). Pure: `messenger_draft_write` refuses in
// code by this (a gate beats a reminder, `@rules/agent-guardrails.md` rule 1) and `messenger_history` shows its verdict, so
// the two never disagree. Decision 0036: the hub never makes first contact (point 7), and nothing is ever sent by the agent.
// No follow-up rule (owner, 2026-11-24): a draft after our own last message is admitted like any other.

export type RefusalCode = "reply_off" | "no_inbound" | "not_requested";

export interface Verdict {
  /** null: the draft may be written. */
  refusal: { code: RefusalCode; message: string } | null;
  /** The draft would follow our own last message (a follow-up), not answer an inbound one. Information only, stored on the draft. */
  nudge: boolean;
}

/**
 * The first-contact refusal (decision 0036 point 7, P141 verdict 7): what the agent tells the owner. The owner's word that the
 * person wrote does not count: only a message the Hub received does.
 */
export const NO_INBOUND =
  "No message from this person is stored yet; if they wrote, the Hub has not received it. Refresh the chat or check the WhatsApp or Telegram receiver (Settings ▸ Messengers). The hub never makes first contact (decision 0036 point 7), and the owner's word that they wrote does not change that. Nothing was written.";

/** True when the newest stored row of the chat is ours: a draft there is a follow-up, not an answer. */
export const lastIsOurs = (a: ChatActivity): boolean => a.lastOutAt !== null && (a.lastInAt === null || a.lastOutAt >= a.lastInAt);

/**
 * The verdict for one draft in one chat. Order: `off` first (the owner's no is absolute), then first contact, then the
 * owner's request for an `on_request` chat. `ownerRequest` is the owner's own words from this session, as he typed them;
 * the agent never writes them itself.
 */
export function draftVerdict(o: { rules: ChatRules; activity: ChatActivity; ownerRequest?: string | undefined }): Verdict {
  const nudge = lastIsOurs(o.activity);
  const no = (code: RefusalCode, message: string): Verdict => ({ refusal: { code, message }, nudge });
  if (o.rules.replyMode === "off") return no("reply_off", "The owner set this chat to never draft (reply_mode off): write nothing here and say so in one line.");
  // Decision 0049 (P141 W4): "the person wrote" is the server's fact (`lastInAt`, which outlives the cache), never a claim in a session.
  if (o.activity.lastInAt === null) return no("no_inbound", NO_INBOUND);
  if (o.rules.replyMode === "on_request" && (o.ownerRequest ?? "").trim().length < OWNER_REQUEST_MIN) {
    return no("not_requested", "This chat is on_request: draft only when the owner asks for this chat in this session, and pass his words as owner_request. Nothing was written.");
  }
  return { refusal: null, nudge };
}

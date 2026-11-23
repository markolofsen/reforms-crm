import { ToolError } from "./result";

// The advice every refusal of `draft_write` carries (P83): whether another call can help (`retry`) and what to tell the owner (`next`).

/**
 * What a refusal of a draft write lets the caller do next (P83: the dock agent repeated an identical failing call five
 * times and named a permission nobody had measured). `retry`: `now` after changing what `next` says, `after_owner` only
 * once the owner did what `next` says, `no` never in this turn. Only `mail_not_allowed` speaks of a permission.
 */
export type RetryAdvice = { retry: "now" | "after_owner" | "no"; next: string };
const NO_RETRY = "Do not call draft_write again for this draft in this turn.";
export const WRITE_ADVICE: Readonly<Record<string, RetryAdvice>> = {
  own_signoff: { retry: "now", next: "Remove your closing as the message says, then call draft_write once with the new text." },
  invalid: { retry: "now", next: "Fix the arguments as the message says." },
  empty: { retry: "now", next: "Give the reply's text." },
  mail_not_running: { retry: "after_owner", next: "Ask the owner in one line to open Mail (it may stay in the background), then call draft_write once more. The Hub does not open Mail itself: opening Mail sends whatever waits in its Outbox." },
  mail_not_allowed: { retry: "after_owner", next: "Tell the owner in one line: System Settings ▸ Privacy & Security ▸ Automation, allow the Hub's process to control Mail; then call draft_write once more." },
  content_refused: { retry: "no", next: `Another call, with this text or another, gives the same result. ${NO_RETRY} Tell the owner in one line: the Hub's Mail writer refused the reply, nothing was saved, it is a Hub fault (in the session log), not a macOS permission.` },
  mail_slow: { retry: "no", next: `${NO_RETRY} Tell the owner in one line that Mail is slow and the new text shows on the card when Mail saves it.` },
  already_sent: { retry: "now", next: "A sent draft is not revised. When the owner asked for a new message: one draft_write as a new reply to the newest message of the client's thread (our sent copy in Sent, or the client's newer one), with owner_request = his words; else tell the owner in one line what the message says." },
  draft_finished: { retry: "now", next: "A finished draft (done or skipped) is not revised and record-draft does not bring it back. When the owner asked for a new message: one draft_write as a new reply to the newest message of the client's thread (ours in Sent, or theirs), with owner_request = his words, then record-draft with ownerRequest; else tell the owner in one line that the draft is finished." },
  already_drafted: { retry: "no", next: "Revise the draft the message names, with draft = its id, when the owner asks. A finished draft and the owner asked for a new message: reply to the newest message of the thread with owner_request = his words." },
  no_recipient: { retry: "no", next: `${NO_RETRY} Tell the owner in one line that the message answered is ours and names nobody else; reply to the client's own newest message instead.` },
  no_message: { retry: "no", next: `${NO_RETRY} Tell the owner in one line that the client's message is no longer in Mail.` },
  no_account: { retry: "no", next: `${NO_RETRY} Tell the owner in one line that Mail has no such account (Settings ▸ Mail).` },
  mail_error: { retry: "no", next: `${NO_RETRY} Tell the owner in one line what Mail answered.` },
  has_thread: { retry: "now", next: "A thread with this client exists: one draft_write as a new reply to the newest message of that thread (ours in Sent, or theirs), with owner_request = his words." },
  do_not_contact: { retry: "no", next: `${NO_RETRY} Tell the owner in one line that this client is marked do not contact.` },
  wrong_message_id: { retry: "now", next: "Use the field the message names: draft = the hub draft's id to revise it, or message_id = mail-mcp's integer id of the message answered (from find_messages or list_messages)." },
  not_a_client: { retry: "after_owner", next: "Tell the owner in one line that this address is not a client of the project (not in its Notion Clients and not recorded); a new thread goes only to a client. If he wants to write anyway, the client is added to Notion first (by him, or by you on his words)." },
  notion_unavailable: { retry: "after_owner", next: "Tell the owner in one line why the Notion check could not run (the message says) and the fix; nothing was written." },
  owner_request_needed: { retry: "after_owner", next: "A new thread is written only when the owner asked for it in this session: pass his own words as owner_request, or ask him in one line." },
};

export const adviceOf = (code: string): RetryAdvice => WRITE_ADVICE[code] ?? { retry: "no", next: NO_RETRY };

/** P83: every refusal of `draft_write` says whether another call can help (`retry`) and what to tell the owner (`next`). */
export const advised = (fn: () => Promise<Record<string, unknown>>) => async (): Promise<Record<string, unknown>> => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ToolError) throw new ToolError(e.code, e.message, { ...adviceOf(e.code), ...e.detail });
    throw e;
  }
};

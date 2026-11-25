// P129 A2 (verdict 2): one refusal registry for every tool of `hub mcp`. A tool's description says what it does; the
// refusal says what to do next. `retry`: `now` after changing what `next` says, `after_owner` only once the owner did what
// `next` says, `no` never in this turn (P83: the dock agent repeated an identical failing call five times). `fix` is set
// when only the owner can fix it (P129 verdict 11). `run` (`./result.ts`) attaches `retry` and `next` to every refusal.

export const REFUSAL_CODES = [
  // every tool
  "unbound",
  "invalid",
  "db_behind",
  "core_changed",
  // a mail turn (P147 3h)
  "mail_other",
  // link_fetch (owner 2026-11-25)
  "link_refused",
  "link_failed",
  "unavailable",
  "not_found",
  "not_this_project",
  // a HubError's kind, when its own code is not registered (P126 E1)
  "wrong_state",
  "busy",
  "upstream",
  // focus, highlight
  "not_looking",
  "unknown_ref",
  // draft_write and the Mail writer
  "own_signoff",
  // P155: draft_write and messenger_draft_write
  "booking_link_mismatch",
  "empty",
  "mail_not_running",
  "mail_not_allowed",
  "content_refused",
  "mail_slow",
  "already_sent",
  "draft_finished",
  "already_drafted",
  "no_recipient",
  "no_message",
  "no_account",
  "no_thread",
  "mail_error",
  "has_thread",
  "do_not_contact",
  "wrong_message_id",
  "not_a_client",
  "notion_unavailable",
  "owner_request_needed",
  // P129 A3, A5: the record inside draft_write and client_record; the owner's words checked in the session log
  "owner_words_not_found",
  "record_invalid",
  "recipient_not_allowed",
  "record_failed",
  // client_map (P135)
  "map_invalid",
  "map_why_missing",
  // knowledge_search (P129 A4: the knowledge tools are hub mcp's)
  "empty_query",
  "brand_required",
  "unknown_brand",
  // messenger_history, messenger_draft_write (the chat's rules, `messenger/rules.ts`)
  "not_linked",
  "empty_text",
  "reply_off",
  "no_inbound",
  "not_requested",
  // messenger_send (decision 0046: the server's agent send route and `messenger/owner-word.ts`)
  "forbidden",
  "unattended",
  "other_chat",
  "no_owner_word",
  "word_before_draft",
  "word_superseded",
  "word_used",
  "chat_unclear",
  "refused",
  "failed",
  // decision 0048: an autopilot turn's hub mcp serves one chat (verdict 20)
  "autopilot_other_chat",
  "autopilot_verdict",
  // P143: conversation_done, client_create, chat_link
  "nothing_to_close",
  "already_linked",
  "not_in_notion",
  // P142: a follow-up turn's hub mcp serves one client (verdict 5)
  "followup_other_client",
  // P145 B3: bug_report found several open reports of the area, or the project has no Bug reports database
  "bug_report_several",
  "no_bug_database",
  // P147 (decision 0055): a lead turn's hub mcp serves one lead (D2); a lead is decided once; a lead's card is made at the send (D5)
  "lead_other",
  "lead_decided",
  "is_lead",
  // P147 E2: a draft to a lead goes to the address the server takes from the lead row (`replyAddressOf`), never another
  "address_not_on_lead",
] as const;

export type RefusalCode = (typeof REFUSAL_CODES)[number];

export interface Refusal {
  retry: "now" | "after_owner" | "no";
  /** At most {@link NEXT_MAX} characters: the next step, never a rule restated. */
  next: string;
  /** Only the owner can fix it: the line to show him and where (Overview's Needs you, P129 verdict 11). */
  fix?: { line: string; place: string };
}

export const NEXT_MAX = 200;

const ONE_LINE = "Tell the owner in one line";

export const REFUSALS: Readonly<Record<RefusalCode, Refusal>> = {
  unbound: { retry: "no", next: "Ask the owner to start this session with hub agent <project>." },
  link_refused: { retry: "no", next: "Only a public http(s) link is opened (never localhost, a private address or file:): tell the owner in one line which link and why." },
  link_failed: { retry: "no", next: "Say in one line that the link did not open (the message says why) and go on without it; never guess what it showed." },
  db_behind: { retry: "after_owner", next: "Tell the owner in one line: restart the Hub server (it applies the database migration), then this works again. Do not retry before." },
  mail_other: { retry: "no", next: "This mail turn serves its one message only: decide it (mail_decide) and stop." },
  core_changed: { retry: "no", next: "Tell the owner in one line: the Hub was updated, start a new dock session (this one runs the old tools). Do not retry in this session." },
  invalid: { retry: "now", next: "Fix the arguments as the message says." },
  unavailable: { retry: "no", next: `${ONE_LINE} that this session cannot do it (the message says why).`, fix: { line: "Restart the agent session with hub agent <project>.", place: "the dock" } },
  not_found: { retry: "now", next: "Use an id that focus or a read tool of this project gives." },
  not_this_project: { retry: "now", next: "Use only this project's accounts and addresses (the message lists them)." },
  wrong_state: { retry: "no", next: "Read the thing again (focus or its show tool): its state does not allow this now." },
  busy: { retry: "now", next: "Call once more in a moment (a draft already in Mail is adopted, not written twice); if it is busy again, tell the owner in one line." },
  upstream: { retry: "no", next: `${ONE_LINE} which service failed (the message names it).` },
  not_looking: { retry: "no", next: "Say it in words: the owner is not looking at this project's admin." },
  unknown_ref: { retry: "now", next: "Use a ref that focus gives." },
  booking_link_mismatch: { retry: "now", next: "Remove that booking link, or put in the one link the refusal names, word for word (the hub's resolver chose it for this thread's brand; once per thread, one repeat in a follow-up), and call again." },
  own_signoff: { retry: "now", next: "Remove your closing from the body and call draft_write once more: the hub signs. A language project.md has no sign-off for: pass your sign-off and team line as `signoff` with `language` (P147 3f)." },
  empty: { retry: "now", next: "Give the reply's text." },
  mail_not_running: { retry: "after_owner", next: "Ask the owner to open Mail (it may stay in the background), then call once more. The Hub does not open Mail itself: that sends its Outbox.", fix: { line: "Open Mail; it may stay in the background.", place: "Mail" } },
  mail_not_allowed: { retry: "after_owner", next: "Tell the owner: System Settings ▸ Privacy & Security ▸ Automation, allow the Hub to control Mail; then call once more.", fix: { line: "System Settings ▸ Privacy & Security ▸ Automation: allow the Hub to control Mail.", place: "System Settings" } },
  content_refused: { retry: "no", next: `Do not call again. ${ONE_LINE}: the Hub's Mail writer refused the reply, nothing was saved; a Hub fault, not a macOS permission.` },
  mail_slow: { retry: "no", next: `Do not call again for this draft now. ${ONE_LINE} that Mail is slow and the new text shows on the card when Mail saves it.` },
  already_sent: { retry: "now", next: "A new message on the owner's words: draft_write as a new reply to the newest message of the thread with owner_request; else say what the message says." },
  draft_finished: { retry: "now", next: "A new message on the owner's words: draft_write as a new reply to the newest message of the thread with owner_request; else say the draft is finished." },
  already_drafted: { retry: "no", next: "Revise the draft the message names (draft = its id) when the owner asks; this is the skip of a rerun, not an error." },
  no_recipient: { retry: "no", next: `${ONE_LINE} that the message answered is ours and names nobody else; reply to the client's own newest message.` },
  no_message: { retry: "no", next: `${ONE_LINE} that the client's message is no longer in Mail.` },
  no_account: { retry: "no", next: `${ONE_LINE} that Mail has no such account (Settings ▸ Mail).` },
  no_thread: { retry: "no", next: `${ONE_LINE} that this draft answers no Mail message, so it cannot be revised here.` },
  mail_error: { retry: "no", next: `Do not call again for this draft. ${ONE_LINE} what Mail answered.` },
  has_thread: { retry: "now", next: "Write a new reply to the newest message of that thread (ours in Sent, or theirs) with owner_request = his words." },
  do_not_contact: { retry: "no", next: `${ONE_LINE} that this client is marked do not contact.` },
  wrong_message_id: { retry: "now", next: "Use draft = the hub draft's id to revise it, or message_id = mail-mcp's integer id of the message answered." },
  not_a_client: { retry: "after_owner", next: `${ONE_LINE} that this address is not a client of the project; he adds it to Notion first if he wants to write.` },
  notion_unavailable: { retry: "after_owner", next: `${ONE_LINE} why the Notion check could not run and its fix (the message says); nothing was written.`, fix: { line: "Check the Notion token and the project's Clients database.", place: "Settings ▸ Connections" } },
  owner_request_needed: { retry: "after_owner", next: "Pass the owner's own words from this session as owner_request, or ask him in one line." },
  owner_words_not_found: { retry: "now", next: "Pass his words exactly as he typed them in this session (his language, not a summary) as owner_request, or leave it out and read the thread first." },
  record_invalid: { retry: "now", next: "Fix the record as the message says and call once more; the draft in Mail is kept and adopted, not written twice." },
  recipient_not_allowed: { retry: "no", next: `${ONE_LINE} that draft.recipients does not permit this address; nothing was written. He changes it himself: hub send policy set <slug> draft.recipients any.` },
  record_failed: { retry: "no", next: `${ONE_LINE} that the draft is in Mail but the Hub could not record it (the message says why).` },
  bug_report_several: { retry: "now", next: "Name the report it repeats: call bug_report again with into set to one of the page ids the message lists." },
  no_bug_database: { retry: "after_owner", next: `${ONE_LINE} that the project has no Bug reports database yet; the reply still acknowledges the report.`, fix: { line: "Create the Bug reports database: hub install --only notion.bug-reports.", place: "the dock" } },
  map_invalid: { retry: "now", next: "Redraw the whole map so the line the message names passes (the shape rules are in client_map's map field), then call once more." },
  map_why_missing: { retry: "now", next: "Call once more with why: one short reason per node the message names (removed or renamed), or keep those nodes." },
  empty_query: { retry: "now", next: "Search with the client's own words (letters, not only punctuation)." },
  brand_required: { retry: "now", next: "Pass brand = the brand message_show gave for this mail, or ANY for a mail with no brand." },
  unknown_brand: { retry: "now", next: "Use one of the brands the message lists (project_show names them too), or ANY." },
  not_linked: { retry: "no", next: "Outside a session the owner attends only linked chats are read: say so in one line." },
  empty_text: { retry: "now", next: "Give the reply's text." },
  reply_off: { retry: "no", next: "The owner set this chat to never draft: write nothing and say so in one line." },
  no_inbound: { retry: "no", next: "No message from this person is stored yet: tell the owner in one line to Refresh the chat or check the receiver; his word that they wrote does not count. Write nothing." },
  not_requested: { retry: "after_owner", next: "Draft here only when the owner asks for this chat; pass his words as owner_request." },
  forbidden: { retry: "no", next: "Leave the draft for the owner on the Messengers panel; never retry." },
  unattended: { retry: "no", next: "A background run never sends: leave the draft for the owner." },
  other_chat: { retry: "now", next: "Use the open_draft id messenger_history gives for this chat." },
  no_owner_word: { retry: "after_owner", next: "Send only after the owner tells you to in this session; the draft waits." },
  word_before_draft: { retry: "after_owner", next: "His word came before the draft's last change: ask him again in one line." },
  word_superseded: { retry: "after_owner", next: "He wrote again after that word: ask him in one line whether to send." },
  word_used: { retry: "no", next: "That word already sent one draft: ask him in one line before another send." },
  chat_unclear: { retry: "after_owner", next: "Ask him in one line which chat he means." },
  refused: { retry: "no", next: "Leave the draft for the owner and say why in his words; never retry." },
  failed: { retry: "no", next: `${ONE_LINE} that the send failed and why; never retry.` },
  autopilot_other_chat: { retry: "now", next: "This turn answers one chat: use its chat id and its client only (the prompt names them)." },
  autopilot_verdict: { retry: "now", next: "Call messenger_draft_write once more with autopilot = {verdict, reason} as the skill says." },
  nothing_to_close: { retry: "no", next: "Nothing of theirs waits for an answer here: leave it and say so in one line." },
  already_linked: { retry: "no", next: "The chat is linked already: say to whom in one line (messenger_history names the client)." },
  followup_other_client: { retry: "now", next: "This follow-up turn serves one client: use its id, its threads and its chats only (the prompt names them)." },
  lead_other: { retry: "now", next: "This lead turn serves one lead: its reply address and its one matched client only (the prompt names them)." },
  lead_decided: { retry: "no", next: "This lead already has a decision: say it in one line; the owner's Redo on its card clears it." },
  address_not_on_lead: { retry: "now", next: "Call draft_write again with lead: <its page id> and no `to`: the Hub fills the lead's address. No usable address: decide hand_over." },
  is_lead: { retry: "no", next: "Write the first reply as a new-thread draft; the card is made when the owner sends it from Mail ▸ Leads ▸ Review." },
  not_in_notion: { retry: "now", next: "Find the client with client_create's lookup (by email or phone), or create one from this chat with client_create." },
};

export const isRefusalCode = (code: string): code is RefusalCode => (REFUSAL_CODES as readonly string[]).includes(code);

const UNKNOWN: Refusal = { retry: "no", next: "Do not call again in this turn; tell the owner in one line what the message says." };

/** The advice of a code; a code from outside the registry (a Mail script's own) gets the do-not-retry advice. */
export const adviceOf = (code: string): Refusal => (isRefusalCode(code) ? REFUSALS[code] : UNKNOWN);

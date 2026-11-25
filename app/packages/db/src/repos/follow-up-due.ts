import type { FollowUpState } from "@hub/config/follow-ups";

// Who is silent (decision 0050 point 2, P142 verdict 2): a pure selector over fact rows, so each clause is a unit test. Mechanical
// only: it never reads a message's text and never judges whether a nudge is wanted (the agent does, verdict 3). A done chat
// (P143) is judged by its own facts: Done removes attention, not follow-up.

/** One linked chat of a client, as the selector reads it. */
export interface DueChat {
  id: number;
  channel: "telegram_user" | "telegram_bot" | "whatsapp";
  chatId: string;
  replyMode: "draft" | "on_request" | "off";
  lastInAt: string | null;
  lastOutAt: string | null;
  openDraft: boolean;
}

/** Everything the selector needs of one Hub client of the project. */
export interface DueFacts {
  clientId: number;
  name: string;
  email: string | null;
  doNotContact: boolean;
  /** An open P47 enrolment: the client belongs to the sequence (verdict 18). */
  enrolled: boolean;
  /** Mail: an open message of theirs (Wrote you), an open draft, their last message and our last send. */
  mail: { wrote: boolean; openDraft: boolean; theirLastAt: string | null; ourLastAt: string | null } | null;
  chats: DueChat[];
  plan: { state: FollowUpState; nextAt: string | null; nudgesSent: number } | null;
}

export interface DueClient {
  clientId: number;
  name: string;
  email: string | null;
  /** Our newest message across Mail and the chats, and theirs. */
  ourLastAt: string;
  theirLastAt: string | null;
  /** Where our newest message went: the channel the silence is on. */
  lastChannel: "mail" | DueChat["channel"];
  chats: DueChat[];
  /** A linked chat in `on_request`: the turn hands it over (verdict 2). */
  onRequest: boolean;
  plan: DueFacts["plan"];
}

/** Why a client is not listed, one code per clause (the tests name them; the summary counts nothing else). */
export type NotDue = "do_not_contact" | "enrolled" | "they_wrote_last" | "no_message" | "draft_waits" | "plan_closed" | "plan_later";

const newest = (...v: Array<string | null | undefined>): string | null => v.filter((x): x is string => !!x).sort().at(-1) ?? null;

/** One client's verdict: listed (with what the turn needs) or the first clause that keeps it out. */
export function judgeDue(f: DueFacts, today: string): DueClient | NotDue {
  if (f.doNotContact) return "do_not_contact";
  if (f.enrolled) return "enrolled";
  if (f.plan && (f.plan.state === "stopped" || f.plan.state === "handed_over")) return "plan_closed";
  // Verdict 2: a chat with reply_mode off is left out; on_request comes to the agent, which hands it over.
  const chats = f.chats.filter((c) => c.replyMode !== "off");
  if (f.mail?.wrote) return "they_wrote_last";
  if (f.mail?.openDraft || chats.some((c) => c.openDraft)) return "draft_waits";
  const ourMail = f.mail?.ourLastAt ?? null;
  const ourChat = newest(...chats.map((c) => c.lastOutAt));
  const ours = newest(ourMail, ourChat);
  const theirs = newest(f.mail?.theirLastAt, ...chats.map((c) => c.lastInAt));
  if (!ours) return "no_message";
  if (theirs && theirs >= ours) return "they_wrote_last";
  if (f.plan?.state === "waiting" && f.plan.nextAt && f.plan.nextAt.slice(0, 10) > today) return "plan_later";
  const lastChat = chats.filter((c) => c.lastOutAt === ourChat).at(0);
  const lastChannel = ourChat && (!ourMail || ourChat > ourMail) && lastChat ? lastChat.channel : "mail";
  return { clientId: f.clientId, name: f.name, email: f.email, ourLastAt: ours, theirLastAt: theirs, lastChannel, chats, onRequest: chats.some((c) => c.replyMode === "on_request"), plan: f.plan };
}

/**
 * P145 B4: a fixed bug's note goes to a client whatever the silence says (they may have written last, a plan may wait), so the
 * turn gets the client as a sweep turn does; never one marked do-not-contact. `lastChannel` is where our newest message went.
 */
export function asNoteClient(f: DueFacts): DueClient | null {
  if (f.doNotContact) return null;
  const chats = f.chats.filter((c) => c.replyMode !== "off");
  const ourMail = f.mail?.ourLastAt ?? null;
  const ourChat = newest(...chats.map((c) => c.lastOutAt));
  const lastChat = chats.filter((c) => c.lastOutAt === ourChat).at(0);
  const lastChannel = ourChat && (!ourMail || ourChat > ourMail) && lastChat ? lastChat.channel : "mail";
  const ours = newest(ourMail, ourChat) ?? "";
  return { clientId: f.clientId, name: f.name, email: f.email, ourLastAt: ours, theirLastAt: newest(f.mail?.theirLastAt, ...chats.map((c) => c.lastInAt)), lastChannel, chats, onRequest: chats.some((c) => c.replyMode === "on_request"), plan: f.plan };
}

/**
 * The list of verdict 2: every listed client, the oldest next date first (a client with no plan yet after the dated ones), then the
 * longest silence. `today` is the project's calendar day (YYYY-MM-DD).
 */
export function dueClients(facts: readonly DueFacts[], today: string): DueClient[] {
  const due = facts.map((f) => judgeDue(f, today)).filter((d): d is DueClient => typeof d !== "string");
  return due.sort((a, b) => {
    const an = a.plan?.nextAt ?? null;
    const bn = b.plan?.nextAt ?? null;
    if (an !== bn) {
      if (an === null) return 1;
      if (bn === null) return -1;
      return an < bn ? -1 : 1;
    }
    return a.ourLastAt < b.ourLastAt ? -1 : a.ourLastAt > b.ourLastAt ? 1 : a.clientId - b.clientId;
  });
}

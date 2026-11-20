import { REPLY_MODE_LABELS } from "@hub/config/chat-rules";
import { phrase } from "@hub/contract/help";
import type { MessengerChannelDto, MessengerChannelFilter, MessengerChatDto, MessengerSendPreviewDto, MessengerView } from "@hub/contract/messenger-panel";
import type { RecentDialogDto } from "@hub/contract/messengers";

// The Messengers section's words (P71 M3), pure so a test holds them (`ui-specifications.md` rule 3).

export const CHANNEL_LABEL: Record<MessengerChannelDto, string> = { telegram_user: "Telegram", telegram_bot: "Telegram bot", whatsapp: "WhatsApp" };

/** P84c (owner, 2026-11-20): three states of a chat in one View menu; no "postponed" state, since Hide covers it and is undone. */
export const VIEW_LABEL: Record<MessengerView, string> = { todo: "To do", linked: "Linked", hidden: "Hidden" };
export const VIEW_ORDER: readonly MessengerView[] = ["todo", "linked", "hidden"];
export const CHANNEL_FILTER_LABEL: Record<MessengerChannelFilter, string> = { all: "All", telegram: "Telegram", whatsapp: "WhatsApp" };

/** The confirm step of a messenger send (P71 M4): who, on which channel, from which account, and that it cannot be undone. */
export const confirmLine = (p: Pick<MessengerSendPreviewDto, "to" | "channel" | "account">): string =>
  `To ${p.to} on ${CHANNEL_LABEL[p.channel]}, from your account ${p.account}. A sent message cannot be recalled.`;

/** Who the chat is: the client it is linked to, else the chat's own title, else its id. */
export const chatName = (c: MessengerChatDto): string => c.client?.name || c.client?.email || c.title || `Chat ${c.chatId}`;

/** The chat's rules in one muted line: the channel, the reply mode and, when on, the follow-up days. */
export function rulesLine(c: MessengerChatDto): string {
  const parts = [CHANNEL_LABEL[c.channel], REPLY_MODE_LABELS[c.rules.replyMode]];
  if (c.rules.mayNudge) parts.push(`follow-up after ${c.rules.nudgeAfterDays} ${c.rules.nudgeAfterDays === 1 ? "day" : "days"}`);
  if (c.rules.language) parts.push(`in ${c.rules.language}`);
  return parts.join(" · ");
}

/** Who wrote last, as the row says it. */
export const lastWho = (c: MessengerChatDto): string | null => (c.last ? (c.last.direction === "in" ? "They wrote" : "You wrote") : null);

/** The newest message's words: its text, or its kind for a message with no text (media bytes are never stored). */
export const lastText = (c: MessengerChatDto): string => {
  if (!c.last) return "";
  const t = c.last.text.trim();
  return t || `(${c.last.kind})`;
};

/**
 * What the row says where there is no draft: whose turn it is and, when a reply is owed, why the agent has not drafted one (the
 * chat's rule) or the phrase that makes it draft. Null when a draft is there.
 */
export function noDraftLine(c: MessengerChatDto, project: string): string | null {
  if (c.draft) return null;
  if (!c.last) return "No message stored yet.";
  if (!c.owed) return "You replied last.";
  if (c.rules.replyMode === "off") return "A reply is owed. The agent never drafts here (this chat's rule).";
  if (c.rules.replyMode === "on_request") return "A reply is owed. The agent drafts here only when you ask for this chat in a session.";
  return `A reply is owed and no draft yet: say “${phrase("triage-messages", project)}” in a session.`;
}

// ---- P84: chats link themselves (decision 0036 point 3 as amended 2026-11-20)

/** Why a seen dialog was not linked by itself, in the owner's words. */
export function whyLine(r: Pick<RecentDialogDto, "why" | "by" | "candidates">): string {
  const by = r.by === "username" ? "username" : "phone";
  const n = r.candidates.length;
  switch (r.why) {
    case "ambiguous":
      return `Its ${by} belongs to ${n} clients: pick the right one.`;
    case "no_email":
      return `Its ${by} matches a client with no email in Notion: add one, or link it here.`;
    case "off":
      return `Its ${by} matches this client. Autolink is off for this project, so it waits for your Link.`;
    case "failed":
      return `Its ${by} matches this client, but the link was refused (the number may be another client's already).`;
    case "none":
      return "No client in Notion has its phone or username.";
  }
}

/**
 * P84c, P88: the one line above the unlinked rows, said once instead of once per row ("none" rows say nothing of their own), and
 * with no linked chat yet it says that too, in the same line (`admin-principles.md` rule 3: one status line, no paragraphs).
 */
export function unlinkedIntro(o: { freshDays: number; count: number; noLinked: boolean }): string {
  const chats = o.count === 1 ? "1 new chat" : `${o.count} new chats`;
  const line = `${chats} of the last ${o.freshDays} days ${o.count === 1 ? "is" : "are"} not linked to a client: link or hide each.`;
  return o.noLinked ? `No linked chats yet · ${line}` : line;
}

/** P84c: an unlinked row's time: when they wrote, or when the owner wrote last. */
export const wroteLine = (last: { at: string; inbound: boolean }, ago: string): string => (last.inbound ? `wrote ${ago}` : `you wrote ${ago}`);

/** P84c: the Hidden view's line for the refusals the Hub keeps as a fingerprint only (it cannot name them back). */
export const unnamedHiddenLine = (n: number): string =>
  `${n === 1 ? "1 more hidden chat is" : `${n} more hidden chats are`} kept as a fingerprint only: it shows here by name when it writes again.`;

/** The account row's sentence after its "Connected" badge (Messengers ▸ Settings): what the Hub reads of a connected account. */
export const readsLine = (linked: number): string => `· reads only chats linked to a client (${linked} linked)`;

/** The Chats empty state's opening: both accounts named, and why nothing shows. */
export function emptyLine(o: { telegram: boolean; whatsapp: boolean; enabled: boolean; withIdentifier: number; directoryReady: boolean }): string {
  const names = [o.telegram ? "your Telegram account" : null, o.whatsapp ? "your WhatsApp number" : null].filter((x): x is string => x !== null);
  if (names.length === 0) return "No Telegram account or WhatsApp number is connected: connect one on Messengers ▸ Settings.";
  const who = names.join(" and ");
  const how = !o.directoryReady
    ? "The client list from Notion is not read yet, so nothing can be matched."
    : o.enabled
      ? `A chat links itself when its phone or username equals one of the ${o.withIdentifier} clients in Notion that have one.`
      : "Autolink is off for this project: a matching chat waits below for your Link.";
  return `The Hub reads ${who}, but only the chats linked to a client: no other chat is stored. ${how}`;
}

import { REPLY_MODE_LABELS } from "@hub/config/chat-rules";
import { phrase } from "@hub/contract/help";
import type { MessengerChannelDto, MessengerChatDto, MessengerSendPreviewDto, MessengerView } from "@hub/contract/messenger-panel";

// The Messengers section's words (P71 M3), pure so a test holds them (`ui-specifications.md` rule 3).

export const CHANNEL_LABEL: Record<MessengerChannelDto, string> = { telegram_user: "Telegram", telegram_bot: "Telegram bot", whatsapp: "WhatsApp" };

export const VIEW_LABEL: Record<MessengerView, string> = { waiting: "Waiting", all: "All chats" };
export const VIEW_ORDER: readonly MessengerView[] = ["waiting", "all"];

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

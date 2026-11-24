import { HIDDEN_LABEL_WORDS, HIDDEN_LABELS, IMPORT_DAYS, PREANALYSIS_LOOKBACK_DAYS, REPLY_MODE_LABELS } from "@hub/config/chat-rules";
import { CONVERSATION_STATE_LABELS, type ConversationState } from "@hub/contract/conversations";
import type { MessengerChannelFilter, MessengerChatDto, MessengerLinkFilter, MessengerView, PreanalysisDto } from "@hub/contract/messenger-panel";
import type { MessengerChannelDto, MessengerSendPreviewDto } from "@hub/contract/messenger";
import type { AutolinkLinkedDto, RecentDialogDto } from "@hub/contract/messengers";
import { notionIdentityLine as notionLine, notionIndicatorState as notionStateOf } from "@/lib/notion";

// The Messengers section's words (P71 M3), pure so a test holds them (`ui-specifications.md` rule 3).

export const CHANNEL_LABEL: Record<MessengerChannelDto, string> = { telegram_user: "Telegram", telegram_bot: "Telegram bot", whatsapp: "WhatsApp" };

/** P84c (owner, 2026-11-20): the states of a chat in one View menu; no "postponed" state, since Hide covers it and is undone. P102 adds Not linked: every remembered unlinked chat, of any age. */
/** P123 U3b: Mail's three views, in Mail's words (decision 0045). */
export const VIEW_LABEL: Record<MessengerView, string> = { needs_you: "Needs you", waiting: "Waiting", all: "All" };
export const VIEW_ORDER: readonly MessengerView[] = ["needs_you", "waiting", "all"];
/** P123 U3b: the link state, a filter beside the view (`?link=`). */
export const LINK_LABEL: Record<MessengerLinkFilter, string> = { any: "Any link", linked: "Linked", unlinked: "Not linked", hidden: "Hidden" };
export const LINK_ORDER: readonly MessengerLinkFilter[] = ["any", "linked", "unlinked", "hidden"];
export const CHANNEL_FILTER_LABEL: Record<MessengerChannelFilter, string> = { all: "All", telegram: "Telegram", whatsapp: "WhatsApp" };

/** The confirm step of a messenger send (P71 M4): who, on which channel, from which account, and that it cannot be undone. */
export const confirmLine = (p: Pick<MessengerSendPreviewDto, "to" | "channel" | "account">): string =>
  `To ${p.to} on ${CHANNEL_LABEL[p.channel]}, from your account ${p.account}. A sent message cannot be recalled.`;

/** Who the chat is: the client it is linked to, else the chat's own title, else its id. */
export const chatName = (c: MessengerChatDto): string => c.client?.name || c.client?.email || c.title || `Chat ${c.chatId}`;

/** The chat's rules in one line for detail and diagnostics; the compact list does not render this legacy summary. */
export function rulesLine(c: MessengerChatDto): string {
  const parts = [CHANNEL_LABEL[c.channel], REPLY_MODE_LABELS[c.rules.replyMode]];
  if (c.rules.language) parts.push(`in ${c.rules.language}`);
  return parts.join(" · ");
}

/** Who wrote last, for diagnostics and label tests; the list now keeps this implicit in its state line. */
export const lastWho = (c: MessengerChatDto): string | null => (c.last ? (c.last.direction === "in" ? "They wrote" : "You wrote") : null);

/** The newest message's words: its text, or its kind for a message with no text (media bytes are never stored). */
export const lastText = (c: MessengerChatDto): string => {
  if (!c.last) return "";
  const t = c.last.text.trim();
  return t || `(${c.last.kind})`;
};

/** The detailed explanation used below a chat when no draft is present. */
export function noDraftLine(c: MessengerChatDto): string | null {
  if (c.draft) return null;
  if (!c.last) return "No message stored yet.";
  if (c.last.direction === "in" && c.last.hidden) return `Their last message was hidden by the pre-analysis (${HIDDEN_LABEL_WORDS[c.last.hidden]}): no reply owed.`;
  if (!c.owed) return "You replied last.";
  if (c.rules.replyMode === "off") return "A reply is owed. The agent never drafts here (this chat's rule).";
  if (c.rules.replyMode === "on_request") return "A reply is owed. Prepare a reply when you want the agent to draft it.";
  return "A reply is owed and no draft yet. Prepare a reply to ask the agent to draft it.";
}

/** The single state phrase shown on a linked chat, so the owner can tell the next step without reading the row's details. */
/**
 * P123 U3, P127 V6: a chat's state in the contract's vocabulary, the same words as Mail's rows (an open draft `draft`, a reply
 * owed `wrote`, a last message the pre-analysis hid `done`, our message last `waiting`); null with no stored message (the empty
 * history, not a row state). Until the server derives it on `messengerChatDto` (C3).
 */
export function chatState(c: Pick<MessengerChatDto, "last" | "owed" | "draft"> & { done?: MessengerChatDto["done"] }): ConversationState | null {
  if (c.draft) return "draft";
  if (!c.last) return null;
  if (c.last.direction === "in" && c.last.hidden) return "done";
  // P143 D1: marked "no reply needed" through their newest message.
  if (c.last.direction === "in" && c.done) return "done";
  return c.owed ? "wrote" : "waiting";
}

/** The state word a row and the header say: `CONVERSATION_STATE_LABELS`, "No messages yet" without a message. */
export function chatStateLine(c: Pick<MessengerChatDto, "last" | "owed" | "draft"> & { done?: MessengerChatDto["done"] }): string {
  const state = chatState(c);
  return state === null ? "No messages yet" : CONVERSATION_STATE_LABELS[state];
}

// ---- P71 M-P: the pre-analysis of a linked chat

/**
 * The chat's pre-analysis counts by reason in one muted line, or null while the switch is off and nothing was ever judged. What it
 * could not judge is said apart: it reached the agent (fail open).
 */
export function triageLine(c: Pick<MessengerChatDto, "rules" | "triage">): string | null {
  const t = c.triage;
  if (!c.rules.prefilter && t.judged === 0 && t.unjudged === 0) return null;
  const head = c.rules.prefilter ? "Pre-analysis" : "Pre-analysis (off now)";
  if (t.judged === 0 && t.unjudged === 0) return `${head}: nothing read yet.`;
  const reasons = HIDDEN_LABELS.filter((l) => t.hidden[l] > 0).map((l) => `${t.hidden[l]} ${HIDDEN_LABEL_WORDS[l]}`);
  const hidden = HIDDEN_LABELS.reduce((n, l) => n + t.hidden[l], 0);
  const parts = [hidden ? `hid ${hidden} of ${t.judged} (${reasons.join(", ")})` : `read ${t.judged}, hid none`];
  if (t.unjudged) parts.push(`${t.unjudged} could not be judged and reached the agent`);
  return `${head}: ${parts.join(" · ")}.`;
}

/**
 * The note under the Settings switch: what it does now, or why nothing runs (no OpenRouter key). Replaces M3's
 * "nothing reads this switch" line.
 */
export function prefilterNote(p: PreanalysisDto): string {
  if (p.state === "no_key") return "Needs an OpenRouter key: pre-analysis stays off until the Hub instance is configured.";
  const what = `A cheap model reads each new message and the two before it (never a name or the chat's title), then hides closing words, automated notices and personal chatter. Uncertain messages still reach the agent; turning it on reads the last ${PREANALYSIS_LOOKBACK_DAYS} days.`;
  return p.state === "fake" ? `${what} This Hub is using a local test model; no request leaves this computer.` : what;
}

// ---- P84: chats link themselves (decision 0036 point 3 as amended 2026-11-20)

/** Why a seen dialog was not linked by itself, in the owner's words. */
export function whyLine(r: Pick<RecentDialogDto, "why" | "by" | "candidates">): string {
  const by = r.by === "username" ? "username" : "phone";
  const n = r.candidates.length;
  switch (r.why) {
    case "ambiguous":
      return `Its ${by} belongs to ${n} clients: pick the right one.`;
    case "off":
      return `Its ${by} matches this client. Autolink is off for this project, so it waits for your Link.`;
    case "failed":
      return `Its ${by} matches this client, but the link was refused (the number may be another client's already).`;
    case "none":
      return "No client in Notion has its phone or username.";
  }
}

/** P138 verdict 9: the unlinked chats' group heading, "Not linked · 2" (the rule is the heading's tooltip, `unlinkedIntro`). */
export function unlinkedHeading(o: { count: number; noLinked: boolean }): string {
  return `${o.noLinked ? "No linked chats yet · " : ""}Not linked · ${o.count}`;
}

/**
 * P84c, P88, P138: the rule of the unlinked group, the tooltip of its heading, said once instead of once per row ("none" rows say nothing of their own), and
 * with no linked chat yet it says that too, in the same line (`admin-principles.md` rule 3: one status line, no paragraphs).
 */
export function unlinkedIntro(o: { freshDays: number | null; count: number; noLinked: boolean }): string {
  const word = o.freshDays === null ? "chat" : "new chat";
  const chats = o.count === 1 ? `1 ${word}` : `${o.count} ${word}s`;
  const span = o.freshDays === null ? "the Hub has seen since it started (any age)" : `of the last ${o.freshDays} days`;
  const line = `${chats} ${span} ${o.count === 1 ? "is" : "are"} not linked to a client: link or hide each.`;
  return o.noLinked ? `No linked chats yet · ${line}` : line;
}

// ---- P100: find the client (live Notion search, Create, the fill-back) and what a link loads

/** The link box's placeholder: every identity key the search reads. */
export const RECORD_SEARCH_PLACEHOLDER = "Name, email, @username or phone";

/** The toast after a link: how much history came with it (a link imports the last `days` once; new messages arrive live). */
export function linkedLine(r: Pick<AutolinkLinkedDto, "imported" | "importError" | "days">): string {
  if (r.importError) return `Could not load the last ${r.days} days (${r.importError}); new messages still arrive`;
  if (r.imported === 0) return `No messages from the last ${r.days} days; new ones arrive automatically`;
  return `${r.imported === 1 ? "1 message" : `${r.imported} messages`} from the last ${r.days} days loaded`;
}

/** Create's button when nobody matches: the chat's own name in guillemets, as the owner reads it. */
export const createLabel = (title: string): string => `Create client «${title}» in Notion`;

/** What Create writes besides Name and Email: the chat's Telegram username (else phone) or WhatsApp number, or null. */
export function createIdentityLine(r: Pick<RecentDialogDto, "channel" | "username" | "phone" | "chatId">): string | null {
  if (r.channel === "whatsapp") return `WhatsApp ${r.phone ?? r.chatId} is written to the card`;
  if (r.username) return `Telegram ${r.username.replace(/^@/, "")} is written to the card`;
  if (r.phone) return `Telegram ${r.phone.startsWith("+") ? r.phone : `+${r.phone}`} is written to the card`;
  return null;
}

/** P84c: an unlinked row's time: when they wrote, or when the owner wrote last. */
export const wroteLine = (last: { at: string; inbound: boolean }, ago: string): string => (last.inbound ? `wrote ${ago}` : `you wrote ${ago}`);

/** P84c: the Hidden view's line for the refusals the Hub keeps as a fingerprint only (it cannot name them back). */
export const unnamedHiddenLine = (n: number): string =>
  `${n === 1 ? "1 more hidden chat is" : `${n} more hidden chats are`} kept as a fingerprint only: it shows here by name when it writes again.`;

/** The account row's sentence after its "Connected" badge (Settings ▸ Messengers): what the Hub reads of a connected account. */
export const readsLine = (linked: number): string => `· reads only chats linked to a client (${linked} linked)`;

/** The Chats empty state's opening: both accounts named, and why nothing shows. */
export function emptyLine(o: { telegram: boolean; whatsapp: boolean; enabled: boolean; withIdentifier: number; directoryReady: boolean }): string {
  const names = [o.telegram ? "your Telegram account" : null, o.whatsapp ? "your WhatsApp number" : null].filter((x): x is string => x !== null);
  if (names.length === 0) return "No Telegram account or WhatsApp number is connected: connect one on Settings ▸ Messengers.";
  const who = names.join(" and ");
  const how = !o.directoryReady
    ? "The client list from Notion is not read yet, so nothing can be matched."
    : o.enabled
      ? `A chat links itself when its phone or username equals one of the ${o.withIdentifier} clients in Notion that have one.`
      : "Autolink is off for this project: a matching chat waits below for your Link.";
  return `The Hub reads ${who}, but only the chats linked to a client: no other chat is stored. ${how}`;
}

// ---- P102: one state menu per chat row

/** The client a linked chat belongs to, as the row says it. */
export const clientName = (c: Pick<MessengerChatDto, "client">): string => c.client?.name || c.client?.email || "a client";

export function notionIndicatorState(c: Pick<MessengerChatDto, "client">): "connected" | "not_found" | "unavailable" | null {
  if (!c.client) return null;
  return notionStateOf(c.client.notion);
}

/** The identity state is visible in the row/header; a missing Notion ref must not look like a successful link. */
export function notionIdentityLine(c: Pick<MessengerChatDto, "client">): string | null {
  if (!c.client) return null;
  return notionLine(c.client.notion, clientName(c));
}

/** The compact row marker: the contact name already identifies the Notion record, so only its state belongs in the list. */
export function notionStatusLine(c: Pick<MessengerChatDto, "client">): string | null {
  if (!c.client) return null;
  const state = notionIndicatorState(c);
  return state === "connected" ? "Notion" : state === "not_found" ? "Notion not found" : "Notion unavailable";
}

const messages = (n: number): string => (n === 1 ? "1 stored message" : `${n} stored messages`);

/**
 * The one sentence of Unlink and of Hide on a linked chat, shown in place before anything changes (`ui-specifications.md` rule 5d).
 * Decision 0049: Unlink only takes the client away (the chat stays, not linked, its copy kept for the cache's days); Hide forgets
 * the chat: its stored messages and its draft are deleted.
 */
export const unlinkSentence = (o: { name: string; client: string; stored: number; hide: boolean }): string =>
  o.hide
    ? `Unlink and hide ${o.name} (not a client): its ${messages(o.stored)} and its draft are deleted, and the Hub never links it by itself again. Linking again reloads the last ${IMPORT_DAYS} days.`
    : `Unlink ${o.name} from ${o.client}: the chat stays in Messengers as not linked, with its ${messages(o.stored)}; the agent no longer reads it and the autopilot stops.`;

/** The toast after Change client: both names. The chat's messages stay with it. */
export const movedLine = (o: { name: string; to: string }): string => `Moved ${o.name} to ${o.to}`;

/** P143 D2: the toast after Done, and the header's line when the agent closed it ("Done by the agent: they said thanks"). */
export const doneToast = (name: string): string => `No reply needed: ${name}`;
export function doneLine(d: MessengerChatDto["done"]): string | null {
  if (!d) return null;
  return d.by === "agent" ? `Done by the agent${d.reason ? `: ${d.reason}` : ""}` : "Marked done";
}

/** P143 N1: a linked chat's subtitle: the person's number or @username, as the messenger shows it; null when neither is known. */
export function handleLine(i: Pick<MessengerChatDto["identity"], "phone" | "username">): string | null {
  if (i.username) return `@${i.username.replace(/^@/, "")}`;
  return i.phone ?? null;
}

/** P141 U3: who the person of a chat is, as the messenger shows it: "+966 …, @user, calls themselves Qimma"; null when nothing is known. */
export function identityLine(i: Pick<MessengerChatDto["identity"], "phone" | "username" | "profileName">): string | null {
  const parts = [i.phone, i.username ? `@${i.username.replace(/^@/, "")}` : null, i.profileName ? `calls themselves ${i.profileName}` : null].filter((x): x is string => Boolean(x));
  return parts.length ? parts.join(", ") : null;
}

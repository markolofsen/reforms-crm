import { OWNER_WORD_MAX_AGE_HOURS } from "@hub/config";
import type { LogEvent } from "@hub/log/event";

// The owner's word that lets the agent send one messenger draft (decision 0046, P132 B1-2). Pure: the server reads the project's
// session log (P54) and calls this; the tool's caller never hands in words or a session id as proof (`@rules/approval-and-
// capabilities.md` rule 9). The word is an owner `prompt` that tells it to send, written after the draft's last change, the newest
// prompt of its session, at most `OWNER_WORD_MAX_AGE_HOURS` old, not negated, not yet used, and naming the chat unambiguously.

export type OwnerWordRefusalCode = "no_owner_word" | "word_before_draft" | "word_superseded" | "word_used" | "other_chat" | "chat_unclear";

export interface OwnerWordRefusal {
  code: OwnerWordRefusalCode;
  message: string;
  /** What the agent does now, in one line. */
  next: string;
}

export type OwnerWordVerdict = { ok: true; ref: string; text: string; at: string } | { ok: false; refusal: OwnerWordRefusal };

/** One open messenger draft of the project: its id, its chat (the `messenger_chats` row id) and its last change. */
export interface OpenDraftRef {
  id: number;
  chat: number;
  updatedAt: string;
}

export interface OwnerWordInput {
  /** This project's `prompt` and `focus` events (others are ignored), any order. */
  events: readonly Pick<LogEvent, "ts" | "session" | "kind" | "data" | "turn">[];
  draft: OpenDraftRef;
  /** Every open messenger draft of the project, this one included. */
  openDrafts: readonly OpenDraftRef[];
  /** References already spent on a send (`send_log.owner_word`). */
  used: ReadonlySet<string>;
  now: Date;
}

const L = "\\p{L}";
/** Russian imperatives of "send" (no question form, no infinitive: "отправить?" asks, it does not tell). */
const RU = new RegExp(`(?<!${L})(отправь|отправьте|отправляй|отправляйте|отошли|отошлите|отсылай)(?!${L})`, "giu");
/** English: "send it / this / that / now / the draft (now)", or a prompt that is "send" alone. */
const EN = new RegExp(`(?<!${L})send\\s+(?:it|this|that|now|the\\s+(?:draft|reply|message))(?!${L})`, "giu");
const EN_ALONE = /^\s*(?:ok(?:ay)?[,!.]?\s+|yes[,!.]?\s+|please\s+)?send(?:\s+please)?\s*[.!]*\s*$/iu;
/** A negation within the three words before the verb: "не отправляй", "don't send it", "do not send", "never send". */
const NEG = new RegExp(`(?<!${L})(?:не|нельзя|don'?t|do\\s+not|never|not|no)(?!${L})(?:\\s+${L}+){0,2}\\s*$`, "iu");

/** True when the text tells the agent to send: an imperative, not negated, not inside a question. */
export function isSendWord(text: string): boolean {
  if (EN_ALONE.test(text)) return true;
  for (const re of [RU, EN]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const before = text.slice(0, m.index);
      if (NEG.test(before)) continue;
      // The sentence the verb is in: up to the next sentence end; a "?" there makes it a question.
      const rest = text.slice(m.index);
      const end = /[.!?\n]/u.exec(rest);
      if (end && end[0] === "?") continue;
      return true;
    }
  }
  return false;
}

/** The chats a text names by ref (`chat:3`). */
const chatRefs = (text: string): Set<number> => new Set([...text.matchAll(/(?<![\p{L}\d])chat:(\d{1,9})(?!\d)/gu)].map((m) => Number(m[1])));
/** The chat the admin had open or pointed at, from the focus line of the same turn. */
const focusChat = (line: string): number | null => {
  const m = /(?:^|\s)(?:open|on) chat:(\d{1,9})(?!\d)/u.exec(line);
  return m ? Number(m[1]) : null;
};

export const ownerWordRef = (e: { session: string; ts: string }): string => `${e.session}@${e.ts}`;

const no = (code: OwnerWordRefusalCode, message: string, next: string): OwnerWordVerdict => ({ ok: false, refusal: { code, message, next } });
const ASK = "Ask the owner in one line whether to send it; send only after he says so for this chat.";

export function ownerWordFor(i: OwnerWordInput): OwnerWordVerdict {
  const since = new Date(i.now.getTime() - OWNER_WORD_MAX_AGE_HOURS * 3_600_000).toISOString();
  const prompts = i.events
    .filter((e) => e.kind === "prompt" && typeof e.data.text === "string" && e.ts >= since && e.ts <= i.now.toISOString())
    .map((e) => ({ ...e, text: String(e.data.text) }))
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const newestOf = new Map<string, string>();
  for (const p of prompts) newestOf.set(p.session, p.ts);
  const words = prompts.filter((p) => isSendWord(p.text));
  const after = words.filter((p) => p.ts > i.draft.updatedAt);
  const live = after.filter((p) => newestOf.get(p.session) === p.ts);
  const word = live.at(-1);
  if (!word) {
    if (after.length) return no("word_superseded", "The owner wrote again after he said to send, so that word no longer stands. Nothing was sent.", ASK);
    if (words.length) return no("word_before_draft", `The owner's word to send came before this draft's last change (${i.draft.updatedAt}): he has not seen this text. Nothing was sent.`, `Show him the draft in one line and ask; send only after he says so again. ${ASK}`);
    return no("no_owner_word", "The owner has not told you to send in this session's log (for example \"отправь\" or \"send it\"). Nothing was sent.", ASK);
  }
  const ref = ownerWordRef(word);
  if (i.used.has(ref)) return no("word_used", "That word of the owner already sent a draft: one send per word. Nothing was sent.", ASK);

  // The chat: named in the prompt by ref, else the focus line of the same turn, else the only draft changed since his previous prompt.
  const named = chatRefs(word.text);
  if (named.size > 1) return no("chat_unclear", "The owner's word names more than one chat. Nothing was sent.", "Ask him which chat, in one line.");
  if (named.size === 1) {
    if (!named.has(i.draft.chat)) return no("other_chat", `The owner's word names chat:${[...named][0]}, not chat:${i.draft.chat}. Nothing was sent.`, "Send only the chat he named, or ask him.");
    return { ok: true, ref, text: word.text, at: word.ts };
  }
  const focus = i.events.find((e) => e.kind === "focus" && e.session === word.session && (word.turn ? e.turn === word.turn : e.ts === word.ts) && typeof e.data.line === "string");
  const shown = focus ? focusChat(String(focus.data.line)) : null;
  if (shown !== null) {
    if (shown !== i.draft.chat) return no("other_chat", `When the owner said to send, the admin showed chat:${shown}, not chat:${i.draft.chat}. Nothing was sent.`, "Ask him which chat he meant, in one line.");
    return { ok: true, ref, text: word.text, at: word.ts };
  }
  const prev = prompts.filter((p) => p.session === word.session && p.ts < word.ts).at(-1)?.ts ?? "";
  const changed = i.openDrafts.filter((d) => d.updatedAt > prev && d.updatedAt <= word.ts);
  if (changed.length === 1 && changed[0]!.id === i.draft.id) return { ok: true, ref, text: word.text, at: word.ts };
  return no("chat_unclear", "The owner's word does not say which chat: no chat open in the admin, and not exactly this one draft written since his previous message. Nothing was sent.", "Ask him which chat, in one line (he can open it in the admin or name it).");
}

import type { CallRecord, LedgerEntry } from "./ledger";

// The guard's messenger rule (P71 M2): a messenger reply is drafted from that chat's own history. A `messenger_history` call is
// one ledger line naming the chats it returned (`<channel>:<chat id>`, ids only, never a message); a `messenger_draft_write`
// with no such read of its chat earlier in the same session (and subagent) is a violation. It is not a mail draft: the mail
// chain of `observeDraft` (the answered message, the history search, Notion) is never asked of it.

export const HUB_MESSENGER_HISTORY = "mcp__hub__messenger_history";
export const HUB_MESSENGER_DRAFT_WRITE = "mcp__hub__messenger_draft_write";

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? Object.fromEntries(Object.entries(v)) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** `<channel>:<chat id>`, the one spelling of a chat in the ledger. */
export const chatKey = (channel: string, chatId: string): string => `${channel}:${chatId}`;

/** The hub tool's JSON reply: `structuredContent`, else the text of its first content block. */
function replyOf(r: unknown): Record<string, unknown> {
  const o = obj(r);
  if (o.structuredContent && typeof o.structuredContent === "object") return obj(o.structuredContent);
  const blocks = Array.isArray(r) ? r : Array.isArray(o.content) ? o.content : [];
  for (const b of blocks) {
    const t = typeof b === "string" ? b : str(obj(b).text);
    if (!t) continue;
    try {
      return obj(JSON.parse(t));
    } catch {
      /* not JSON */
    }
  }
  return {};
}

/** The ledger line of a `messenger_history` call: the chats its reply listed (or the one its input named), or null for a refusal. */
export function chatEntry(c: CallRecord): LedgerEntry | null {
  if (c.name !== HUB_MESSENGER_HISTORY) return null;
  const reply = replyOf(c.result);
  if (reply.error !== undefined) return null;
  const listed = Array.isArray(reply.chats) ? reply.chats.map(obj).flatMap((x) => (str(x.channel) && str(x.chat_id) ? [chatKey(str(x.channel)!, str(x.chat_id)!)] : [])) : [];
  const i = obj(c.input);
  const named = str(i.channel) && str(i.chat_id) ? [chatKey(str(i.channel)!, str(i.chat_id)!)] : [];
  const chats = [...new Set(listed.length ? listed : c.result === undefined ? named : [])];
  return chats.length ? { tool: "messenger_history", kind: "chat", chats } : null;
}

/** The guard's decision for a `messenger_draft_write` about to run: its chat must have been read in this session (and subagent). */
export function chatDraftViolations(entries: readonly LedgerEntry[], call: CallRecord, aid?: string): string[] {
  if (call.name !== HUB_MESSENGER_DRAFT_WRITE) return [];
  const i = obj(call.input);
  const channel = str(i.channel);
  const chatId = str(i.chat_id);
  if (!channel || !chatId) return [];
  const want = chatKey(channel, chatId);
  const read = entries.some((e) => e.kind === "chat" && (e.aid ?? "") === (aid ?? "") && (e.chats ?? []).includes(want));
  return read ? [] : [`read this chat first: no messenger_history of ${want} in this session before messenger_draft_write (a messenger reply is written from that chat's own history and rules)`];
}

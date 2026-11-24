import type { MessengerChannel, Repos } from "@hub/db";
import type { InboundMessage } from "./adapter";
import { RETENTION_DAYS } from "./types";

/**
 * Decision 0049 (P141 W2): the channel whose chats are cached before they are linked. A message of a chat the owner hid ("not a
 * client") is never kept; a chat where only the owner wrote stays uncached until the person answers. Until P141 U2 such a chat has
 * no `messenger_chats` row: its cached messages are adopted by `chat_id` when it is linked.
 */
export interface UnlinkedCache {
  channel: MessengerChannel;
  /** The owner hid this chat: nothing of it is kept. */
  hidden(chatId: string): Promise<boolean>;
}

export interface IngestDeps {
  project: string;
  repos: Repos;
  now?: () => Date;
  /** The cache's TTL in days (decision 0049 point 1): `retain_until` is now plus this. Default `RETENTION_DAYS`. */
  retentionDays?: number;
  /** Cache the unlinked chats of this channel (decision 0049); absent, they are dropped as before. */
  cache?: UnlinkedCache;
}

export interface Dropped {
  channel: MessengerChannel;
  chatId: string;
  title?: string;
  count: number;
}

/** P139 A2: what one ingest stored in one chat, by side, so the autopilot wakes on the chats that got a new message. */
export interface StoredChat {
  channel: MessengerChannel;
  chatId: string;
  inbound: number;
  outbound: number;
  /** False for a chat cached before it is linked (decision 0049): no row, so no autopilot and no pre-analysis. */
  linked: boolean;
}

export interface IngestResult {
  stored: number;
  /** The chats this ingest stored new messages in (duplicates and history not counted), in the order they were first stored. */
  chats: StoredChat[];
  duplicates: number;
  /** Messages from chats the owner has not listed (and, with a cache, hidden ones). Not stored. */
  dropped: Dropped[];
  /** Edits that replaced the text of a stored message. */
  edited: number;
}

/**
 * Stores inbound messages from linked chats, and with `cache` the chats of that channel that wrote but are not linked (decision
 * 0049). Idempotent: a repeated remote id is counted, not stored. On a linked chat it writes the fact that the person wrote (the
 * newest inbound time), the account that reads it and its WhatsApp address, which outlive the cache. Ingest never creates a client,
 * an identifier or a chat row: linking a chat to a client is the owner's act (`human.ts`).
 */
export async function ingest(deps: IngestDeps, messages: InboundMessage[]): Promise<IngestResult> {
  const now = (deps.now ?? (() => new Date()))();
  const days = deps.retentionDays ?? RETENTION_DAYS;
  const retainUntil = new Date(now.getTime() + days * 86_400_000).toISOString();
  const cacheSince = now.getTime() - days * 86_400_000;
  const { messengers } = deps.repos;
  const linked = new Map<string, boolean>();
  const hidden = new Map<string, boolean>();
  const wrote = new Map<string, boolean>();
  const dropped = new Map<string, Dropped>();
  const chats = new Map<string, StoredChat>();
  const facts = new Map<string, { channel: MessengerChannel; chatId: string; inboundAt: string | null; account: string; jid: string | null }>();
  let stored = 0;
  let duplicates = 0;
  let edited = 0;
  const keyOf = (m: InboundMessage) => `${m.channel}:${m.chatId}`;
  // A chat where only the owner wrote stays uncached: its outbound rows are kept once the person wrote, in this batch or before.
  const inboundInBatch = new Set(messages.filter((m) => (m.direction ?? "in") === "in" && !m.editOf).map(keyOf));

  const drop = (m: InboundMessage, key: string) => {
    const d = dropped.get(key) ?? { channel: m.channel, chatId: m.chatId, ...(m.chatTitle ? { title: m.chatTitle } : {}), count: 0 };
    d.count++;
    dropped.set(key, d);
  };

  for (const m of messages) {
    const key = keyOf(m);
    let ok = linked.get(key);
    if (ok === undefined) {
      ok = await messengers.isAllowed(deps.project, m.channel, m.chatId);
      linked.set(key, ok);
    }
    if (!ok) {
      const cache = deps.cache && deps.cache.channel === m.channel ? deps.cache : null;
      if (!cache) {
        drop(m, key);
        continue;
      }
      let h = hidden.get(key);
      if (h === undefined) {
        h = await cache.hidden(m.chatId);
        hidden.set(key, h);
      }
      if (h) {
        drop(m, key);
        continue;
      }
      // Older than the cache's window: it would expire at once; the Mac's app or the messenger has it.
      if (Date.parse(m.sentAt) < cacheSince) continue;
      if (!m.editOf && (m.direction ?? "in") === "out" && !inboundInBatch.has(key)) {
        let w = wrote.get(key);
        if (w === undefined) {
          w = await messengers.hasCachedInbound(deps.project, m.channel, m.chatId);
          wrote.set(key, w);
        }
        if (!w) continue;
      }
    }
    if (m.editOf) {
      if (await messengers.editMessageText(deps.project, m.channel, m.chatId, m.editOf, m.text)) edited++;
      continue;
    }
    if (ok) {
      const f = facts.get(key) ?? { channel: m.channel, chatId: m.chatId, inboundAt: null, account: m.account, jid: null };
      if ((m.direction ?? "in") === "in") {
        if (!f.inboundAt || m.sentAt > f.inboundAt) f.inboundAt = m.sentAt;
        f.account = m.account;
      }
      if (m.chatJid) f.jid = m.chatJid;
      facts.set(key, f);
    }
    const inserted = await messengers.insertMessage({
      project: deps.project,
      channel: m.channel,
      account: m.account,
      chatId: m.chatId,
      remoteMessageId: m.remoteMessageId,
      direction: m.direction ?? "in",
      kind: m.kind,
      text: m.text,
      sentAt: m.sentAt,
      retainUntil,
      source: m.source ?? null,
    });
    if (inserted) {
      stored++;
      // History (a sync, an import, the Mac's app) is stored but is not news: only a new message wakes the autopilot.
      if (m.backfill || m.source) continue;
      const c = chats.get(key) ?? { channel: m.channel, chatId: m.chatId, inbound: 0, outbound: 0, linked: ok };
      if ((m.direction ?? "in") === "in") c.inbound++;
      else c.outbound++;
      chats.set(key, c);
    } else duplicates++;
  }
  for (const f of facts.values()) await messengers.noteChatFact(deps.project, f.channel, f.chatId, { inboundAt: f.inboundAt, account: f.account, jid: f.jid });
  return { stored, chats: [...chats.values()], duplicates, dropped: [...dropped.values()], edited };
}

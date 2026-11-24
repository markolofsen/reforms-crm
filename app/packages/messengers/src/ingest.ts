import type { MessengerChannel, Repos } from "@hub/db";
import type { InboundMessage } from "./adapter";
import { RETENTION_DAYS } from "./types";

/**
 * Decision 0049 (P141 W2, U1, U2): a channel whose chats become known when they write. A message of a chat the owner hid ("not a
 * client") is never kept; a chat where only the owner wrote stays unknown until the person answers. The first inbound message of a
 * new chat makes its `messenger_chats` row (known, not linked).
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
  /** Make the chats of this channel that write known (decision 0049); absent, a message of an unknown chat is dropped. */
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
  /** False for a known chat no client identifier names (decision 0049): no autopilot and no pre-analysis there. */
  linked: boolean;
}

export interface IngestResult {
  stored: number;
  /** The chats this ingest stored new messages in (duplicates and history not counted), in the order they were first stored. */
  chats: StoredChat[];
  duplicates: number;
  /** Messages of chats that are not known and cannot become known here (no cache for the channel, a hidden chat). Not stored. */
  dropped: Dropped[];
  /** Edits that replaced the text of a stored message. */
  edited: number;
}

/**
 * Stores the messages of known chats, and with `cache` makes a chat of that channel known on its first inbound message (decision
 * 0049 point 6: its row, with who it is, never a text). Idempotent: a repeated remote id is counted, not stored. On a known chat it
 * writes the fact that the person wrote (the newest inbound time), the account that reads it and its WhatsApp address, which outlive
 * the cache. Ingest never creates a client or an identifier: linking a chat to a client is the owner's act (`human.ts`) or the
 * autolink's.
 */
/** What a message says of its chat's identity, for the known row (never its text). */
const identityOf = (m: InboundMessage) => ({ title: m.chatTitle ?? null, username: m.chatUsername ?? null, phone: m.chatPhone ?? null, profileName: m.profileName ?? null });

export async function ingest(deps: IngestDeps, messages: InboundMessage[]): Promise<IngestResult> {
  const now = (deps.now ?? (() => new Date()))();
  const days = deps.retentionDays ?? RETENTION_DAYS;
  const retainUntil = new Date(now.getTime() + days * 86_400_000).toISOString();
  const cacheSince = now.getTime() - days * 86_400_000;
  const { messengers } = deps.repos;
  const known = new Map<string, boolean>();
  const linked = new Map<string, boolean>();
  const refreshed = new Set<string>();
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
    // History older than the cache's window would get a fresh TTL: the Mac's app or the messenger has it (decision 0049 point 1).
    if ((m.backfill || m.source) && Date.parse(m.sentAt) < cacheSince) continue;
    let ok = known.get(key);
    if (ok === undefined) {
      ok = await messengers.isKnown(deps.project, m.channel, m.chatId);
      known.set(key, ok);
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
      // Decision 0049 point 6: the person wrote (here, earlier in the cache or later in this batch), so the chat is known from now on
      // (its row; never a client).
      if (!m.editOf) {
        await messengers.knowChat(deps.project, m.channel, m.chatId, identityOf(m));
        known.set(key, true);
        ok = true;
      }
    } else if ((m.direction ?? "in") === "in" && (m.profileName || m.chatUsername || m.chatPhone || m.chatTitle) && !refreshed.has(key)) {
      // Who the chat is may be new (a push name the person changed, a phone first seen): filled where empty, never a text.
      refreshed.add(key);
      await messengers.knowChat(deps.project, m.channel, m.chatId, identityOf(m));
    }
    if (m.editOf) {
      if (await messengers.editMessageText(deps.project, m.channel, m.chatId, m.editOf, m.text)) edited++;
      continue;
    }
    {
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
      let l = linked.get(key);
      if (l === undefined) {
        l = await messengers.isLinked(deps.project, m.channel, m.chatId);
        linked.set(key, l);
      }
      const c = chats.get(key) ?? { channel: m.channel, chatId: m.chatId, inbound: 0, outbound: 0, linked: l };
      if ((m.direction ?? "in") === "in") c.inbound++;
      else c.outbound++;
      chats.set(key, c);
    } else duplicates++;
  }
  for (const f of facts.values()) await messengers.noteChatFact(deps.project, f.channel, f.chatId, { inboundAt: f.inboundAt, account: f.account, jid: f.jid });
  return { stored, chats: [...chats.values()], duplicates, dropped: [...dropped.values()], edited };
}

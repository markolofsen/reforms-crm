import type { MessengerChannel, Repos } from "@hub/db";
import type { InboundMessage } from "./adapter";
import { RETENTION_DAYS } from "./types";

export interface IngestDeps {
  project: string;
  repos: Repos;
  now?: () => Date;
  retentionDays?: number;
}

export interface Dropped {
  channel: MessengerChannel;
  chatId: string;
  title?: string;
  count: number;
}

export interface IngestResult {
  stored: number;
  duplicates: number;
  /** Messages from chats the owner has not listed. Not stored; shown so the owner can list the chat id. */
  dropped: Dropped[];
}

/**
 * Stores inbound messages from allow-listed chats only. Idempotent: a repeated remote id is counted, not stored.
 * Ingest never creates a client or an identifier: linking a chat to a client is the owner's act (`human.ts`).
 */
export async function ingest(deps: IngestDeps, messages: InboundMessage[]): Promise<IngestResult> {
  const now = (deps.now ?? (() => new Date()))();
  const retainUntil = new Date(now.getTime() + (deps.retentionDays ?? RETENTION_DAYS) * 86_400_000).toISOString();
  const { messengers } = deps.repos;
  const allowed = new Map<string, boolean>();
  const dropped = new Map<string, Dropped>();
  let stored = 0;
  let duplicates = 0;

  for (const m of messages) {
    const key = `${m.channel}:${m.chatId}`;
    let ok = allowed.get(key);
    if (ok === undefined) {
      ok = await messengers.isAllowed(deps.project, m.channel, m.chatId);
      allowed.set(key, ok);
    }
    if (!ok) {
      const d = dropped.get(key) ?? { channel: m.channel, chatId: m.chatId, ...(m.chatTitle ? { title: m.chatTitle } : {}), count: 0 };
      d.count++;
      dropped.set(key, d);
      continue;
    }
    const inserted = await messengers.insertMessage({
      project: deps.project,
      channel: m.channel,
      account: m.account,
      chatId: m.chatId,
      remoteMessageId: m.remoteMessageId,
      direction: "in",
      kind: m.kind,
      text: m.text,
      sentAt: m.sentAt,
      retainUntil,
    });
    if (inserted) stored++;
    else duplicates++;
  }
  return { stored, duplicates, dropped: [...dropped.values()] };
}

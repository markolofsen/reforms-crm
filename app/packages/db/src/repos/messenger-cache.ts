import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { messengerChats, messengerMessages, type MessengerChannel } from "../schema";
import { write, type WriteTx } from "../tx";

/** What ingest observed of a chat (decision 0049): the newest inbound message's time, the account that read it, its WhatsApp address. */
export type ChatFact = { inboundAt?: string | null; account?: string | null; jid?: string | null };

type MessengerMessage = typeof messengerMessages.$inferSelect;

/** The fact on a linked chat's row: `last_inbound_at` only moves forward; a null leaves what is stored. */
function noteFact(tx: WriteTx, project: string, channel: MessengerChannel, chatId: string, f: ChatFact): boolean {
  const set = {
    ...(f.inboundAt ? { lastInboundAt: sql<string>`case when ${messengerChats.lastInboundAt} is null or ${messengerChats.lastInboundAt} < ${f.inboundAt} then ${f.inboundAt} else ${messengerChats.lastInboundAt} end` } : {}),
    ...(f.account ? { account: f.account } : {}),
    ...(f.jid ? { jid: f.jid } : {}),
  };
  if (!Object.keys(set).length) return false;
  return tx.update(messengerChats).set(set).where(and(eq(messengerChats.project, project), eq(messengerChats.channel, channel), eq(messengerChats.chatId, chatId))).run().changes > 0;
}

/**
 * The link and the message cache (decision 0049, P141 W2 and W4). Messages are a 30-day cache: a WhatsApp chat's are cached before
 * it is linked, and a link adopts them. "The person wrote" is a fact on the chat row that outlives the cache (`last_inbound_at`,
 * `account`), which the first-contact rule and the door read. Every query names the project.
 */
export function messengerCacheRepo(db: Db) {
  const msgsOf = (project: string, channel: MessengerChannel, chatId: string) => and(eq(messengerMessages.project, project), eq(messengerMessages.channel, channel), eq(messengerMessages.chatId, chatId));
  const chatKey = (project: string, channel: MessengerChannel, chatId: string) => and(eq(messengerChats.project, project), eq(messengerChats.channel, channel), eq(messengerChats.chatId, chatId));

  return {
    /**
     * Lists (links) a chat; `autolinked` is the reason when the Hub's autolink did it (P84), else the owner did. Messages cached
     * before the link are adopted, and with them the fact that the person wrote and the account that reads the chat.
     */
    async allowChat(project: string, channel: MessengerChannel, chatId: string, title?: string | null, autolinked?: string | null): Promise<void> {
      write(db, (tx) => {
        tx.insert(messengerChats)
          .values({ project, channel, chatId, title: title ?? null, autolinked: autolinked ?? null })
          .onConflictDoUpdate({ target: [messengerChats.project, messengerChats.channel, messengerChats.chatId], set: title ? { title } : { chatId } })
          .run();
        const lastIn = tx.select({ at: sql<string | null>`max(${messengerMessages.sentAt})` }).from(messengerMessages).where(and(msgsOf(project, channel, chatId), eq(messengerMessages.direction, "in"))).get()?.at ?? null;
        const reader = tx.select({ account: messengerMessages.account }).from(messengerMessages).where(msgsOf(project, channel, chatId)).orderBy(sql`(${messengerMessages.direction} = 'in') desc`, desc(messengerMessages.sentAt)).get()?.account ?? null;
        noteFact(tx, project, channel, chatId, { inboundAt: lastIn, account: reader });
      });
    },
    /** What ingest observed of a linked chat; nothing when the chat is not linked. Returns whether a row changed. */
    async noteChatFact(project: string, channel: MessengerChannel, chatId: string, f: ChatFact): Promise<boolean> {
      return write(db, (tx) => noteFact(tx, project, channel, chatId, f));
    },
    /** Whether a cached inbound message of the chat exists (a chat with no row included). */
    async hasCachedInbound(project: string, channel: MessengerChannel, chatId: string): Promise<boolean> {
      return !!db.select({ id: messengerMessages.id }).from(messengerMessages).where(and(msgsOf(project, channel, chatId), eq(messengerMessages.direction, "in"))).get();
    },
    /** Hide of a chat that is not linked (0049 point 6): its cached messages go. A linked chat is untouched (Unlink deletes its own). */
    async dropCachedChat(project: string, channel: MessengerChannel, chatId: string): Promise<number> {
      return write(db, (tx) => (tx.select({ id: messengerChats.id }).from(messengerChats).where(chatKey(project, channel, chatId)).get() ? 0 : tx.delete(messengerMessages).where(msgsOf(project, channel, chatId)).run().changes));
    },
    /** An edit (WhatsApp's `editedMessage`) replaces the text of the stored row; false when no such row is cached. */
    async editMessageText(project: string, channel: MessengerChannel, chatId: string, remoteMessageId: string, text: string): Promise<boolean> {
      return db.update(messengerMessages).set({ text }).where(and(msgsOf(project, channel, chatId), eq(messengerMessages.remoteMessageId, remoteMessageId))).run().changes > 0;
    },
    /** The chat's oldest cached message, or null: the anchor of WhatsApp's on-demand history, which answers only what came before it. */
    async oldestMessage(project: string, channel: MessengerChannel, chatId: string): Promise<MessengerMessage | null> {
      return db.select().from(messengerMessages).where(msgsOf(project, channel, chatId)).orderBy(asc(messengerMessages.sentAt), asc(messengerMessages.id)).get() ?? null;
    },
  };
}

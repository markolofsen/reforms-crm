import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import type { Db } from "../client";
import { messengerChats, messengerMessages, type MessengerChannel } from "../schema";
import { write, type WriteTx } from "../tx";

/** What is known of a chat when its row is made or refreshed (decision 0049 point 6, P141 U3): never a text. */
export type KnownChat = { title?: string | null; forceTitle?: boolean; autolinked?: string | null; username?: string | null; phone?: string | null; profileName?: string | null };
/** What ingest observed of a chat (decision 0049): the newest inbound message's time, the account that read it, its WhatsApp address. */
export type ChatFact = { inboundAt?: string | null; account?: string | null; jid?: string | null };

type MessengerMessage = typeof messengerMessages.$inferSelect;

/**
 * The fact on a linked chat's row: `last_inbound_at` only moves forward; a null leaves what is stored. The row is written only when a
 * value changes: an UPDATE that matches fires the `live_*` trigger, and a refill that brought nothing new must not wake the admin.
 */
function noteFact(tx: WriteTx, project: string, channel: MessengerChannel, chatId: string, f: ChatFact): boolean {
  const changes = [
    ...(f.inboundAt ? [sql`(${messengerChats.lastInboundAt} is null or ${messengerChats.lastInboundAt} < ${f.inboundAt})`] : []),
    ...(f.account ? [sql`${messengerChats.account} is not ${f.account}`] : []),
    ...(f.jid ? [sql`${messengerChats.jid} is not ${f.jid}`] : []),
  ];
  const set = {
    ...(f.inboundAt ? { lastInboundAt: sql<string>`case when ${messengerChats.lastInboundAt} is null or ${messengerChats.lastInboundAt} < ${f.inboundAt} then ${f.inboundAt} else ${messengerChats.lastInboundAt} end` } : {}),
    ...(f.account ? { account: f.account } : {}),
    ...(f.jid ? { jid: f.jid } : {}),
  };
  if (!changes.length) return false;
  return tx.update(messengerChats).set(set).where(and(eq(messengerChats.project, project), eq(messengerChats.channel, channel), eq(messengerChats.chatId, chatId), or(...changes))).run().changes > 0;
}

/**
 * The known chat and the message cache (decision 0049, P141 W2, W4 and U2). Messages are a 30-day cache: a chat that wrote is known
 * (its row is made by ingest), and a link only names its client. "The person wrote" is a fact on the chat row that outlives the cache (`last_inbound_at`,
 * `account`), which the first-contact rule and the door read. Every query names the project.
 */
export function messengerCacheRepo(db: Db) {
  const msgsOf = (project: string, channel: MessengerChannel, chatId: string) => and(eq(messengerMessages.project, project), eq(messengerMessages.channel, channel), eq(messengerMessages.chatId, chatId));
  const chatKey = (project: string, channel: MessengerChannel, chatId: string) => and(eq(messengerChats.project, project), eq(messengerChats.channel, channel), eq(messengerChats.chatId, chatId));

  return {
    /**
     * Makes the chat known (decision 0049 point 6: a chat that wrote; the owner's Link and Create too), or refreshes what is known
     * of it: a given title, username, phone or profile name fills an empty one (a profile name, the person's own, follows the latest),
     * `autolinked` is the reason when the Hub's autolink linked it. Messages cached before the row are adopted, and with them the fact
     * that the person wrote and the account that reads the chat. Returns whether the row is new.
     */
    async knowChat(project: string, channel: MessengerChannel, chatId: string, o: KnownChat = {}): Promise<boolean> {
      return write(db, (tx) => {
        const had = tx.select({ id: messengerChats.id, title: messengerChats.title, username: messengerChats.username, phone: messengerChats.phone, profileName: messengerChats.profileName }).from(messengerChats).where(chatKey(project, channel, chatId)).get();
        const username = o.username?.trim().replace(/^@/, "") || null;
        const digits = o.phone?.replace(/\D/g, "") || null;
        const phone = digits && digits.length >= 7 ? digits : null;
        const profileName = o.profileName?.trim() || null;
        if (!had) {
          tx.insert(messengerChats).values({ project, channel, chatId, title: o.title?.trim() || null, autolinked: o.autolinked ?? null, username, phone, profileName }).run();
        } else {
          const set = {
            ...(o.title?.trim() && (o.forceTitle || !had.title) ? { title: o.title.trim() } : {}),
            ...(o.autolinked !== undefined ? { autolinked: o.autolinked } : {}),
            ...(username && !had.username ? { username } : {}),
            ...(phone && !had.phone ? { phone } : {}),
            ...(profileName && profileName !== had.profileName ? { profileName } : {}),
          };
          // An UPDATE fires the live trigger: only a change is written.
          if (Object.keys(set).length) tx.update(messengerChats).set(set).where(chatKey(project, channel, chatId)).run();
        }
        const lastIn = tx.select({ at: sql<string | null>`max(${messengerMessages.sentAt})` }).from(messengerMessages).where(and(msgsOf(project, channel, chatId), eq(messengerMessages.direction, "in"))).get()?.at ?? null;
        const reader = tx.select({ account: messengerMessages.account }).from(messengerMessages).where(msgsOf(project, channel, chatId)).orderBy(sql`(${messengerMessages.direction} = 'in') desc`, desc(messengerMessages.sentAt)).get()?.account ?? null;
        noteFact(tx, project, channel, chatId, { inboundAt: lastIn, account: reader });
        return !had;
      });
    },
    /**
     * P141 U2: the chats of a channel whose inbound messages were cached before a known row existed (WhatsApp's W2 cache, before U2):
     * their ids, so the server makes their rows once. Read only.
     */
    async cachedWithoutRow(project: string, channel: MessengerChannel): Promise<string[]> {
      return db
        .selectDistinct({ chatId: messengerMessages.chatId })
        .from(messengerMessages)
        .where(and(eq(messengerMessages.project, project), eq(messengerMessages.channel, channel), eq(messengerMessages.direction, "in"), sql`not exists (select 1 from messenger_chats c where c.project = messenger_messages.project and c.channel = messenger_messages.channel and c.chat_id = messenger_messages.chat_id)`))
        .all()
        .map((r) => r.chatId);
    },
    /** What ingest observed of a known chat; nothing when the chat is not known. Returns whether a row changed. */
    async noteChatFact(project: string, channel: MessengerChannel, chatId: string, f: ChatFact): Promise<boolean> {
      return write(db, (tx) => noteFact(tx, project, channel, chatId, f));
    },
    /** Whether a cached inbound message of the chat exists (a chat with no row included). */
    async hasCachedInbound(project: string, channel: MessengerChannel, chatId: string): Promise<boolean> {
      return !!db.select({ id: messengerMessages.id }).from(messengerMessages).where(and(msgsOf(project, channel, chatId), eq(messengerMessages.direction, "in"))).get();
    },
    /** An edit (WhatsApp's `editedMessage`) replaces the text of the stored row; false when no such row is cached. */
    async editMessageText(project: string, channel: MessengerChannel, chatId: string, remoteMessageId: string, text: string): Promise<boolean> {
      // The same text again is no edit: no write, no `live_*` bump.
      return db.update(messengerMessages).set({ text }).where(and(msgsOf(project, channel, chatId), eq(messengerMessages.remoteMessageId, remoteMessageId), sql`${messengerMessages.text} is not ${text}`)).run().changes > 0;
    },
    /** The chat's oldest cached message, or null: the anchor of WhatsApp's on-demand history, which answers only what came before it. */
    async oldestMessage(project: string, channel: MessengerChannel, chatId: string): Promise<MessengerMessage | null> {
      return db.select().from(messengerMessages).where(msgsOf(project, channel, chatId)).orderBy(asc(messengerMessages.sentAt), asc(messengerMessages.id)).get() ?? null;
    },
  };
}

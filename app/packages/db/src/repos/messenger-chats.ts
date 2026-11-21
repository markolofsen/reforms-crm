import { and, desc, eq, sql } from "drizzle-orm";
import { chatRulesProblem, type ChatRules } from "@hub/config/chat-rules";
import type { Db } from "../client";
import { RepoError } from "../errors";
import { messengerChats, messengerDrafts, messengerMessages, type MessengerChannel } from "../schema";
import { write } from "../tx";

export type MessengerChatRow = typeof messengerChats.$inferSelect;

/** What a chat holds that its rules are judged against (P71 M2b): the newest inbound and outbound row, and the count of inbound. */
export interface ChatActivity {
  inbound: number;
  lastInAt: string | null;
  lastOutAt: string | null;
}

const now = () => new Date().toISOString();

/** The rules of a chat row, in the shape `@hub/config/chat-rules` names. */
export const rulesOf = (r: MessengerChatRow): ChatRules => ({ replyMode: r.replyMode, mayNudge: r.mayNudge, nudgeAfterDays: r.nudgeAfterDays, instruction: r.instruction, language: r.language, prefilter: r.prefilter });

/**
 * The linked chats themselves (P71 M2b): their rules, what they hold, and unlinking. Every query names the project, so a chat
 * of another project reads as no chat at all (decision 0036 point 3: nothing of it is named).
 */
export function messengerChatsRepo(db: Db) {
  const key = (project: string, channel: MessengerChannel, chatId: string) => and(eq(messengerChats.project, project), eq(messengerChats.channel, channel), eq(messengerChats.chatId, chatId));
  const msgsOf = (project: string, channel: MessengerChannel, chatId: string) => and(eq(messengerMessages.project, project), eq(messengerMessages.channel, channel), eq(messengerMessages.chatId, chatId));
  const draftsOf = (project: string, channel: MessengerChannel, chatId: string) => and(eq(messengerDrafts.project, project), eq(messengerDrafts.channel, channel), eq(messengerDrafts.chatId, chatId));

  return {
    /** The linked chat, or null when it is not on this project's allow-list. */
    async chat(project: string, channel: MessengerChannel, chatId: string): Promise<MessengerChatRow | null> {
      return db.select().from(messengerChats).where(key(project, channel, chatId)).get() ?? null;
    },

    /** The linked chat by its row id (the `chat:<id>` ref, P71 M3), or null when it is not this project's. */
    async chatById(project: string, id: number): Promise<MessengerChatRow | null> {
      return db.select().from(messengerChats).where(and(eq(messengerChats.project, project), eq(messengerChats.id, id))).get() ?? null;
    },

    /**
     * The owner's rules for one linked chat (Messengers ▸ Settings in M3; tests). `invalid` when a value is out of bounds (the
     * migration's CHECKs say the same), `not_found` when the chat is not linked: a rule never creates a chat row.
     */
    async setChatRules(project: string, channel: MessengerChannel, chatId: string, patch: Partial<ChatRules>, at: string = now()): Promise<MessengerChatRow> {
      const problem = chatRulesProblem(patch);
      if (problem) throw new RepoError("invalid", `invalid: ${problem}`);
      const set = {
        ...(patch.replyMode !== undefined ? { replyMode: patch.replyMode } : {}),
        ...(patch.mayNudge !== undefined ? { mayNudge: patch.mayNudge } : {}),
        ...(patch.nudgeAfterDays !== undefined ? { nudgeAfterDays: patch.nudgeAfterDays } : {}),
        ...(patch.instruction !== undefined ? { instruction: patch.instruction?.trim() || null } : {}),
        ...(patch.language !== undefined ? { language: patch.language || null } : {}),
        ...(patch.prefilter !== undefined ? { prefilter: patch.prefilter } : {}),
        rulesUpdatedAt: at,
      };
      const row = db.update(messengerChats).set(set).where(key(project, channel, chatId)).returning().get();
      if (!row) throw new RepoError("not_found", `not_found: ${channel} chat ${chatId} is not linked in "${project}"`);
      return row;
    },

    async activity(project: string, channel: MessengerChannel, chatId: string): Promise<ChatActivity> {
      const r = db
        .select({
          inbound: sql<number>`coalesce(sum(case when ${messengerMessages.direction} = 'in' then 1 else 0 end), 0)`,
          lastInAt: sql<string | null>`max(case when ${messengerMessages.direction} = 'in' then ${messengerMessages.sentAt} end)`,
          lastOutAt: sql<string | null>`max(case when ${messengerMessages.direction} = 'out' then ${messengerMessages.sentAt} end)`,
        })
        .from(messengerMessages)
        .where(msgsOf(project, channel, chatId))
        .get();
      return { inbound: Number(r?.inbound ?? 0), lastInAt: r?.lastInAt ?? null, lastOutAt: r?.lastOutAt ?? null };
    },

    /** P102: every stored message of the chat, either side: what Unlink would delete, said in its sentence. */
    async messageCount(project: string, channel: MessengerChannel, chatId: string): Promise<number> {
      return Number(db.select({ n: sql<number>`count(*)` }).from(messengerMessages).where(msgsOf(project, channel, chatId)).get()?.n ?? 0);
    },

    /** The newest draft of the chat still waiting for the owner (status `draft`), or null. */
    async openDraft(project: string, channel: MessengerChannel, chatId: string) {
      return db.select().from(messengerDrafts).where(and(draftsOf(project, channel, chatId), eq(messengerDrafts.status, "draft"))).orderBy(desc(messengerDrafts.id)).get() ?? null;
    },

    /** A new text for a draft that still waits (status `draft`); `wrong_state` once the owner acted on it. */
    async reviseDraft(project: string, id: number, text: string, extra: { ownerRequest?: string | null; nudge?: boolean } = {}, at: string = now()) {
      const row = db
        .update(messengerDrafts)
        .set({ text, updatedAt: at, ...(extra.ownerRequest !== undefined ? { ownerRequest: extra.ownerRequest } : {}), ...(extra.nudge !== undefined ? { nudge: extra.nudge } : {}) })
        .where(and(eq(messengerDrafts.id, id), eq(messengerDrafts.project, project), eq(messengerDrafts.status, "draft")))
        .returning()
        .get();
      if (row) return row;
      const cur = db.select({ status: messengerDrafts.status }).from(messengerDrafts).where(and(eq(messengerDrafts.id, id), eq(messengerDrafts.project, project))).get();
      if (!cur) throw new RepoError("not_found", `not_found: draft ${id}`);
      throw new RepoError("wrong_state", `wrong_state: draft ${id} is "${cur.status}", expected "draft"`);
    },

    /**
     * Unlinking (research 26 gap 1): the chat row, its stored messages and its drafts go in ONE transaction, so an unlinked chat
     * leaves no row, as one never linked (0036 point 3). Returns whether the chat was linked.
     */
    async unlinkChat(project: string, channel: MessengerChannel, chatId: string): Promise<{ removed: boolean; messages: number; drafts: number }> {
      return write(db, (tx) => {
        const messages = tx.delete(messengerMessages).where(msgsOf(project, channel, chatId)).run().changes;
        const drafts = tx.delete(messengerDrafts).where(draftsOf(project, channel, chatId)).run().changes;
        const removed = tx.delete(messengerChats).where(key(project, channel, chatId)).run().changes > 0;
        return { removed, messages, drafts };
      });
    },
  };
}

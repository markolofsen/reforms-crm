import { and, asc, desc, eq, sql } from "drizzle-orm";
import { chatRulesProblem, type ChatRules } from "@hub/config/chat-rules";
import type { Db } from "../client";
import { RepoError } from "../errors";
import { clientIdentifiers, messengerChats, messengerDrafts, messengerMessages, type MessengerChannel } from "../schema";
import { write } from "../tx";

export type MessengerChatRow = typeof messengerChats.$inferSelect;

/** The identifier kind that links a chat of this channel to a client (decision 0049: linking names the client). */
export const linkKindOf = (channel: MessengerChannel): "whatsapp" | "telegram" => (channel === "whatsapp" ? "whatsapp" : "telegram");

/**
 * Decision 0049 (P141 U2): a `messenger_chats` row is a KNOWN chat; it is LINKED when a client identifier names it. The one SQL
 * definition of "linked", for a query over `messenger_chats` (literal table names: rule 15).
 */
export const linkedSql = sql<boolean>`exists (select 1 from client_identifiers ci where ci.project = messenger_chats.project and ci.kind = (case when messenger_chats.channel = 'whatsapp' then 'whatsapp' else 'telegram' end) and ci.value = messenger_chats.chat_id)`;

/** What a chat holds that its rules are judged against (P71 M2b): the newest inbound and outbound row, and the count of inbound. */
export interface ChatActivity {
  /** Inbound messages in the cache now (decision 0049: it expires). */
  inbound: number;
  /** The newest inbound message: the cached one, or the chat row's `last_inbound_at` when that is newer (it outlives the cache). Null: the person never wrote. */
  lastInAt: string | null;
  lastOutAt: string | null;
}

const now = () => new Date().toISOString();

/** P143 D1: the chat was marked done through this inbound message's time or a later one (the next inbound message reopens it). Pure. */
export const isDoneThrough = (r: Pick<MessengerChatRow, "doneThrough">, lastInAt: string | null | undefined): boolean => !!r.doneThrough && !!lastInAt && lastInAt <= r.doneThrough;

/** The rules of a chat row, in the shape `@hub/config/chat-rules` names. */
export const rulesOf = (r: MessengerChatRow): ChatRules => ({ replyMode: r.replyMode, instruction: r.instruction, language: r.language, prefilter: r.prefilter });

/**
 * The known chats themselves (P71 M2b, decision 0049): their rules, what they hold, and forgetting one. Every query names the
 * project, so a chat of another project reads as no chat at all.
 */
export function messengerChatsRepo(db: Db) {
  const key = (project: string, channel: MessengerChannel, chatId: string) => and(eq(messengerChats.project, project), eq(messengerChats.channel, channel), eq(messengerChats.chatId, chatId));
  const msgsOf = (project: string, channel: MessengerChannel, chatId: string) => and(eq(messengerMessages.project, project), eq(messengerMessages.channel, channel), eq(messengerMessages.chatId, chatId));
  const draftsOf = (project: string, channel: MessengerChannel, chatId: string) => and(eq(messengerDrafts.project, project), eq(messengerDrafts.channel, channel), eq(messengerDrafts.chatId, chatId));

  return {
    /** Decision 0049 (P141 U2): the project knows the chat (it wrote, or the owner linked it): its messages are cached, it opens. */
    async isKnown(project: string, channel: MessengerChannel, chatId: string): Promise<boolean> {
      return !!db
        .select({ id: messengerChats.id })
        .from(messengerChats)
        .where(and(eq(messengerChats.project, project), eq(messengerChats.channel, channel), eq(messengerChats.chatId, chatId)))
        .get();
    },
    /** Decision 0049: the chat is linked: a client identifier names it (the autolink's "already linked", the autopilot, background runs). */
    async isLinked(project: string, channel: MessengerChannel, chatId: string): Promise<boolean> {
      return !!db
        .select({ id: clientIdentifiers.id })
        .from(clientIdentifiers)
        .where(and(eq(clientIdentifiers.project, project), eq(clientIdentifiers.kind, linkKindOf(channel)), eq(clientIdentifiers.value, chatId)))
        .get();
    },
    /** Every known chat of the project with whether it is linked, oldest row first. */
    async knownChats(project: string): Promise<(typeof messengerChats.$inferSelect & { linked: boolean })[]> {
      return db
        .select({ row: messengerChats, linked: linkedSql })
        .from(messengerChats)
        .where(eq(messengerChats.project, project))
        .orderBy(asc(messengerChats.id))
        .all()
        .map((r) => ({ ...r.row, linked: Boolean(r.linked) }));
    },

    /** The known chat (linked or not), or null when this project does not know it. */
    async chat(project: string, channel: MessengerChannel, chatId: string): Promise<MessengerChatRow | null> {
      return db.select().from(messengerChats).where(key(project, channel, chatId)).get() ?? null;
    },

    /** The known chat by its row id (the `chat:<id>` ref, P71 M3), or null when it is not this project's. */
    async chatById(project: string, id: number): Promise<MessengerChatRow | null> {
      return db.select().from(messengerChats).where(and(eq(messengerChats.project, project), eq(messengerChats.id, id))).get() ?? null;
    },

    /**
     * The owner's rules for one linked chat (Settings ▸ Messengers in M3; tests). `invalid` when a value is out of bounds (the
     * migration's CHECKs say the same), `not_found` when the chat is not known: a rule never creates a chat row.
     */
    async setChatRules(project: string, channel: MessengerChannel, chatId: string, patch: Partial<ChatRules>, at: string = now()): Promise<MessengerChatRow> {
      const problem = chatRulesProblem(patch);
      if (problem) throw new RepoError("invalid", `invalid: ${problem}`);
      const set = {
        ...(patch.replyMode !== undefined ? { replyMode: patch.replyMode } : {}),
        ...(patch.instruction !== undefined ? { instruction: patch.instruction?.trim() || null } : {}),
        ...(patch.language !== undefined ? { language: patch.language || null } : {}),
        ...(patch.prefilter !== undefined ? { prefilter: patch.prefilter } : {}),
        rulesUpdatedAt: at,
      };
      const row = db.update(messengerChats).set(set).where(key(project, channel, chatId)).returning().get();
      if (!row) throw new RepoError("not_found", `not_found: ${channel} chat ${chatId} is not linked in "${project}"`);
      return row;
    },

    /**
     * Decision 0048 point 5 (P139): pauses the chat's autopilot with a reason code (`PAUSING_REASONS`), or clears the pause
     * (`reason` null: the owner switched the chat on again). A pause only stops autopilot; nothing here can start it. Returns
     * the row, or null when the chat is not known in this project.
     */
    async setAutopilotPause(project: string, channel: MessengerChannel, chatId: string, reason: string | null, at: string = now()): Promise<MessengerChatRow | null> {
      const set = reason === null ? { autopilotPausedAt: null, autopilotPausedReason: null } : { autopilotPausedAt: at, autopilotPausedReason: reason };
      return db.update(messengerChats).set(set).where(key(project, channel, chatId)).returning().get() ?? null;
    },

    /**
     * P143 D1: the chat needs no reply: it is closed through its newest inbound message (that message's own time), so the next one
     * reopens it. Returns the row, or null when the chat is not this project's or the person never wrote (nothing to close).
     */
    async markDone(project: string, id: number, o: { by: "owner" | "agent"; reason?: string | null; at?: string }): Promise<MessengerChatRow | null> {
      const row = db.select().from(messengerChats).where(and(eq(messengerChats.project, project), eq(messengerChats.id, id))).get();
      if (!row) return null;
      const lastIn = db.select({ at: sql<string | null>`max(${messengerMessages.sentAt})` }).from(messengerMessages).where(and(msgsOf(project, row.channel, row.chatId), eq(messengerMessages.direction, "in"))).get()?.at ?? null;
      const through = [lastIn, row.lastInboundAt].filter((x): x is string => !!x).sort().at(-1) ?? null;
      if (!through) return null;
      return db.update(messengerChats).set({ doneAt: o.at ?? now(), doneThrough: through, doneBy: o.by, doneReason: o.reason?.trim().slice(0, 300) || null }).where(eq(messengerChats.id, row.id)).returning().get() ?? null;
    },

    /** P143 D2: Undo of Done: the chat needs the owner again (null when it is not this project's). */
    async reopen(project: string, id: number): Promise<MessengerChatRow | null> {
      return db.update(messengerChats).set({ doneAt: null, doneThrough: null, doneBy: null, doneReason: null }).where(and(eq(messengerChats.project, project), eq(messengerChats.id, id))).returning().get() ?? null;
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
      // Decision 0049 (P141 W4): the chat row's `last_inbound_at` outlives the cache, so a client who wrote 31 days ago still wrote.
      // P142: `last_outbound_at` is its mirror, so "we wrote last" outlives the cache too.
      const fact = db.select({ at: messengerChats.lastInboundAt, out: messengerChats.lastOutboundAt }).from(messengerChats).where(key(project, channel, chatId)).get();
      const later = (a: string | null | undefined, b: string | null | undefined) => (!a ? (b ?? null) : !b ? a : a > b ? a : b);
      return { inbound: Number(r?.inbound ?? 0), lastInAt: later(fact?.at, r?.lastInAt), lastOutAt: later(fact?.out, r?.lastOutAt) };
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
    async reviseDraft(project: string, id: number, text: string, extra: { ownerRequest?: string | null; nudge?: boolean; createdBy?: string } = {}, at: string = now()) {
      const row = db
        .update(messengerDrafts)
        // `createdBy` follows the last writer (decision 0048, verdict 29): the owner's edit of autopilot's draft makes it his.
        .set({ text, updatedAt: at, ...(extra.ownerRequest !== undefined ? { ownerRequest: extra.ownerRequest } : {}), ...(extra.nudge !== undefined ? { nudge: extra.nudge } : {}), ...(extra.createdBy !== undefined ? { createdBy: extra.createdBy } : {}) })
        .where(and(eq(messengerDrafts.id, id), eq(messengerDrafts.project, project), eq(messengerDrafts.status, "draft")))
        .returning()
        .get();
      if (row) return row;
      const cur = db.select({ status: messengerDrafts.status }).from(messengerDrafts).where(and(eq(messengerDrafts.id, id), eq(messengerDrafts.project, project))).get();
      if (!cur) throw new RepoError("not_found", `not_found: draft ${id}`);
      throw new RepoError("wrong_state", `wrong_state: draft ${id} is "${cur.status}", expected "draft"`);
    },

    /**
     * Forgetting a chat (Hide "not a client", Never link, the CLI's remove; research 26 gap 1): the chat row, its cached messages and
     * its drafts go in ONE transaction, so the chat leaves no row. Unlink does not forget: it drops only the identifier (decision 0049
     * point 10). Returns whether the chat was known.
     */
    async forgetChat(project: string, channel: MessengerChannel, chatId: string): Promise<{ removed: boolean; messages: number; drafts: number }> {
      return write(db, (tx) => {
        const messages = tx.delete(messengerMessages).where(msgsOf(project, channel, chatId)).run().changes;
        const drafts = tx.delete(messengerDrafts).where(draftsOf(project, channel, chatId)).run().changes;
        const removed = tx.delete(messengerChats).where(key(project, channel, chatId)).run().changes > 0;
        return { removed, messages, drafts };
      });
    },
  };
}

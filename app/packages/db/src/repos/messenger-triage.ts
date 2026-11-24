import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { HIDDEN_LABELS, isHiddenLabel, type HiddenLabel, type TriageVerdict } from "@hub/config/chat-rules";
import type { Db } from "../client";
import { messengerChats, messengerMessages, messengerTriage, type MessengerChannel } from "../schema";
import { linkedSql } from "./messenger-chats";
import { write } from "../tx";

export type MessengerMessageOf = typeof messengerMessages.$inferSelect;
export interface NewTriage {
  messageId: number;
  verdict: TriageVerdict;
  model: string | null;
  promptVersion: number;
}
/** One chat's verdicts by reason: what is hidden from the agent, what could not be judged, and how many were judged at all. */
export interface TriageCounts {
  judged: number;
  hidden: Record<HiddenLabel, number>;
  unjudged: number;
}

const zeroHidden = (): Record<HiddenLabel, number> => Object.fromEntries(HIDDEN_LABELS.map((l) => [l, 0])) as Record<HiddenLabel, number>;

/**
 * The pre-analysis' rows (P71 M-P, decision 0039). A verdict exists only for an inbound text message of a linked chat whose
 * `prefilter` is on; it is deleted with its message (the FK cascades, so the purge and `forgetChat` take it along); decision 0049 point 10: an unlinked known chat is never judged. Every query
 * names the project.
 */
export function messengerTriageRepo(db: Db) {
  const m = messengerMessages;
  return {
    /**
     * What the next pass judges: inbound text messages sent at or after `since`, in this project's linked chats with `prefilter` on,
     * with no verdict yet; oldest first, at most `limit`. Our own messages (`out`) and media are never judged.
     */
    async pendingTriage(project: string, o: { since: string; limit: number }): Promise<MessengerMessageOf[]> {
      return db
        .select({ msg: m })
        .from(m)
        .innerJoin(messengerChats, and(eq(messengerChats.project, m.project), eq(messengerChats.channel, m.channel), eq(messengerChats.chatId, m.chatId)))
        .leftJoin(messengerTriage, eq(messengerTriage.messageId, m.id))
        .where(and(eq(m.project, project), eq(messengerChats.prefilter, true), linkedSql, eq(m.direction, "in"), eq(m.kind, "text"), sql`trim(${m.text}) <> ''`, gte(m.sentAt, o.since), isNull(messengerTriage.id)))
        .orderBy(m.sentAt, m.id)
        .limit(o.limit)
        .all()
        .map((r) => r.msg);
    },

    /** The `n` messages of the chat just before one message (either side), newest first: the context a verdict is not about. */
    async contextBefore(project: string, msg: Pick<MessengerMessageOf, "id" | "channel" | "chatId" | "sentAt">, n: number): Promise<MessengerMessageOf[]> {
      return db
        .select()
        .from(m)
        .where(and(eq(m.project, project), eq(m.channel, msg.channel), eq(m.chatId, msg.chatId), or(lt(m.sentAt, msg.sentAt), and(eq(m.sentAt, msg.sentAt), lt(m.id, msg.id)))))
        .orderBy(desc(m.sentAt), desc(m.id))
        .limit(n)
        .all();
    },

    /** Stores verdicts; a message of another project, or one judged already, is skipped. Returns how many were written. */
    async recordTriage(project: string, rows: NewTriage[]): Promise<number> {
      if (rows.length === 0) return 0;
      return write(db, (tx) => {
        const mine = new Set(
          tx
            .select({ id: m.id })
            .from(m)
            .where(and(eq(m.project, project), inArray(m.id, rows.map((r) => r.messageId))))
            .all()
            .map((r) => r.id),
        );
        let n = 0;
        for (const r of rows) {
          if (!mine.has(r.messageId)) continue;
          n += tx.insert(messengerTriage).values({ project, messageId: r.messageId, verdict: r.verdict, model: r.model, promptVersion: r.promptVersion }).onConflictDoNothing().run().changes;
        }
        return n;
      });
    },

    /** The verdict of each given message of this project that has one. */
    async verdictsOf(project: string, messageIds: number[]): Promise<Map<number, TriageVerdict>> {
      if (messageIds.length === 0) return new Map();
      const rows = db
        .select({ id: messengerTriage.messageId, verdict: messengerTriage.verdict })
        .from(messengerTriage)
        .where(and(eq(messengerTriage.project, project), inArray(messengerTriage.messageId, messageIds)))
        .all();
      return new Map(rows.map((r) => [r.id, r.verdict]));
    },

    /** One chat's counts by reason over its stored messages. */
    async triageCounts(project: string, channel: MessengerChannel, chatId: string): Promise<TriageCounts> {
      const rows = db
        .select({ verdict: messengerTriage.verdict, n: sql<number>`count(*)` })
        .from(messengerTriage)
        .innerJoin(m, eq(m.id, messengerTriage.messageId))
        .where(and(eq(messengerTriage.project, project), eq(m.channel, channel), eq(m.chatId, chatId)))
        .groupBy(messengerTriage.verdict)
        .all();
      const out: TriageCounts = { judged: 0, hidden: zeroHidden(), unjudged: 0 };
      for (const r of rows) {
        const n = Number(r.n);
        if (r.verdict === "unjudged") out.unjudged += n;
        else out.judged += n;
        if (isHiddenLabel(r.verdict)) out.hidden[r.verdict] += n;
      }
      return out;
    },
  };
}

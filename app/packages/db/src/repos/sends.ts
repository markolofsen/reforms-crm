import { and, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { MARKS, type Mark, type SafetyResult } from "@hub/config";
import type { Db } from "../client";
import { RepoError } from "../errors";
import { evaluateSafety } from "../safety";
import { clients, drafts, marks, sendControl, sendLog, type SendStatus } from "../schema";
import { loadRules, nowIso, parseJson } from "./bulk-shared";
import { write } from "../tx";

export type SendRow = typeof sendLog.$inferSelect;
export type DraftRow = typeof drafts.$inferSelect;

/** What a send attempt records. `body` is the full text; nothing is truncated. */
export type NewSend = {
  project: string;
  draftId: number;
  mode: "manual" | "auto";
  /** `sending` for a manual send, `queued` for an autosend that waits out its window (then `dueAt` is required). */
  status: "sending" | "queued";
  actor: string;
  /** When the attempt started; default now. A runner passes its own clock so the daily cap and the window agree with it. */
  at?: string;
  dueAt?: string | null;
  sender?: string | null;
  to: string;
  cc?: string | null;
  bcc?: string | null;
  subject: string;
  body: string;
  mailRef?: string | null;
};

const isUnique = (e: unknown) => e instanceof Error && /UNIQUE constraint/i.test(e.message);
const LIVE: SendStatus[] = ["queued", "sending", "sent"];

/**
 * The send audit and the Stop all switch (decision 0011). Only the hub's `hub send` calls the writers; the agent has
 * no path here. Nothing writes `drafts.status`: Mail's Sent folder is still the one source of "sent", read by the reconciler.
 */
export function sendsRepo(db: Db) {
  const row = (id: number) => db.select().from(sendLog).where(eq(sendLog.id, id)).get() ?? null;

  return {
    async get(id: number): Promise<SendRow | null> {
      return row(id);
    },

    /** Rows of a draft, newest first. */
    async forDraft(draftId: number): Promise<SendRow[]> {
      return db.select().from(sendLog).where(eq(sendLog.draftId, draftId)).orderBy(sql`${sendLog.id} desc`).all();
    },

    /** The project's rows, newest first (the Send screen). */
    async list(project: string, limit = 100): Promise<SendRow[]> {
      return db.select().from(sendLog).where(eq(sendLog.project, project)).orderBy(sql`${sendLog.id} desc`).limit(limit).all();
    },

    /** Starts an attempt. `wrong_state` when the draft already has a queued, sending or sent row: no second send. */
    async begin(input: NewSend): Promise<SendRow> {
      if (input.status === "queued" && !input.dueAt) throw new RepoError("wrong_state", "A queued send needs a due time");
      return write(db, (tx) => {
        try {
          return tx
            .insert(sendLog)
            .values({
              project: input.project,
              draftId: input.draftId,
              mode: input.mode,
              status: input.status,
              actor: input.actor,
              ...(input.at ? { createdAt: input.at } : {}),
              dueAt: input.dueAt ?? null,
              sender: input.sender ?? null,
              toAddr: input.to,
              ccAddr: input.cc ?? null,
              bccAddr: input.bcc ?? null,
              subject: input.subject,
              body: input.body,
              mailRef: input.mailRef ?? null,
            })
            .returning()
            .get();
        } catch (e) {
          if (isUnique(e)) throw new RepoError("wrong_state", "This draft is already queued, being sent or sent");
          throw e;
        }
      });
    },

    /** queued -> sending, once, for whoever gets there first. Null when it is no longer queued (cancelled, or another runner took it). */
    async claim(id: number): Promise<SendRow | null> {
      return write(db, (tx) => tx.update(sendLog).set({ status: "sending" }).where(and(eq(sendLog.id, id), eq(sendLog.status, "queued"))).returning().get() ?? null);
    },

    /**
     * Finishes a send the hub made. The draft it came from becomes `sent` in the same transaction (P27 M4.1): the queue
     * must not offer a draft that went out. `sent` is still written only here and by the Sent-folder reader, never by a route.
     */
    async markSent(id: number, messageId: string | null): Promise<SendRow | null> {
      return write(db, (tx) => {
        const at = nowIso();
        const row = tx.update(sendLog).set({ status: "sent", sentMessageId: messageId, doneAt: at, error: null }).where(and(eq(sendLog.id, id), eq(sendLog.status, "sending"))).returning().get() ?? null;
        if (row?.draftId != null) {
          tx.update(drafts)
            .set({ status: "sent", sentAt: at, sentVia: "hub", sentMessageId: messageId, prevStatus: null, prevChecked: null, actedAt: at, updatedAt: at })
            .where(and(eq(drafts.id, row.draftId), inArray(drafts.status, ["ready", "hold", "done"])))
            .run();
        }
        return row;
      });
    },

    async markFailed(id: number, error: string): Promise<SendRow | null> {
      return write(db, (tx) => tx.update(sendLog).set({ status: "failed", error: error.slice(0, 1000), doneAt: nowIso() }).where(and(eq(sendLog.id, id), inArray(sendLog.status, ["queued", "sending"]))).returning().get() ?? null);
    },

    /** Cancels a queued send (the window). A row already sending or sent cannot be cancelled: a sent mail cannot be recalled. */
    async cancel(id: number, why = "cancelled"): Promise<SendRow | null> {
      return write(db, (tx) => tx.update(sendLog).set({ status: "cancelled", error: why, doneAt: nowIso() }).where(and(eq(sendLog.id, id), eq(sendLog.status, "queued"))).returning().get() ?? null);
    },

    /** Queued rows whose window is over, oldest first. */
    async due(now: string, project?: string): Promise<SendRow[]> {
      const where = and(eq(sendLog.status, "queued"), lte(sendLog.dueAt, now), ...(project ? [eq(sendLog.project, project)] : []));
      return db.select().from(sendLog).where(where).orderBy(sendLog.dueAt).all();
    },

    async queued(project?: string): Promise<SendRow[]> {
      return db.select().from(sendLog).where(and(eq(sendLog.status, "queued"), ...(project ? [eq(sendLog.project, project)] : []))).orderBy(sendLog.dueAt).all();
    },

    /** Attempts that count against the daily cap: queued, sending and sent, autosends only, since `since`. */
    async autoCountSince(project: string, since: string): Promise<number> {
      const r = db
        .select({ n: sql<number>`count(*)` })
        .from(sendLog)
        .where(and(eq(sendLog.project, project), eq(sendLog.mode, "auto"), inArray(sendLog.status, LIVE), gte(sendLog.createdAt, since)))
        .get();
      return r?.n ?? 0;
    },

    /**
     * The Overview's send numbers for one project, all from `send_log`: `sentToday` (status sent, manual and auto, made
     * since `today`), `failed` (failed since `day`) and `stuck` (still `sending` and older than `stuckBefore`: a crash
     * left it, and it blocks a second send of that draft until a person looks).
     */
    async summarySince(project: string, o: { today: string; day: string; stuckBefore: string }): Promise<{ sentToday: number; failed: number; stuck: number }> {
      const recent = db
        .select({
          sentToday: sql<number>`coalesce(sum(case when ${sendLog.status} = 'sent' and ${sendLog.createdAt} >= ${o.today} then 1 else 0 end), 0)`,
          failed: sql<number>`coalesce(sum(case when ${sendLog.status} = 'failed' and ${sendLog.createdAt} >= ${o.day} then 1 else 0 end), 0)`,
        })
        .from(sendLog)
        .where(and(eq(sendLog.project, project), gte(sendLog.createdAt, o.today < o.day ? o.today : o.day)))
        .get();
      const stuck = db
        .select({ n: sql<number>`count(*)` })
        .from(sendLog)
        .where(and(eq(sendLog.project, project), eq(sendLog.status, "sending"), lte(sendLog.createdAt, o.stuckBefore)))
        .get();
      return { sentToday: recent?.sentToday ?? 0, failed: recent?.failed ?? 0, stuck: stuck?.n ?? 0 };
    },

    /** Stop all (`project` omitted: every project). Also cancels the queued rows in scope. Returns how many were cancelled. */
    async stop(project?: string): Promise<number> {
      return write(db, (tx) => {
        const scope = project ?? "*";
        tx.insert(sendControl).values({ project: scope, stopped: true }).onConflictDoUpdate({ target: sendControl.project, set: { stopped: true, updatedAt: nowIso() } }).run();
        const rows = tx
          .update(sendLog)
          .set({ status: "cancelled", error: "Stop all", doneAt: nowIso() })
          .where(and(eq(sendLog.status, "queued"), ...(project ? [eq(sendLog.project, project)] : [])))
          .returning({ id: sendLog.id })
          .all();
        return rows.length;
      });
    },

    async resume(project?: string): Promise<void> {
      write(db, (tx) => {
        tx.insert(sendControl).values({ project: project ?? "*", stopped: false }).onConflictDoUpdate({ target: sendControl.project, set: { stopped: false, updatedAt: nowIso() } }).run();
      });
    },

    /** True when Stop all is on for every project or for this one. */
    async isStopped(project: string): Promise<boolean> {
      const r = db.select().from(sendControl).where(and(inArray(sendControl.project, ["*", project]), eq(sendControl.stopped, true))).get();
      return !!r;
    },

    async stoppedScopes(): Promise<string[]> {
      return db.select({ p: sendControl.project }).from(sendControl).where(eq(sendControl.stopped, true)).all().map((r) => r.p);
    },

    /** Ready drafts of the project in the given mail classes, oldest first: the autosend candidates. */
    async readyOfClasses(project: string, classes: string[]): Promise<DraftRow[]> {
      if (classes.length === 0) return [];
      return db.select().from(drafts).where(and(eq(drafts.project, project), eq(drafts.status, "ready"), inArray(drafts.mailClass, classes))).orderBy(drafts.id).all();
    },

    /** What the send checks need beyond the draft row: the client's address and marks. Null when the draft is unknown. */
    async subject(draftId: number): Promise<{ draft: DraftRow; client: { id: number; email: string; repliesOwed: boolean; marks: Mark[] } } | null> {
      const d = db.select().from(drafts).where(eq(drafts.id, draftId)).get();
      if (!d) return null;
      const c = db.select().from(clients).where(eq(clients.id, d.clientId)).get();
      if (!c) return null;
      const m = db.select({ mark: marks.mark }).from(marks).where(eq(marks.clientId, c.id)).all().map((r) => r.mark);
      return { draft: d, client: { id: c.id, email: c.email, repliesOwed: c.repliesOwed, marks: m.filter((x): x is Mark => (MARKS as readonly string[]).includes(x)) } };
    },

    /**
     * The safety rules of the project run on the text that will really go out (the one in Mail, not the excerpt the
     * row holds). Results the person acknowledged on the draft keep their `acked` flag.
     */
    async safetyOf(draftId: number, actual: { subject: string; toAddr: string; ccAddr: string | null; body: string }, now: Date = new Date()): Promise<SafetyResult[]> {
      const s = await this.subject(draftId);
      if (!s) return [];
      const { draft, client } = s;
      const closed = db
        .select({ at: sql<string | null>`max(${drafts.actedAt})` })
        .from(drafts)
        .where(and(eq(drafts.clientId, client.id), or(eq(drafts.status, "done"), eq(drafts.status, "sent")), sql`${drafts.id} <> ${draftId}`))
        .get();
      return evaluateSafety(
        { draft: { ...actual, mailRef: draft.mailRef }, client, lastClosedAt: closed?.at ?? null, now },
        loadRules(db, draft.project),
        parseJson<string[]>(draft.acked, []),
      );
    },
  };
}

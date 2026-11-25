import { and, asc, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import type { Db } from "../client";
import { RepoError } from "../errors";
import { write } from "../tx";
import { agentEvents, agentRuns, clients } from "../schema";
import { timelineOf, type Activity, type TimelineQuery } from "./activity";

export type EventRow = typeof agentEvents.$inferSelect & { clientName: string | null };
export type NewRun = Omit<typeof agentRuns.$inferInsert, "id">;
export type NewEvent = Omit<typeof agentEvents.$inferInsert, "id" | "seq">;

type Tx = Pick<Db, "select" | "insert">;

/** How long `agent_events.detail` is kept. */
export const EVENT_DETAIL_DAYS = 90;

/** Sync core of `addEvent`, so a repository that already holds a transaction can log in the same one. */
export function insertEvent(tx: Tx, input: NewEvent): number {
  const last = tx
    .select({ m: sql<number>`coalesce(max(${agentEvents.seq}), 0)` })
    .from(agentEvents)
    .where(eq(agentEvents.runId, input.runId))
    .get();
  const seq = (last?.m ?? 0) + 1;
  tx.insert(agentEvents).values({ ...input, seq }).run();
  return seq;
}

/**
 * The run a `draft_write` / `client_record` call writes into: the one it names (of this project), else the run of its
 * session (same project and `batchKey`; its end moves to now), else a new one. So one session is one run.
 */
export function sessionRun(tx: Pick<Db, "select" | "insert" | "update">, o: { project: string; runId?: number | null; batchKey?: string | null; skill?: string | null; at: string }): number {
  if (o.runId != null) {
    if (!tx.select({ id: agentRuns.id }).from(agentRuns).where(and(eq(agentRuns.id, o.runId), eq(agentRuns.project, o.project))).get()) throw new RepoError("not_found", "No such run in this project");
    return o.runId;
  }
  const key = o.batchKey?.trim() || null;
  const same = key ? tx.select({ id: agentRuns.id }).from(agentRuns).where(and(eq(agentRuns.project, o.project), eq(agentRuns.batchKey, key))).orderBy(desc(agentRuns.id)).limit(1).get() : undefined;
  if (same) {
    tx.update(agentRuns).set({ finishedAt: o.at }).where(eq(agentRuns.id, same.id)).run();
    return same.id;
  }
  return tx.insert(agentRuns).values({ project: o.project, startedAt: o.at, finishedAt: o.at, trigger: "owner", skill: o.skill ?? null, status: "ok", batchKey: key }).returning({ id: agentRuns.id }).get().id;
}

/**
 * P154: one Activity line when the guard removed a vendor's instructions from a tool reply ("Notion · Removed an offer"), at
 * most one per session and tool: the run's `batchKey` names both, and a second call finds the run and writes nothing. Sync, so
 * the post hook (a short process) writes it on one short connection. Returns whether a line was written.
 */
export function recordCleanedReply(db: Db, o: { project: string; session: string; server: string; tool: string; label: string; at: string }): boolean {
  const key = `tool-reply:${o.session || "-"}:${o.server}:${o.tool}`;
  return write(db, (t) => {
    if (t.select({ id: agentRuns.id }).from(agentRuns).where(and(eq(agentRuns.project, o.project), eq(agentRuns.batchKey, key))).get()) return false;
    const runId = t.insert(agentRuns).values({ project: o.project, startedAt: o.at, finishedAt: o.at, trigger: "guard", skill: null, status: "ok", batchKey: key }).returning({ id: agentRuns.id }).get().id;
    insertEvent(t, { project: o.project, runId, at: o.at, kind: "decision", tool: null, summary: `Removed an offer: ${o.label}`, detail: JSON.stringify({ action: "tool_reply_cleaned", reason: `${o.tool}: the reply carried instructions for the assistant (an offer or a link to show); the Hub removed them, or told the agent to ignore them, before it answered.` }) });
    return true;
  });
}

export function runsRepo(db: Db) {
  return {
    async start(input: NewRun): Promise<number> {
      return db.insert(agentRuns).values(input).returning({ id: agentRuns.id }).get().id;
    },

    /** One run of this project (P72: the focus names `run:10`); null for another project's or a missing id. */
    async get(project: string, id: number): Promise<typeof agentRuns.$inferSelect | null> {
      return db.select().from(agentRuns).where(and(eq(agentRuns.id, id), eq(agentRuns.project, project))).get() ?? null;
    },
    async finish(id: number, patch: Partial<Pick<NewRun, "finishedAt" | "status" | "tokensIn" | "tokensOut" | "costUsd">>) {
      db.update(agentRuns).set(patch).where(eq(agentRuns.id, id)).run();
    },

    /**
     * Decision 0048 (P139 A6): the autopilot's turn rows since `since` (every project), oldest first, each with its event's
     * detail: the ledger of the turn budgets after a restart, and Overview's counts. A turn is one run of trigger `autopilot`.
     */
    async autopilotTurns(since: string): Promise<Array<{ project: string; startedAt: string; detail: string | null }>> {
      return db
        .select({ project: agentRuns.project, startedAt: agentRuns.startedAt, detail: agentEvents.detail })
        .from(agentRuns)
        .leftJoin(agentEvents, eq(agentEvents.runId, agentRuns.id))
        .where(and(eq(agentRuns.trigger, "autopilot"), gte(agentRuns.startedAt, since)))
        .orderBy(asc(agentRuns.startedAt))
        .all();
    },

    /** Appends an event; `seq` is the next number in the run (the gate writes events in order). */
    async addEvent(input: NewEvent): Promise<number> {
      return write(db, (tx) => insertEvent(tx, input));
    },

    /**
     * Retention (doc 10): `detail` is kept for `days` days, summaries forever. Clears `detail` of events older than
     * the cutoff and returns how many rows lost it. Idempotent; never deletes a row, so run history and costs stay.
     */
    async pruneDetail(days = EVENT_DETAIL_DAYS, now: Date = new Date()): Promise<number> {
      const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
      return db.update(agentEvents).set({ detail: null }).where(and(isNotNull(agentEvents.detail), lt(agentEvents.at, cutoff))).run().changes;
    },

    /** Activity (P73): the agent's client decisions, newest first, one page at a time; a view by outcome, optionally one client. */
    async activity(project: string, q: TimelineQuery = {}): Promise<Activity> {
      return timelineOf(db, project, q);
    },

    /** What the agent and the owner did for one client, newest first: the timeline that needs no mail login. */
    async eventsForClient(project: string, clientId: number, limit = 100): Promise<EventRow[]> {
      return db
        .select({
          id: agentEvents.id,
          project: agentEvents.project,
          runId: agentEvents.runId,
          seq: agentEvents.seq,
          at: agentEvents.at,
          kind: agentEvents.kind,
          tool: agentEvents.tool,
          summary: agentEvents.summary,
          detail: agentEvents.detail,
          clientId: agentEvents.clientId,
          clientName: clients.name,
        })
        .from(agentEvents)
        .leftJoin(clients, eq(clients.id, agentEvents.clientId))
        .where(and(eq(agentEvents.project, project), eq(agentEvents.clientId, clientId)))
        .orderBy(desc(agentEvents.at), desc(agentEvents.id))
        .limit(limit)
        .all();
    },

    async events(project: string, runId: number): Promise<EventRow[]> {
      return db
        .select({
          id: agentEvents.id,
          project: agentEvents.project,
          runId: agentEvents.runId,
          seq: agentEvents.seq,
          at: agentEvents.at,
          kind: agentEvents.kind,
          tool: agentEvents.tool,
          summary: agentEvents.summary,
          detail: agentEvents.detail,
          clientId: agentEvents.clientId,
          clientName: clients.name,
        })
        .from(agentEvents)
        .leftJoin(clients, eq(clients.id, agentEvents.clientId))
        .where(and(eq(agentEvents.project, project), eq(agentEvents.runId, runId)))
        .orderBy(asc(agentEvents.seq))
        .all();
    },
  };
}

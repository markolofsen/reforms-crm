import { and, asc, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { Db } from "../client";
import { write } from "../tx";
import { agentEvents, agentRuns, clients } from "../schema";

export type RunRow = typeof agentRuns.$inferSelect & { eventCount: number };
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

export function runsRepo(db: Db) {
  return {
    async start(input: NewRun): Promise<number> {
      return db.insert(agentRuns).values(input).returning({ id: agentRuns.id }).get().id;
    },

    async finish(id: number, patch: Partial<Pick<NewRun, "finishedAt" | "status" | "tokensIn" | "tokensOut" | "costUsd">>) {
      db.update(agentRuns).set(patch).where(eq(agentRuns.id, id)).run();
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

    async list(project: string, limit = 50): Promise<RunRow[]> {
      return db
        .select({
          id: agentRuns.id,
          project: agentRuns.project,
          startedAt: agentRuns.startedAt,
          finishedAt: agentRuns.finishedAt,
          trigger: agentRuns.trigger,
          skill: agentRuns.skill,
          model: agentRuns.model,
          status: agentRuns.status,
          tokensIn: agentRuns.tokensIn,
          tokensOut: agentRuns.tokensOut,
          costUsd: agentRuns.costUsd,
          // literal names: drizzle drops table qualifiers in a single-table select, which would make `id` ambiguous
          eventCount: sql<number>`(select count(*) from agent_events e where e.run_id = agent_runs.id)`,
        })
        .from(agentRuns)
        .where(eq(agentRuns.project, project))
        .orderBy(desc(agentRuns.startedAt))
        .limit(limit)
        .all();
    },

    /** Start time of the newest finished-or-running run of one of `skills` for the project, or null: what the Overview calls the last triage. */
    async lastStart(project: string, skills: string[]): Promise<string | null> {
      if (skills.length === 0) return null;
      const r = db
        .select({ at: agentRuns.startedAt })
        .from(agentRuns)
        .where(and(eq(agentRuns.project, project), inArray(agentRuns.skill, skills), inArray(agentRuns.status, ["ok", "needs_human"])))
        .orderBy(desc(agentRuns.startedAt))
        .limit(1)
        .get();
      return r?.at ?? null;
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

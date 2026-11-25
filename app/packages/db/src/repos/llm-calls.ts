import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { LLM_REFUSALS, monthStartUtc, type LlmOutcome } from "@hub/config/llm";
import type { Db } from "../client";
import { llmCalls } from "../schema";

/** One attempt as `@hub/llm` reports it (its `Ledger` shape): counts and money only, never text. */
export interface NewLlmCall {
  project: string;
  task: string;
  model: string | null;
  attempt: number;
  outcome: LlmOutcome;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  costMicroUsd: number;
  latencyMs: number;
  generationId: string | null;
  sourceKind: string | null;
}

/** The month so far (UTC), over every project: what the Overview's LLM part is judged from. */
export interface LlmMonth {
  /** Attempts that reached a model (refusals excluded). */
  calls: number;
  costMicroUsd: number;
  /** Refusals this month, by kind, and when the last one was written. */
  refused: Record<(typeof LLM_REFUSALS)[number], number>;
  lastRefusedAt: string | null;
  lastOkAt: string | null;
}

/** A poller refused every minute must not fill the table: one refusal row per project, task and kind in this window. */
export const REFUSAL_COALESCE_MS = 10 * 60_000;

const whole = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
const refusal = (o: LlmOutcome): boolean => LLM_REFUSALS.some((r) => r === o);

/** The ledger of `@hub/llm` (P78, decision 0039 point 4): a row per attempt, the month's spend, the Overview's standing. */
export function llmCallsRepo(db: Db) {
  return {
    /** Writes one attempt. A refusal repeated within `REFUSAL_COALESCE_MS` for the same project, task and kind is not written again. */
    async record(row: NewLlmCall, now: Date = new Date()): Promise<void> {
      if (refusal(row.outcome)) {
        const since = new Date(now.getTime() - REFUSAL_COALESCE_MS).toISOString();
        const recent = db
          .select({ id: llmCalls.id })
          .from(llmCalls)
          .where(and(eq(llmCalls.project, row.project), eq(llmCalls.task, row.task), eq(llmCalls.outcome, row.outcome), gte(llmCalls.createdAt, since)))
          .limit(1)
          .get();
        if (recent) return;
      }
      db.insert(llmCalls)
        .values({
          ...row,
          attempt: Math.max(1, Math.round(row.attempt)),
          tokensIn: whole(row.tokensIn),
          tokensOut: whole(row.tokensOut),
          tokensCached: whole(row.tokensCached),
          costMicroUsd: whole(row.costMicroUsd),
          latencyMs: whole(row.latencyMs),
          createdAt: now.toISOString(),
        })
        .run();
    },

    /**
     * Micro-dollars spent since the first of `now`'s month (UTC) over the rows the filter names: no filter is the whole instance
     * (the cap's sum), `project` one project's, `task` one task's (a task budget, decision 0051).
     */
    async monthCost(filter: { project?: string; task?: string } = {}, now: Date = new Date()): Promise<number> {
      const where = and(
        gte(llmCalls.createdAt, monthStartUtc(now)),
        filter.project === undefined ? undefined : eq(llmCalls.project, filter.project),
        filter.task === undefined ? undefined : eq(llmCalls.task, filter.task),
      );
      const r = db
        .select({ total: sql<number>`coalesce(sum(${llmCalls.costMicroUsd}), 0)` })
        .from(llmCalls)
        .where(where)
        .get();
      return r?.total ?? 0;
    },

    async month(now: Date = new Date()): Promise<LlmMonth> {
      const since = gte(llmCalls.createdAt, monthStartUtc(now));
      const rows = db
        .select({ outcome: llmCalls.outcome, n: sql<number>`count(*)`, cost: sql<number>`coalesce(sum(${llmCalls.costMicroUsd}), 0)` })
        .from(llmCalls)
        .where(since)
        .groupBy(llmCalls.outcome)
        .all();
      const last = (outcomes: LlmOutcome[]) =>
        db.select({ at: llmCalls.createdAt }).from(llmCalls).where(and(since, inArray(llmCalls.outcome, outcomes))).orderBy(desc(llmCalls.createdAt), desc(llmCalls.id)).limit(1).get()?.at ?? null;
      const count = (o: LlmOutcome) => rows.find((r) => r.outcome === o)?.n ?? 0;
      return {
        calls: rows.filter((r) => !refusal(r.outcome)).reduce((s, r) => s + r.n, 0),
        costMicroUsd: rows.reduce((s, r) => s + r.cost, 0),
        refused: { budget: count("budget"), no_key: count("no_key") },
        lastRefusedAt: last([...LLM_REFUSALS]),
        lastOkAt: last(["ok"]),
      };
    },
  };
}

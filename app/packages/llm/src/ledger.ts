import { monthStartUtc, type LlmOutcome } from "@hub/config/llm";

/**
 * Where every attempt is written (decision 0039 point 4). The package does not import `@hub/db` (it depends on `@hub/config` and
 * zod only): the caller passes the `llm_calls` repository of `@hub/db`, whose shape this is, or `memoryLedger` in a test.
 */
export interface LlmCallRecord {
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

export interface Ledger {
  record(row: LlmCallRecord, now?: Date): Promise<void>;
  /** Micro-dollars since the first of `now`'s month (UTC): one project's, or without one the instance's (the cap's sum). */
  monthCost(project?: string, now?: Date): Promise<number>;
}

/** An in-memory ledger for tests and for a caller with no database: the rows are a plain list. */
export function memoryLedger(): Ledger & { rows: Array<LlmCallRecord & { at: string }> } {
  const rows: Array<LlmCallRecord & { at: string }> = [];
  return {
    rows,
    async record(row, now = new Date()) {
      rows.push({ ...row, at: now.toISOString() });
    },
    async monthCost(project, now = new Date()) {
      const since = monthStartUtc(now);
      return rows.filter((r) => r.at >= since && (project === undefined || r.project === project)).reduce((s, r) => s + r.costMicroUsd, 0);
    },
  };
}

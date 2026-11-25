import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LLM_OUTCOMES, type LlmOutcome } from "@hub/config/llm";
import { openDb, type DbHandle } from "../src/client";
import { liveSeq, liveSince } from "../src/live";
import { createRepos, type Repos } from "../src/repos";
import { REFUSAL_COALESCE_MS, type NewLlmCall } from "../src/repos/llm-calls";

// P78 L2: the ledger of @hub/llm. A row per attempt, money as whole micro-dollars, the month in UTC, refusals coalesced.
let h: DbHandle;
let repos: Repos;
beforeEach(() => {
  h = openDb(":memory:");
  repos = createRepos(h.db);
});
afterEach(() => h.close());

const row = (o: Partial<NewLlmCall> & { outcome: LlmOutcome }): NewLlmCall => ({
  project: "p", task: "t", model: "m", attempt: 1, tokensIn: 10, tokensOut: 5, tokensCached: 0, costMicroUsd: 0, latencyMs: 3, generationId: null, sourceKind: null, ...o,
});
const NOV = new Date("2026-11-20T12:00:00Z");

describe("llm_calls", () => {
  it("accepts every outcome of LLM_OUTCOMES (the migration's CHECK and the list agree)", async () => {
    for (const outcome of LLM_OUTCOMES) await repos.llmCalls.record(row({ outcome, task: outcome }), NOV);
    expect(h.db.$client.prepare("select count(*) as n from llm_calls").get()).toEqual({ n: LLM_OUTCOMES.length });
  });

  it("sums this month's cost per project and for the instance; last month and fractions do not leak in", async () => {
    await repos.llmCalls.record(row({ outcome: "ok", costMicroUsd: 800.4 }), NOV);
    await repos.llmCalls.record(row({ outcome: "invalid", costMicroUsd: 300 }), NOV);
    await repos.llmCalls.record(row({ outcome: "ok", project: "q", costMicroUsd: 1000 }), NOV);
    await repos.llmCalls.record(row({ outcome: "ok", costMicroUsd: 999_999 }), new Date("2026-10-31T23:59:59Z"));
    expect(await repos.llmCalls.monthCost({ project: "p" }, NOV)).toBe(1100);
    expect(await repos.llmCalls.monthCost({}, NOV)).toBe(2100);
    expect(await repos.llmCalls.monthCost({ project: "p" }, new Date("2026-12-01T00:00:00Z"))).toBe(0);
  });

  it("sums one task's month for its own budget (P144 W1), alone or with a project", async () => {
    await repos.llmCalls.record(row({ outcome: "ok", task: "watch.window", costMicroUsd: 700 }), NOV);
    await repos.llmCalls.record(row({ outcome: "ok", task: "watch.window", project: "q", costMicroUsd: 50 }), NOV);
    await repos.llmCalls.record(row({ outcome: "ok", task: "messages.preanalysis", costMicroUsd: 300 }), NOV);
    expect(await repos.llmCalls.monthCost({ task: "watch.window" }, NOV)).toBe(750);
    expect(await repos.llmCalls.monthCost({ task: "watch.window", project: "q" }, NOV)).toBe(50);
  });

  it("writes a refusal once per project, task and kind in the coalescing window, and reports the month", async () => {
    await repos.llmCalls.record(row({ outcome: "no_key", model: null }), NOV);
    await repos.llmCalls.record(row({ outcome: "no_key", model: null }), new Date(NOV.getTime() + 60_000));
    await repos.llmCalls.record(row({ outcome: "no_key", model: null, task: "other" }), NOV);
    await repos.llmCalls.record(row({ outcome: "no_key", model: null }), new Date(NOV.getTime() + REFUSAL_COALESCE_MS + 1));
    await repos.llmCalls.record(row({ outcome: "ok", costMicroUsd: 5 }), new Date(NOV.getTime() - 3_600_000));
    const m = await repos.llmCalls.month(new Date(NOV.getTime() + REFUSAL_COALESCE_MS + 2));
    expect(m).toEqual({ calls: 1, costMicroUsd: 5, refused: { budget: 0, no_key: 3 }, lastRefusedAt: new Date(NOV.getTime() + REFUSAL_COALESCE_MS + 1).toISOString(), lastOkAt: new Date(NOV.getTime() - 3_600_000).toISOString() });
  });

  it("moves the live counter with the project (rule 16)", async () => {
    const s0 = liveSeq(h.db);
    await repos.llmCalls.record(row({ outcome: "ok" }), NOV);
    expect(liveSince(h.db, s0).changes.map((c) => `${c.tbl}/${c.project}`)).toEqual(["llm_calls/p"]);
  });
});

import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { LlmOutcome } from "@hub/config/llm";

// P78 (decision 0039): one row per attempt of an LLM call made through `@hub/llm`, failed and refused attempts included, so the
// month's spend and the wasted share are sums over this table. Counts and money only: no prompt, no answer, no client text
// (the owner: "not junk"). Cost is OpenRouter's `usage.cost` as whole micro-dollars; a refusal (`budget`, `no_key`) costs 0.
export const llmCalls = sqliteTable(
  "llm_calls",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    task: text("task").notNull(),
    model: text("model"),
    attempt: integer("attempt").notNull(),
    outcome: text("outcome").$type<LlmOutcome>().notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    tokensCached: integer("tokens_cached").notNull().default(0),
    costMicroUsd: integer("cost_micro_usd").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    generationId: text("generation_id"),
    sourceKind: text("source_kind"),
    createdAt: text("created_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [index("llm_calls_created").on(t.createdAt), index("llm_calls_project_created").on(t.project, t.createdAt)],
);

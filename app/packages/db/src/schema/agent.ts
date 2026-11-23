import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { AdvisorModel, AgentModel, EventKind, RunStatus, SafetyKind, SafetyLevel } from "@hub/config";
import { clients } from "./clients";

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    trigger: text("trigger").notNull(), // schedule | owner | skill name
    skill: text("skill"),
    model: text("model"),
    status: text("status").$type<RunStatus>().notNull().default("ok"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    // The session's `batchKey` (P48 W5): every `draft_write` / `client_record` of one session joins this run.
    batchKey: text("batch_key"),
  },
  (t) => [index("agent_runs_project_started").on(t.project, t.startedAt), index("agent_runs_project_batch_key").on(t.project, t.batchKey)],
);

export const agentEvents = sqliteTable(
  "agent_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    runId: integer("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    at: text("at").notNull(),
    kind: text("kind").$type<EventKind>().notNull(),
    tool: text("tool"),
    summary: text("summary").notNull(), // one line, shown; never a mail body
    detail: text("detail"), // JSON, collapsed in the UI; message ids, not bodies
    clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("agent_events_run_seq").on(t.runId, t.seq), index("agent_events_project").on(t.project)],
);

// ---- Projects and knowledge (P7, doc 16). The files under <instance>/projects/<slug>/ are the source of truth; these
// tables are an index rebuilt from them (`pnpm hub project sync`, `knowledge index`). Nothing edits them by hand.

// The owner's edits to the safety rules, per project. Absent row = the default in @hub/config.
export const safetyRules = sqliteTable(
  "safety_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    kind: text("kind").$type<SafetyKind>().notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    level: text("level").$type<SafetyLevel>().notNull(),
    params: text("params").notNull().default("{}"), // JSON {words?, days?}
    updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [uniqueIndex("safety_rules_key").on(t.project, t.kind)],
);

// The agent's model and its advisor per project (P55), set in Settings ▸ Agent; read by `hub agent` when it writes the Claude
// session's settings.json. Absent row = `DEFAULT_AGENT_SETTINGS` in @hub/config.
export const agentSettings = sqliteTable(
  "agent_settings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    project: text("project").notNull(),
    model: text("model").$type<AgentModel>().notNull(),
    advisor: integer("advisor", { mode: "boolean" }).notNull().default(false),
    advisorModel: text("advisor_model").$type<AdvisorModel>().notNull(),
    updatedAt: text("updated_at").notNull().default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`),
  },
  (t) => [uniqueIndex("agent_settings_project").on(t.project)],
);

import { eq, sql } from "drizzle-orm";
import { ADVISOR_MODELS, AGENT_MODELS, DEFAULT_AGENT_SETTINGS, type AgentSettings } from "@hub/config";
import type { Db } from "../client";
import { RepoError } from "../errors";
import { agentSettings } from "../schema";

/** A stored row as settings: a value this core does not know (a newer core's model) reads as the default. */
function effective(row: { model: string; advisor: boolean; advisorModel: string } | undefined): AgentSettings {
  if (!row) return { ...DEFAULT_AGENT_SETTINGS };
  return {
    model: (AGENT_MODELS as readonly string[]).includes(row.model) ? (row.model as AgentSettings["model"]) : DEFAULT_AGENT_SETTINGS.model,
    advisor: row.advisor,
    advisorModel: (ADVISOR_MODELS as readonly string[]).includes(row.advisorModel) ? (row.advisorModel as AgentSettings["advisorModel"]) : DEFAULT_AGENT_SETTINGS.advisorModel,
  };
}

/** The agent's model and advisor of one project (P55); the same sync read for `hub agent` (`readAgentSettings`). */
export function agentSettingsOf(db: Db, project: string): AgentSettings {
  return effective(db.select().from(agentSettings).where(eq(agentSettings.project, project)).get());
}

/** The owner's agent settings per project (P55). Reading returns the effective set; writing merges the owner's change. */
export function agentSettingsRepo(db: Db) {
  return {
    async get(project: string): Promise<AgentSettings> {
      return agentSettingsOf(db, project);
    },

    async set(project: string, patch: Partial<AgentSettings>): Promise<AgentSettings> {
      if (patch.model !== undefined && !(AGENT_MODELS as readonly string[]).includes(patch.model)) throw new RepoError("wrong_state", `Unknown model "${patch.model}"`);
      if (patch.advisorModel !== undefined && !(ADVISOR_MODELS as readonly string[]).includes(patch.advisorModel)) throw new RepoError("wrong_state", `Unknown advisor model "${patch.advisorModel}"`);
      const next: AgentSettings = { ...agentSettingsOf(db, project), ...patch };
      db.insert(agentSettings)
        .values({ project, ...next })
        .onConflictDoUpdate({ target: agentSettings.project, set: { ...next, updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))` } })
        .run();
      return next;
    },
  };
}

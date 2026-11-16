import { sql } from "drizzle-orm";
import { SAFETY_KINDS, type SafetyKind, type SafetyLevel, type SafetyParams, type SafetyRule } from "@hub/config";
import type { Db } from "../client";
import { RepoError } from "../errors";
import { safetyRules } from "../schema";
import { loadRules } from "./bulk-shared";

/** The owner's safety rules per project. Reading returns the effective set; writing keeps only the owner's change. */
export function safetyRulesRepo(db: Db) {
  return {
    async list(project: string): Promise<SafetyRule[]> {
      return loadRules(db, project);
    },

    async set(project: string, kind: SafetyKind, patch: { enabled?: boolean; level?: SafetyLevel; params?: SafetyParams }): Promise<SafetyRule> {
      if (!(SAFETY_KINDS as readonly string[]).includes(kind)) throw new RepoError("wrong_state", `Unknown safety kind "${kind}"`);
      const cur = loadRules(db, project).find((r) => r.kind === kind) as SafetyRule;
      const next: SafetyRule = {
        kind,
        enabled: patch.enabled ?? cur.enabled,
        level: patch.level ?? cur.level,
        params: patch.params ? { ...cur.params, ...patch.params } : cur.params,
      };
      db.insert(safetyRules)
        .values({ project, kind, enabled: next.enabled, level: next.level, params: JSON.stringify(next.params) })
        .onConflictDoUpdate({
          target: [safetyRules.project, safetyRules.kind],
          set: { enabled: next.enabled, level: next.level, params: JSON.stringify(next.params), updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))` },
        })
        .run();
      return next;
    },
  };
}

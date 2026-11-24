import { and, eq, inArray, max, notInArray, sql } from "drizzle-orm";
import { type DraftFinding, type Mark, type SafetyResult, type SafetyRule } from "@hub/config";
import type { Db } from "../client";
import { batches, clients, drafts, marks, safetyRules } from "../schema";
import { effectiveRules, evaluateSafety } from "../safety";
import { insertEvent, sessionRun } from "./runs";

// Helpers shared by the drafts and batches repositories. All sync: they run inside the caller's transaction.
export type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;
export type DraftRow = typeof drafts.$inferSelect;

export const nowIso = () => new Date().toISOString();
/** SQLite's own clock in the same ISO form, for a column set inside a write. */
export const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const parseJson = <T>(text: string | null | undefined, fallback: T): T => {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

/** The project's safety rules: defaults with the owner's rows laid over them. */
export function loadRules(tx: Tx, project: string): SafetyRule[] {
  const rows = tx.select().from(safetyRules).where(eq(safetyRules.project, project)).all();
  return effectiveRules(
    rows.map((r) => ({ kind: r.kind, enabled: r.enabled, level: r.level, params: parseJson(r.params, {}) })),
  );
}

/** The findings the draft record stored (P60 fact-other-brand), as the safety engine reads them. */
export const findingsOf = (d: Pick<DraftRow, "findings">): DraftFinding[] => parseJson<DraftFinding[]>(d.findings, []);

/** Safety results for a set of drafts, computed now from the rules and the client's current marks. */
export function loadSafety(tx: Tx, project: string, rows: DraftRow[], now: Date = new Date()): Map<number, SafetyResult[]> {
  const out = new Map<number, SafetyResult[]>();
  if (rows.length === 0) return out;
  const clientIds = [...new Set(rows.map((r) => r.clientId))];
  const clientRows = new Map(tx.select().from(clients).where(inArray(clients.id, clientIds)).all().map((c) => [c.id, c]));
  const markRows = tx.select({ clientId: marks.clientId, mark: marks.mark }).from(marks).where(inArray(marks.clientId, clientIds)).all();
  const marksBy = new Map<number, Mark[]>();
  for (const m of markRows) marksBy.set(m.clientId, [...(marksBy.get(m.clientId) ?? []), m.mark]);
  const closed = new Map(
    tx
      .select({ clientId: drafts.clientId, at: max(drafts.actedAt) })
      .from(drafts)
      .where(and(inArray(drafts.clientId, clientIds), inArray(drafts.status, ["done", "sent"]), notInArray(drafts.id, rows.map((r) => r.id))))
      .groupBy(drafts.clientId)
      .all()
      .map((r) => [r.clientId, r.at]),
  );
  const rules = loadRules(tx, project);
  for (const d of rows) {
    const c = clientRows.get(d.clientId);
    if (!c) continue;
    out.set(
      d.id,
      evaluateSafety(
        {
          draft: d,
          client: { email: c.email, repliesOwed: c.repliesOwed, marks: marksBy.get(c.id) ?? [] },
          lastClosedAt: closed.get(c.id) ?? null,
          now,
          findings: findingsOf(d),
        },
        rules,
        parseJson<string[]>(d.acked, []),
      ),
    );
  }
  return out;
}

/** The run that holds the owner's own decisions on drafts outside a batch (one per project, P99 S0 (d)). */
export const OWNER_DECISIONS_KEY = "owner-decisions";

/**
 * Writes one line to the action log: the run of the draft's batch, else (a draft outside a batch, P99 S0 (d)) the
 * project's owner run (`OWNER_DECISIONS_KEY`), so Done, Skip, Hold and Undo of any draft are in its Activity.
 */
export function logDraftEvent(tx: Tx, d: DraftRow, kind: "draft_created" | "decision", summary: string, detail?: Record<string, unknown>): void {
  const batchRun = d.batchId == null ? null : (tx.select({ runId: batches.runId }).from(batches).where(eq(batches.id, d.batchId)).get()?.runId ?? null);
  const runId = batchRun ?? sessionRun(tx, { project: d.project, batchKey: OWNER_DECISIONS_KEY, skill: null, at: nowIso() });
  const name = tx.select({ name: clients.name }).from(clients).where(eq(clients.id, d.clientId)).get()?.name ?? "client";
  insertEvent(tx, {
    project: d.project,
    runId,
    at: nowIso(),
    kind,
    summary: `${summary}: ${name}`,
    detail: JSON.stringify({ draftId: d.id, ...detail }),
    clientId: d.clientId,
    tool: null,
  });
}

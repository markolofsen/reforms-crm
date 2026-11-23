import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { BatchFilter, BatchFilterCounts, ExclusionReason } from "@hub/config";
import type { Db } from "../client";
import { agentRuns, batches, clients, drafts } from "../schema";
import { parseJson, type DraftRow, type Tx } from "./bulk-shared";
import { draftsRepo } from "./drafts";
import { toReviewDrafts, type ReviewDraft } from "./review";

// Bulk batches (P9), read-only since P48: no route creates one (decision 0025); a batch stays a view of the drafts it wrote.

export type BatchRow = typeof batches.$inferSelect;
type Excluded = Partial<Record<ExclusionReason, number>>;

export type BatchSummary = Omit<BatchRow, "clientIds" | "excluded"> & {
  excluded: Excluded;
  counts: BatchFilterCounts;
  run: { status: string; finishedAt: string | null; tokensIn: number; tokensOut: number; costUsd: number } | null;
  /** P128 X4: when its last draft was sent or done (the newest `sent_at` or `acted_at` of a closed draft); null while none is. */
  lastClosedAt: string | null;
};

const closedSql = sql`case when ${drafts.status} in ('done','sent','skipped') then 1 else 0 end`;

const filterSql = (f: BatchFilter): SQL | undefined =>
  ({
    all: undefined,
    review: and(eq(drafts.status, "ready"), eq(drafts.checked, false)),
    checked: and(eq(drafts.status, "ready"), eq(drafts.checked, true)),
    hold: eq(drafts.status, "hold"),
    done: inArray(drafts.status, ["done", "sent"]),
    skipped: eq(drafts.status, "skipped"),
  })[f];

function countsFor(tx: Tx, ids: number[]): Map<number, BatchFilterCounts> {
  const out = new Map<number, BatchFilterCounts>();
  for (const id of ids) out.set(id, { all: 0, review: 0, checked: 0, hold: 0, done: 0, skipped: 0 });
  if (ids.length === 0) return out;
  const rows = tx
    .select({ batchId: drafts.batchId, status: drafts.status, checked: drafts.checked, n: sql<number>`count(*)` })
    .from(drafts)
    .where(inArray(drafts.batchId, ids))
    .groupBy(drafts.batchId, drafts.status, drafts.checked)
    .all();
  for (const r of rows) {
    const c = out.get(r.batchId as number);
    if (!c) continue;
    c.all += r.n;
    if (r.status === "ready") c[r.checked ? "checked" : "review"] += r.n;
    else if (r.status === "hold") c.hold += r.n;
    else if (r.status === "done" || r.status === "sent") c.done += r.n;
    else if (r.status === "skipped") c.skipped += r.n;
  }
  return out;
}

/** P128 X4: per batch, the newest time one of its drafts was sent or done; the View menu drops a batch 7 days after it. */
function lastClosedFor(tx: Tx, ids: number[]): Map<number, string> {
  if (ids.length === 0) return new Map();
  const rows = tx
    .select({ batchId: drafts.batchId, at: sql<string | null>`max(coalesce(${drafts.sentAt}, ${drafts.actedAt}))` })
    .from(drafts)
    .where(and(inArray(drafts.batchId, ids), inArray(drafts.status, ["done", "sent"])))
    .groupBy(drafts.batchId)
    .all();
  return new Map(rows.flatMap((r) => (r.batchId != null && r.at ? [[r.batchId, r.at] as const] : [])));
}

function summarize(tx: Tx, rows: BatchRow[]): BatchSummary[] {
  const counts = countsFor(tx, rows.map((r) => r.id));
  const closed = lastClosedFor(tx, rows.map((r) => r.id));
  const runIds = rows.map((r) => r.runId).filter((v): v is number => v != null);
  const runs = new Map(
    (runIds.length ? tx.select().from(agentRuns).where(inArray(agentRuns.id, runIds)).all() : []).map((r) => [r.id, r]),
  );
  return rows.map(({ clientIds: _ids, excluded, ...b }) => {
    const run = b.runId == null ? undefined : runs.get(b.runId);
    return {
      ...b,
      excluded: parseJson<Excluded>(excluded, {}),
      counts: counts.get(b.id) as BatchFilterCounts,
      run: run ? { status: run.status, finishedAt: run.finishedAt, tokensIn: run.tokensIn, tokensOut: run.tokensOut, costUsd: run.costUsd } : null,
      lastClosedAt: closed.get(b.id) ?? null,
    };
  });
}

export function batchesRepo(db: Db) {
  return {
    async list(project: string): Promise<BatchSummary[]> {
      const rows = db.select().from(batches).where(eq(batches.project, project)).orderBy(desc(batches.createdAt), desc(batches.id)).all();
      return summarize(db, rows);
    },

    async get(project: string, id: number): Promise<BatchSummary | null> {
      const row = db.select().from(batches).where(and(eq(batches.id, id), eq(batches.project, project))).get();
      return row ? (summarize(db, [row])[0] ?? null) : null;
    },

    /** The review queue of a batch, (owed, then longest silence; finished rows last). `page` cuts a long batch into pieces. */
    async drafts(project: string, batchId: number, filter: BatchFilter = "all", opts: { now?: Date; limit?: number; offset?: number } = {}): Promise<ReviewDraft[]> {
      const rows = db
        .select({ d: drafts, c: clients })
        .from(drafts)
        .innerJoin(clients, eq(clients.id, drafts.clientId))
        .where(and(eq(drafts.project, project), eq(drafts.batchId, batchId), filterSql(filter)))
        .orderBy(closedSql, desc(clients.repliesOwed), sql`case when ${clients.lastContactAt} is null then 1 else 0 end`, asc(clients.lastContactAt), asc(drafts.id))
        .limit(opts.limit ?? -1)
        .offset(opts.offset ?? 0)
        .all();
      return toReviewDrafts(db, project, rows, opts.now);
    },

    /** Undoes the most recent human action in a batch (one step per draft). Null when there is nothing to undo. */
    async undoLast(project: string, batchId: number): Promise<DraftRow | null> {
      const last = db
        .select({ id: drafts.id })
        .from(drafts)
        .where(and(eq(drafts.project, project), eq(drafts.batchId, batchId), sql`${drafts.prevStatus} is not null`))
        .orderBy(desc(drafts.actedAt), desc(drafts.id))
        .limit(1)
        .get();
      return last ? draftsRepo(db).undo(last.id) : null;
    },
  };
}

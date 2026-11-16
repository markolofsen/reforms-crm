import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  AUDIENCES,
  type Audience,
  type AudienceCounts,
  type BatchFilter,
  type BatchFilterCounts,
  type BatchIntent,
  type BatchStatus,
  type ExclusionReason,
  type Mark,
  type ToneBodies,
} from "@hub/config";
import type { Db } from "../client";
import { write } from "../tx";
import { RepoError } from "../errors";
import { agentRuns, batches, clients, drafts, marks } from "../schema";
import { logDraftEvent, nowIso, parseJson, type DraftRow, type Tx } from "./bulk-shared";
import { clientsRepo } from "./clients";
import { draftsRepo } from "./drafts";
import { toReviewDrafts, type ReviewDraft } from "./review";
import { insertEvent } from "./runs";

export type BatchRow = typeof batches.$inferSelect;
type Excluded = Partial<Record<ExclusionReason, number>>;

export type BatchSummary = Omit<BatchRow, "clientIds" | "excluded"> & {
  excluded: Excluded;
  counts: BatchFilterCounts;
  run: { status: string; finishedAt: string | null; tokensIn: number; tokensOut: number; costUsd: number } | null;
};

export type AudienceClient = {
  id: number;
  name: string;
  email: string;
  repliesOwed: boolean;
  lastContactAt: string | null;
  marks: Mark[];
  /** Null when the client can be put in a batch; otherwise why not. */
  reason: ExclusionReason | null;
};

export type NewBatch = {
  project: string;
  name: string;
  intent: BatchIntent;
  audience: Audience;
  silentDays?: number | null;
  /** The clients the person left ticked. Authoritative; ineligible ones are dropped and counted. */
  clientIds: number[];
  /** The owner's purpose and tone. The agent writes each draft for one client from it; it is never copied into N bodies. */
  brief: string;
};

/** What the agent hands in for one client of a `queued` batch. There is no status field: a draft is always `ready`. */
export type AgentDraft = {
  clientId: number;
  subject: string;
  body: string;
  reason: string;
  tones?: ToneBodies;
  ccAddr?: string | null;
  mailRef?: string | null;
};

/** A `queued` agent batch as the gate hands it to a run: only the clients that still have no draft in it. */
export type QueuedBatch = {
  id: number;
  project: string;
  name: string;
  intent: BatchIntent;
  brief: string | null;
  runId: number | null;
  total: number;
  clients: Array<{ id: number; name: string; email: string; repliesOwed: boolean; lastContactAt: string | null; marks: Mark[] }>;
};

const DAY = 86_400_000;
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

function summarize(tx: Tx, rows: BatchRow[]): BatchSummary[] {
  const counts = countsFor(tx, rows.map((r) => r.id));
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
    };
  });
}

export function batchesRepo(db: Db) {
  const clientsApi = clientsRepo(db);

  /** The clients that match an audience chip, with eligibility, and the count behind every chip. */
  async function audience(
    project: string,
    spec: { audience: Audience; silentDays: number; now?: Date },
  ): Promise<{ counts: AudienceCounts; clients: AudienceClient[]; eligible: number }> {
    const now = (spec.now ?? new Date()).getTime();
    const all = await clientsApi.listAll(project);
    const match: Record<Audience, (c: (typeof all)[number]) => boolean> = {
      all: () => true,
      owed: (c) => c.repliesOwed,
      silent: (c) => c.lastContactAt != null && (now - new Date(c.lastContactAt).getTime()) / DAY >= spec.silentDays,
      follow_up: (c) => c.marks.includes("follow_up"),
      vip: (c) => c.marks.includes("vip"),
    };
    const counts = Object.fromEntries(AUDIENCES.map((a) => [a, all.filter(match[a]).length])) as AudienceCounts;
    const chosen = all.filter(match[spec.audience]).map<AudienceClient>((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      repliesOwed: c.repliesOwed,
      lastContactAt: c.lastContactAt,
      marks: c.marks,
      reason: c.marks.includes("do_not_contact") ? "do_not_contact" : c.draft && (c.draft.status === "ready" || c.draft.status === "hold") ? "open_draft" : null,
    }));
    return { counts, clients: chosen, eligible: chosen.filter((c) => c.reason === null).length };
  }

  /** Eligible = in the project, not do-not-contact, no open draft. Sync, for use inside a transaction. */
  function eligibility(tx: Tx, project: string, ids: number[]) {
    const found = ids.length ? tx.select().from(clients).where(and(eq(clients.project, project), inArray(clients.id, ids))).all() : [];
    const foundIds = found.map((c) => c.id);
    const dnc = new Set(
      foundIds.length ? tx.select({ id: marks.clientId }).from(marks).where(and(inArray(marks.clientId, foundIds), eq(marks.mark, "do_not_contact"))).all().map((m) => m.id) : [],
    );
    const open = new Set(
      foundIds.length ? tx.select({ id: drafts.clientId }).from(drafts).where(and(inArray(drafts.clientId, foundIds), inArray(drafts.status, ["ready", "hold"]))).all().map((d) => d.id) : [],
    );
    const excluded: Excluded = {};
    const bump = (k: ExclusionReason) => (excluded[k] = (excluded[k] ?? 0) + 1);
    const eligible = found.filter((c) => {
      if (dnc.has(c.id)) return bump("do_not_contact"), false;
      if (open.has(c.id)) return bump("open_draft"), false;
      return true;
    });
    const missing = new Set(ids).size - found.length;
    if (missing > 0) excluded.not_in_project = missing;
    return { eligible, excluded };
  }

  return {
    audience,

    /**
     * Creates a batch and its action-log run. The batch waits (`queued`) for the agent to add one draft per client and
     * close it: no body is made here (P28 C5), so no text is ever copied to many clients. Every draft is `ready`: nothing is sent.
     */
    async create(input: NewBatch, opts: { now?: Date } = {}): Promise<{ batchId: number; excluded: Excluded }> {
      const now = opts.now ?? new Date();
      if (!input.brief.trim()) throw new RepoError("wrong_state", "A batch needs a brief: the purpose and the tone");
      return write(db, (tx) => {
        const { eligible, excluded } = eligibility(tx, input.project, input.clientIds);
        if (eligible.length === 0) throw new RepoError("wrong_state", "No eligible client in the selection");
        const at = now.toISOString();
        const run = tx
          .insert(agentRuns)
          .values({ project: input.project, startedAt: at, finishedAt: null, trigger: "owner", skill: "bulk-agent-drafts", status: "ok" })
          .returning({ id: agentRuns.id })
          .get().id;
        const batch = tx
          .insert(batches)
          .values({
            project: input.project,
            name: input.name.trim(),
            intent: input.intent,
            status: "queued",
            audience: input.audience,
            silentDays: input.silentDays ?? null,
            clientIds: JSON.stringify(eligible.map((c) => c.id)),
            total: eligible.length,
            excluded: JSON.stringify(excluded),
            brief: input.brief.trim(),
            runId: run,
            createdAt: at,
            closedAt: null,
          })
          .returning({ id: batches.id })
          .get().id;
        const left = Object.values(excluded).reduce((a, b) => a + b, 0);
        insertEvent(tx, {
          project: input.project,
          runId: run,
          at,
          kind: "decision",
          summary: `Batch "${input.name.trim()}": ${eligible.length} client${eligible.length === 1 ? "" : "s"} selected${left ? `, ${left} left out` : ""}. Waiting for the agent.`,
          detail: JSON.stringify({ batchId: batch, audience: input.audience, excluded }),
          tool: null,
          clientId: null,
        });
        return { batchId: batch, excluded };
      });
    },

    /**
     * Agent batches waiting for drafts (oldest first), optionally of these projects only. `clients` holds the batch's
     * clients that have no draft in it yet and are not marked do-not-contact, so a re-run after a crash never asks twice.
     */
    async queuedAgent(projectSlugs?: string[]): Promise<QueuedBatch[]> {
      if (projectSlugs && projectSlugs.length === 0) return [];
      const rows = db
        .select()
        .from(batches)
        .where(and(eq(batches.status, "queued"), projectSlugs ? inArray(batches.project, projectSlugs) : undefined))
        .orderBy(asc(batches.id))
        .all();
      const out: QueuedBatch[] = [];
      for (const b of rows) {
        const ids = new Set(parseJson<number[]>(b.clientIds, []));
        const have = new Set(db.select({ id: drafts.clientId }).from(drafts).where(eq(drafts.batchId, b.id)).all().map((r) => r.id));
        const all = await clientsApi.listAll(b.project);
        const clientsLeft = all
          .filter((c) => ids.has(c.id) && !have.has(c.id) && !c.marks.includes("do_not_contact"))
          .map((c) => ({ id: c.id, name: c.name, email: c.email, repliesOwed: c.repliesOwed, lastContactAt: c.lastContactAt, marks: c.marks }));
        out.push({ id: b.id, project: b.project, name: b.name, intent: b.intent as BatchIntent, brief: b.brief, runId: b.runId, total: b.total, clients: clientsLeft });
      }
      return out;
    },

    /** The agent adds one draft to a `queued` batch. Only a client the batch selected, with no open draft. */
    async addAgentDraft(project: string, batchId: number, input: AgentDraft): Promise<number> {
      return write(db, (tx) => {
        const b = tx.select().from(batches).where(and(eq(batches.id, batchId), eq(batches.project, project))).get();
        if (!b) throw new RepoError("not_found", "No such batch");
        if (b.status !== "queued") throw new RepoError("wrong_state", "The batch is not waiting for drafts");
        if (!parseJson<number[]>(b.clientIds, []).includes(input.clientId)) throw new RepoError("wrong_state", "The client is not in this batch");
        if (tx.select({ id: drafts.id }).from(drafts).where(and(eq(drafts.batchId, batchId), eq(drafts.clientId, input.clientId))).get()) {
          throw new RepoError("wrong_state", "This client already has a draft in the batch");
        }
        const { eligible } = eligibility(tx, project, [input.clientId]);
        const c = eligible[0];
        if (!c) throw new RepoError("wrong_state", "The client can no longer be written to (do not contact, or an open draft)");
        const tones = input.tones ?? {};
        const tone = (["standard", "short", "warm"] as const).find((t) => tones[t] === input.body) ?? "standard";
        const d = tx
          .insert(drafts)
          .values({
            project,
            clientId: c.id,
            runId: b.runId,
            batchId,
            subject: input.subject,
            toAddr: c.email,
            ccAddr: input.ccAddr ?? null,
            body: input.body,
            tone,
            tones: JSON.stringify({ ...tones, [tone]: input.body }),
            reason: input.reason,
            mailRef: input.mailRef ?? null,
            status: "ready",
          })
          .returning()
          .get();
        logDraftEvent(tx, d, "draft_created", "Draft prepared", { action: "create" });
        return d.id;
      });
    },

    /** The agent says it is finished (or gave up). Records the run's cost. */
    async close(
      project: string,
      batchId: number,
      input: { status: Extract<BatchStatus, "ready" | "failed">; tokensIn?: number; tokensOut?: number; costUsd?: number; model?: string | null },
    ): Promise<void> {
      write(db, (tx) => {
        const b = tx.select().from(batches).where(and(eq(batches.id, batchId), eq(batches.project, project))).get();
        if (!b) throw new RepoError("not_found", "No such batch");
        if (b.status !== "queued") throw new RepoError("wrong_state", "The batch is already closed");
        const at = nowIso();
        tx.update(batches).set({ status: input.status, closedAt: at }).where(eq(batches.id, batchId)).run();
        if (b.runId != null) {
          tx
            .update(agentRuns)
            .set({ finishedAt: at, status: input.status === "ready" ? "ok" : "failed", tokensIn: input.tokensIn ?? 0, tokensOut: input.tokensOut ?? 0, costUsd: input.costUsd ?? 0, model: input.model ?? null })
            .where(eq(agentRuns.id, b.runId))
            .run();
          insertEvent(tx, { project, runId: b.runId, at, kind: input.status === "ready" ? "decision" : "error", summary: input.status === "ready" ? "The agent finished the batch." : "The agent stopped before the batch was complete.", detail: null, tool: null, clientId: null });
        }
      });
    },

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

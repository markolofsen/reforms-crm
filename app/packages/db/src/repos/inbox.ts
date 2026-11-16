import { and, asc, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { INBOX_ACTIONS, TRIAGE_GAP_MINUTES, type InboxAction, type InboxCounts, type InboxFilter, type NotionRef } from "@hub/config";
import type { Db } from "../client";
import { write } from "../tx";
import { RepoError } from "../errors";
import { agentRuns, inboxRows } from "../schema";
import { insertEvent } from "./runs";

export type InboxRow = typeof inboxRows.$inferSelect;
/** A row as the queue shows it: whether a draft of this client is open, and whether the reply is still owed. */
export type InboxItem = InboxRow & { openDraftId: number | null; owed: boolean };
type Tx = Pick<Db, "select" | "insert" | "update">;

/** What `hub record-client` (and `hub record-draft`, for a drafted client) reports for one client. No mail text. */
export type InboxInput = {
  project: string;
  email: string;
  name: string;
  action: InboxAction;
  subject?: string | null;
  mailRef?: string | null;
  lastInboundAt?: string | null;
  mailClass?: string | null;
  reason?: string | null;
  /** Defaults to false for `skipped`, true for the others: a client the agent left to the owner is owed an answer. */
  repliesOwed?: boolean;
  notion?: NotionRef | null;
  skill?: string | null;
  runId?: number | null;
};
export type InboxResult = { inboxId: number; runId: number; created: boolean };

const SQL_OWED = sql`${inboxRows.repliesOwed} = 1 and ${inboxRows.action} <> 'drafted' and not exists (select 1 from drafts d join clients c on c.id = d.client_id where c.project = inbox_rows.project and c.email = inbox_rows.email and d.status in ('ready','hold'))`;
const SQL_OPEN_DRAFT = sql<number | null>`(select max(d.id) from drafts d join clients c on c.id = d.client_id where c.project = inbox_rows.project and c.email = inbox_rows.email and d.status in ('ready','hold'))`;

/** Sync core: insert the client's row or update it. `firstSeenAt` is kept; everything the agent states again is replaced. Runs inside the caller's transaction. */
export function upsertInbox(tx: Tx, input: InboxInput, at: string): { id: number; created: boolean } {
  const email = input.email.trim().toLowerCase();
  const owed = input.repliesOwed ?? input.action !== "skipped";
  const set = {
    name: input.name.trim() || email,
    subject: input.subject ?? null,
    mailRef: input.mailRef ?? null,
    lastInboundAt: input.lastInboundAt ?? null,
    mailClass: input.mailClass ?? null,
    action: input.action,
    reason: input.reason ?? null,
    repliesOwed: owed,
    notionKind: input.notion?.kind ?? null,
    notionPageId: input.notion?.pageId ?? null,
    notionUrl: input.notion?.url ?? null,
    skill: input.skill ?? null,
    recordedAt: at,
  };
  const found = tx.select({ id: inboxRows.id }).from(inboxRows).where(and(eq(inboxRows.project, input.project), eq(inboxRows.email, email))).get();
  if (found) {
    tx.update(inboxRows).set(set).where(eq(inboxRows.id, found.id)).run();
    return { id: found.id, created: false };
  }
  return { id: tx.insert(inboxRows).values({ project: input.project, email, firstSeenAt: at, ...set }).returning({ id: inboxRows.id }).get().id, created: true };
}

const predicates: Record<InboxFilter, (since: string | null) => SQL | undefined> = {
  all: () => undefined,
  owed: () => SQL_OWED,
  new: (since) => (since ? gte(inboxRows.firstSeenAt, since) : sql`0`),
};

/**
 * The inbox: who the agent touched in a triage and what it did, so an empty Drafts screen explains itself and a client
 * who needs an answer shows up even when no draft exists. Local state (decision 0009 amended by P26): never a copy of Notion.
 */
export function inboxRepo(db: Db) {
  /** Start of the latest triage: the earliest record of the newest run of records closer together than the gap. Null when nothing was recorded. */
  const triageStart = (project: string): string | null => {
    const times = db.select({ at: inboxRows.recordedAt }).from(inboxRows).where(eq(inboxRows.project, project)).orderBy(desc(inboxRows.recordedAt)).limit(2000).all().map((r) => Date.parse(r.at));
    const first = times[0];
    if (first === undefined) return null;
    let start = first;
    for (const t of times) {
      if (start - t > TRIAGE_GAP_MINUTES * 60_000) break;
      start = Math.min(start, t);
    }
    return new Date(start).toISOString();
  };

  return {
    /** Writes the row, and one line in the Agent log (a run is started unless `runId` names one of this project). */
    async record(input: InboxInput, now: Date = new Date()): Promise<InboxResult> {
      if (!(INBOX_ACTIONS as readonly string[]).includes(input.action)) throw new RepoError("wrong_state", `Unknown action "${input.action}"`);
      return write(db, (tx) => {
        const at = now.toISOString();
        let runId = input.runId ?? null;
        if (runId != null && !tx.select({ id: agentRuns.id }).from(agentRuns).where(and(eq(agentRuns.id, runId), eq(agentRuns.project, input.project))).get()) {
          throw new RepoError("not_found", "No such run in this project");
        }
        if (runId == null) runId = tx.insert(agentRuns).values({ project: input.project, startedAt: at, finishedAt: at, trigger: "owner", skill: input.skill ?? null, status: "ok" }).returning({ id: agentRuns.id }).get().id;
        const r = upsertInbox(tx, input, at);
        insertEvent(tx, { project: input.project, runId, at, kind: "decision", summary: `${input.name || input.email}: ${input.action}`, detail: JSON.stringify({ inboxId: r.id, action: input.action, reason: input.reason ?? null }), clientId: null, tool: null });
        return { inboxId: r.id, runId, created: r.created };
      });
    },

    /** The queue, owed first, then the longest wait. `limit` and `offset` page it. */
    async list(project: string, filter: InboxFilter = "owed", opts: { limit?: number; offset?: number } = {}): Promise<InboxItem[]> {
      const rows = db
        .select({ row: inboxRows, openDraftId: SQL_OPEN_DRAFT, owed: sql<number>`(case when ${SQL_OWED} then 1 else 0 end)` })
        .from(inboxRows)
        .where(and(eq(inboxRows.project, project), predicates[filter](triageStart(project))))
        .orderBy(desc(sql`(case when ${SQL_OWED} then 1 else 0 end)`), sql`case when ${inboxRows.lastInboundAt} is null then 1 else 0 end`, asc(inboxRows.lastInboundAt), asc(inboxRows.id))
        .limit(opts.limit ?? -1)
        .offset(opts.offset ?? 0)
        .all();
      return rows.map((r) => ({ ...r.row, openDraftId: r.openDraftId, owed: r.owed === 1 }));
    },

    async counts(project: string): Promise<InboxCounts> {
      const since = triageStart(project);
      const n = (f: InboxFilter) => {
        const p = predicates[f](since);
        return db.select({ n: sql<number>`count(*)` }).from(inboxRows).where(and(eq(inboxRows.project, project), p)).get()?.n ?? 0;
      };
      return { owed: n("owed"), new: n("new"), all: n("all") };
    },

    /** When the agent last recorded a client for the project, or null when it never did: what "never triaged" means. */
    async lastTriageAt(project: string): Promise<string | null> {
      return db.select({ at: sql<string | null>`max(${inboxRows.recordedAt})` }).from(inboxRows).where(eq(inboxRows.project, project)).get()?.at ?? null;
    },
  };
}

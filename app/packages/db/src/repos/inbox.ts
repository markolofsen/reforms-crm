import { and, asc, desc, eq, gte, inArray, sql, type SQL } from "drizzle-orm";
import { type FinishReason, INBOX_ACTIONS, INBOX_KINDS, SEQUENCE_SKILL, TRIAGE_GAP_MINUTES, type InboxAction, type InboxCounts, type InboxKind, type InboxKindCounts, type InboxFilter, type NotionRef } from "@hub/config";
import type { Db } from "../client";
import { write } from "../tx";
import { RepoError } from "../errors";
import { clients, inboxRows } from "../schema";
import { onClientWrote } from "./enrollments";
import { OPEN_INBOUND } from "./inbound-mail";
import { insertEvent, sessionRun } from "./runs";

export type InboxRow = typeof inboxRows.$inferSelect;
/** A row as the queue shows it: whether a draft of this client is open, and whether the reply is still owed. */
export type InboxItem = InboxRow & { openDraftId: number | null; owed: boolean };
type Tx = Pick<Db, "select" | "insert" | "update">;

/** What `client_record` (and `draft_write`, for a drafted client) reports for one client. No mail text. */
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
  /** Set when the client is not answered by email (a call, no reply needed, crossed off, unknown sender); `phone` is free text, shown only. */
  kind?: InboxKind | null;
  phone?: string | null;
  /** Defaults to false for `skipped`, true for the others: a client the agent left to the owner is owed an answer. */
  repliesOwed?: boolean;
  notion?: NotionRef | null;
  skill?: string | null;
  runId?: number | null;
  /** The session's key: every record of one session joins one run. */
  batchKey?: string | null;
};
export type InboxResult = { inboxId: number; runId: number; created: boolean; /** Set when this record finished the client's follow-ups (P47). */ followUps?: FinishReason };

const SQL_ORDINARY = sql`${inboxRows.kind} is null`;
const SQL_OWED = sql`${inboxRows.kind} is null and ${inboxRows.repliesOwed} = 1 and ${inboxRows.action} <> 'drafted' and not exists (select 1 from drafts d join clients c on c.id = d.client_id where c.project = inbox_rows.project and c.email = inbox_rows.email and d.status in ('ready','hold'))`;
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
    kind: input.kind ?? null,
    phone: input.phone ?? null,
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
  all: () => SQL_ORDINARY,
  owed: () => SQL_OWED,
  new: (since) => (since ? and(SQL_ORDINARY, gte(inboxRows.firstSeenAt, since)) : sql`0`),
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
    /** Writes the row, and one line in the Agent log (in the run `runId` names, else the session's run by `batchKey`, else a new one). */
    async record(input: InboxInput, now: Date = new Date()): Promise<InboxResult> {
      if (!(INBOX_ACTIONS as readonly string[]).includes(input.action)) throw new RepoError("wrong_state", `Unknown action "${input.action}"`);
      if (input.kind != null && !(INBOX_KINDS as readonly string[]).includes(input.kind)) throw new RepoError("wrong_state", `Unknown kind "${input.kind}"`);
      return write(db, (tx) => {
        const at = now.toISOString();
        const runId = sessionRun(tx, { project: input.project, runId: input.runId, batchKey: input.batchKey, skill: input.skill, at });
        const r = upsertInbox(tx, input, at);
        insertEvent(tx, { project: input.project, runId, at, kind: "decision", summary: `${input.name || input.email}: ${input.action}`, detail: JSON.stringify({ inboxId: r.id, action: input.action, kind: input.kind ?? null, reason: input.reason ?? null }), clientId: null, tool: null });
        // P47: a client the agent recorded wrote to us, so their follow-ups finish (crossed off by the owner: excluded) in this transaction.
        let followUps: FinishReason | null = null;
        const known = input.skill === SEQUENCE_SKILL ? undefined : tx.select({ id: clients.id }).from(clients).where(and(eq(clients.project, input.project), eq(clients.email, input.email.trim().toLowerCase()))).get();
        if (known) followUps = onClientWrote(tx, { project: input.project, clientId: known.id, reason: input.kind === "crossed_off" ? "excluded" : "replied", lastInboundAt: input.lastInboundAt ?? null, at });
        return { inboxId: r.id, runId, created: r.created, ...(followUps ? { followUps } : {}) };
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

    /** The clients the agent did not answer by email, newest first; `kind` narrows to one group. Read-only. */
    async notByEmail(project: string, kind: InboxKind | null = null, opts: { limit?: number; offset?: number } = {}): Promise<InboxRow[]> {
      return db
        .select()
        .from(inboxRows)
        .where(and(eq(inboxRows.project, project), kind ? eq(inboxRows.kind, kind) : sql`${inboxRows.kind} is not null`))
        .orderBy(desc(inboxRows.recordedAt), desc(inboxRows.id))
        .limit(opts.limit ?? -1)
        .offset(opts.offset ?? 0)
        .all();
    },

    /** The Notion link recorded for one address, when the agent has already seen it. Read only. */
    async byEmail(project: string, email: string): Promise<Pick<InboxRow, "notionKind" | "notionPageId" | "notionUrl"> | null> {
      return (
        db
          .select({ notionKind: inboxRows.notionKind, notionPageId: inboxRows.notionPageId, notionUrl: inboxRows.notionUrl })
          .from(inboxRows)
          .where(and(eq(inboxRows.project, project), eq(inboxRows.email, email.trim().toLowerCase())))
          .get() ?? null
      );
    },

    /** The Notion links recorded for a bounded set of addresses, read in one query for list projections. */
    async notionByEmails(project: string, emails: readonly (string | null)[]): Promise<ReadonlyMap<string, Pick<InboxRow, "notionKind" | "notionPageId" | "notionUrl">>> {
      // A client known only by a chat has no address (P141 C1): it has no inbox row to name.
      const normalized = [...new Set(emails.flatMap((email) => (email ? [email.trim().toLowerCase()] : [])).filter(Boolean))];
      if (normalized.length === 0) return new Map();
      const rows = db
        .select({ email: inboxRows.email, notionKind: inboxRows.notionKind, notionPageId: inboxRows.notionPageId, notionUrl: inboxRows.notionUrl })
        .from(inboxRows)
        .where(and(eq(inboxRows.project, project), inArray(inboxRows.email, normalized)))
        .all();
      return new Map(rows.map(({ email, ...ref }) => [email, ref]));
    },

    async kindCounts(project: string): Promise<InboxKindCounts> {
      const rows = db.select({ kind: inboxRows.kind, n: sql<number>`count(*)` }).from(inboxRows).where(and(eq(inboxRows.project, project), sql`${inboxRows.kind} is not null`)).groupBy(inboxRows.kind).all();
      const out: InboxKindCounts = { call: 0, no_action: 0, crossed_off: 0, unknown_sender: 0 };
      for (const r of rows) if (r.kind) out[r.kind] = r.n;
      return out;
    },

    async counts(project: string): Promise<InboxCounts> {
      const since = triageStart(project);
      const n = (f: InboxFilter) => {
        const p = predicates[f](since);
        return db.select({ n: sql<number>`count(*)` }).from(inboxRows).where(and(eq(inboxRows.project, project), p)).get()?.n ?? 0;
      };
      // P96 verdict 5: `owed` is one count over both sources, one client once: the agent's owed rows and the clients with an
      // open message in the Mail reader's Inbox (`inbound_mail`, `inboundMailRepo.open`).
      const owedEmails = db.select({ email: inboxRows.email }).from(inboxRows).where(and(eq(inboxRows.project, project), SQL_OWED)).all().map((r) => r.email);
      const wrote = db.$client.prepare(`select distinct email from inbound_mail where project = ? and ${OPEN_INBOUND}`).all(project).flatMap((r) => (typeof r === "object" && r !== null && "email" in r && typeof r.email === "string" ? [r.email] : []));
      return { owed: new Set([...owedEmails, ...wrote]).size, new: n("new"), all: n("all") };
    },

    /** When the agent last recorded a client for the project, or null when it never did: what "never triaged" means. */
    async lastTriageAt(project: string): Promise<string | null> {
      return db.select({ at: sql<string | null>`max(${inboxRows.recordedAt})` }).from(inboxRows).where(eq(inboxRows.project, project)).get()?.at ?? null;
    },
  };
}

import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { LEAD_BATCH_BRIEF, LEAD_PASS_DECISION_LABELS, LEAD_PASS_REASON_MAX, LEAD_PASS_SKILL, LEAD_REPLY_INTENT, leadBatchName, leadPassDisplay, type LeadPassDecision, type LeadPassDisplay, type LeadPassTrigger } from "@hub/config/lead-pass";
import type { Db } from "../client";
import { RepoError } from "../errors";
import { write, type WriteTx } from "../tx";
import { batches, clients, drafts, leadPasses, leadRows } from "../schema";
import { OPEN_LEAD, type LeadRow } from "./lead-rows";
import { parseJson } from "./bulk-shared";
import { insertEvent, sessionRun } from "./runs";

// The daily lead pass (decision 0055, P147 L1). The list is mechanical (verdict 3): an open lead (`OPEN_LEAD`, the reader's New)
// received in the window that has no pass decision yet. A decision is written once per lead page; Redo clears it. The display
// state is derived (`leadPassDisplay`), never stored. Literal table names in raw SQL (rule 15).

export type LeadPassRow = typeof leadPasses.$inferSelect;
/** A lead row with its derived display state and the status of its pass draft. */
export type LeadPassItem = LeadRow & { display: LeadPassDisplay; draftStatus: string | null };

const COUNT_KEY = { reply: "replied", client: "clients", spam: "spam", not_now: "notNow", hand_over: "handedOver" } as const satisfies Record<LeadPassDecision, keyof LeadPassRow>;
const norm = (id: string) => id.replace(/-/g, "").toLowerCase();
const DUE = sql.raw(`(${OPEN_LEAD}) and lead_rows.pass_decision is null`);

export interface LeadDecisionInput {
  project: string;
  pageId: string;
  decision: LeadPassDecision;
  reason: string;
  /** The turn's pass (null: an attended session's own decision, which joins the day's dock pass). */
  passId: number | null;
  /** D3: the client the exact reply address matched (a `client` decision). */
  clientId?: number | null;
  at: string;
}

/** The pure selector (verdict 3): which of these rows a pass lists. Open, in the window, no decision; newest first. */
export function dueLeads<R extends Pick<LeadRow, "receivedAt" | "passDecision" | "id">>(rows: readonly (R & { open: boolean })[], from: string): R[] {
  return rows.filter((r) => r.open && r.receivedAt >= from && r.passDecision === null).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id - a.id);
}

/** F2 of 3d: the owner's review click (or the send) has acted on this decision; only Redo clears it now. */
export const leadDecisionApplied = (r: Pick<LeadRow, "passExcludedAt" | "dismissedReason" | "convertedAt">): boolean => r.passExcludedAt !== null || r.dismissedReason !== null || r.convertedAt !== null;

/**
 * P147 E4 (decision 0055 point 8): one person, one reply. Of the rows of one person (`others`: the rows sharing an email,
 * the account email or the phone), the newest gets the decision and the draft; this row is `not_now` "same person as" the
 * sibling returned here when that sibling is newer (a later `receivedAt`, or the same with a higher id) and not Spam (answered
 * or not: an older request of someone already answered needs no reply of its own). Pure.
 */
export function samePersonAs<R extends Pick<LeadRow, "id" | "receivedAt" | "dismissedReason">>(row: R, others: readonly R[]): R | null {
  const newer = others.filter((o) => o.id !== row.id && o.dismissedReason !== "spam" && (o.receivedAt > row.receivedAt || (o.receivedAt === row.receivedAt && o.id > row.id)));
  return newer.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || b.id - a.id)[0] ?? null;
}

/** The reason a sibling row is given (E4), within `LEAD_PASS_REASON_MAX`. */
export const samePersonReason = (r: Pick<LeadRow, "name" | "receivedAt">): string => `same person as ${r.name.slice(0, 120)} (${r.receivedAt.slice(0, 10)}): one reply`;

/**
 * Verdict 6: the day's open lead batch of a project, made by the first pass draft of the day and joined by the rest (a second
 * pass that day, a dock pass). The second writer of `batches` beside `joinBatch` of `drafts-record.ts`, called only from there.
 */
export function joinLeadBatch(tx: WriteTx, o: { project: string; day: string; clientId: number; runId: number; at: string }): number {
  const found = tx
    .select()
    .from(batches)
    .where(and(eq(batches.project, o.project), eq(batches.intent, LEAD_REPLY_INTENT), isNull(batches.closedAt), sql`substr(${batches.createdAt}, 1, 10) = ${o.day}`))
    .orderBy(desc(batches.id))
    .get();
  const row = found ?? tx.insert(batches).values({ project: o.project, name: leadBatchName(o.day), intent: LEAD_REPLY_INTENT, status: "ready", audience: "agent", clientIds: "[]", total: 0, excluded: "{}", brief: LEAD_BATCH_BRIEF, runId: o.runId, createdAt: o.at }).returning().get();
  const ids = parseJson<number[]>(row.clientIds, []);
  if (!ids.includes(o.clientId)) {
    ids.push(o.clientId);
    tx.update(batches).set({ clientIds: JSON.stringify(ids), total: ids.length }).where(eq(batches.id, row.id)).run();
  }
  return row.id;
}

/** The pass draft's stamp on its lead row (advisor: a turn that dies after its draft still shows Drafted), in the draft's transaction. */
export function stampLeadDraft(tx: WriteTx, o: { project: string; pageId: string; passId: number | null; draftId: number }): void {
  tx.update(leadRows).set({ passDraftId: o.draftId, ...(o.passId !== null ? { passId: o.passId } : {}) }).where(and(eq(leadRows.project, o.project), eq(leadRows.pageId, norm(o.pageId)))).run();
}

export function leadPassRepo(db: Db) {
  const rowOf = (project: string, pageId: string) => db.select().from(leadRows).where(and(eq(leadRows.project, project), eq(leadRows.pageId, norm(pageId)))).get() ?? null;
  const draftStatusOf = (ids: readonly number[]): Map<number, string> => (ids.length ? new Map(db.select({ id: drafts.id, status: drafts.status }).from(drafts).where(inArray(drafts.id, [...ids])).all().map((d) => [d.id, d.status])) : new Map());
  const items = (rows: readonly LeadRow[]): LeadPassItem[] => {
    const st = draftStatusOf(rows.flatMap((r) => (r.passDraftId !== null ? [r.passDraftId] : [])));
    return rows.map((r) => {
      const draftStatus = r.passDraftId !== null ? (st.get(r.passDraftId) ?? null) : null;
      return { ...r, draftStatus, display: leadPassDisplay({ ...r, draftStatus }) };
    });
  };

  return {
    /** The pass's list (verdict 3), newest first, at most `limit`; `total` is every due lead (the rest roll to the next pass). */
    async due(project: string, from: string, limit?: number): Promise<{ rows: LeadRow[]; total: number }> {
      const rows = db.select().from(leadRows).where(and(eq(leadRows.project, project), gte(leadRows.receivedAt, from), DUE)).orderBy(sql`${leadRows.receivedAt} desc`, sql`${leadRows.id} desc`).all();
      return { rows: limit === undefined ? rows : rows.slice(0, limit), total: rows.length };
    },

    /** Re-checked right before each turn (advisor): a lead drafted, dismissed or decided since the list was read is skipped. */
    async isDue(project: string, pageId: string, from: string): Promise<boolean> {
      return !!db.select({ id: leadRows.id }).from(leadRows).where(and(eq(leadRows.project, project), eq(leadRows.pageId, norm(pageId)), gte(leadRows.receivedAt, from), DUE)).get();
    },

    /** One lead with its display state, or null. */
    async item(project: string, pageId: string): Promise<LeadPassItem | null> {
      const r = rowOf(project, pageId);
      return r ? (items([r])[0] ?? null) : null;
    },

    /** Every lead of the project received at or after `from` that carries a decision, with its display state (Overview, the review). */
    async decided(project: string, from: string): Promise<LeadPassItem[]> {
      return items(db.select().from(leadRows).where(and(eq(leadRows.project, project), gte(leadRows.receivedAt, from), sql`${leadRows.passDecision} is not null`)).orderBy(sql`${leadRows.passAt} desc`, sql`${leadRows.id} desc`).all());
    },

    /** The leads whose pass draft is in this batch (the review screen's rows). */
    async ofBatch(project: string, batchId: number): Promise<LeadPassItem[]> {
      const rows = db
        .select({ row: leadRows })
        .from(leadRows)
        .innerJoin(drafts, eq(drafts.id, leadRows.passDraftId))
        .where(and(eq(leadRows.project, project), eq(drafts.batchId, batchId)))
        .orderBy(sql`${leadRows.receivedAt} desc`)
        .all()
        .map((r) => r.row);
      return items(rows);
    },

    /**
     * The other requests of the same person with their decisions (verdict 3's prefetch, E4): the rows that share an email, the
     * account email or the phone digits with this one, newest first, this page excluded.
     */
    async earlier(project: string, pageId: string, limit: number): Promise<LeadRow[]> {
      const r = rowOf(project, pageId);
      if (!r) return [];
      const keys = [r.email, r.accountEmail].filter((v): v is string => !!v);
      if (!keys.length && !r.phone) return [];
      const byMail = keys.length ? sql`${leadRows.email} in ${keys} or ${leadRows.accountEmail} in ${keys}` : sql`0`;
      const byPhone = r.phone ? sql`${leadRows.phone} = ${r.phone}` : sql`0`;
      return db
        .select()
        .from(leadRows)
        .where(and(eq(leadRows.project, project), sql`${leadRows.pageId} <> ${r.pageId}`, sql`(${byMail} or ${byPhone})`))
        .orderBy(sql`${leadRows.receivedAt} desc`)
        .limit(limit)
        .all();
    },

    /**
     * `lead_decide` (verdict 2, F2 of 3d): writes the decision of one lead page. It does not require the lead to be open (its own
     * draft just closed it). A decision may be changed until the owner's review click has applied it (excluded, dismissed as spam or
     * not now, or converted at the send): then it is refused with the first one's (`already`). A change moves the old decision's
     * count off its pass. One Activity line each.
     */
    async decide(d: LeadDecisionInput): Promise<{ row: LeadRow; already: boolean; changed: LeadPassDecision | null }> {
      return write(db, (tx) => {
        const r = tx.select().from(leadRows).where(and(eq(leadRows.project, d.project), eq(leadRows.pageId, norm(d.pageId)))).get();
        if (!r) throw new RepoError("not_found", `No lead ${d.pageId} in project ${d.project}`);
        if (r.passDecision && leadDecisionApplied(r)) return { row: r, already: true, changed: null };
        const changed = r.passDecision ?? null;
        if (changed && r.passId !== null) {
          const col = leadPasses[COUNT_KEY[changed]];
          tx.update(leadPasses).set({ [COUNT_KEY[changed]]: sql`max(0, ${col} - 1)` }).where(eq(leadPasses.id, r.passId)).run();
        }
        const reason = d.reason.replace(/\s+/g, " ").trim().slice(0, LEAD_PASS_REASON_MAX);
        const row = tx
          .update(leadRows)
          .set({ passDecision: d.decision, passReason: reason, passAt: d.at, ...(d.passId !== null ? { passId: d.passId } : {}), ...(d.clientId != null ? { passClientId: d.clientId } : {}) })
          .where(eq(leadRows.id, r.id))
          .returning()
          .get();
        if (!row) throw new RepoError("not_found", "The decision could not be written");
        const runId = sessionRun(tx, { project: d.project, batchKey: `lead-pass:${d.passId ?? d.at.slice(0, 10)}`, skill: LEAD_PASS_SKILL, at: d.at });
        const client = row.passClientId ?? (row.email ? (tx.select({ id: clients.id }).from(clients).where(and(eq(clients.project, d.project), eq(clients.email, row.email))).get()?.id ?? null) : null);
        insertEvent(tx, {
          project: d.project,
          runId,
          at: d.at,
          kind: d.decision === "hand_over" ? "needs_human" : "decision",
          tool: "lead_decide",
          summary: `Lead ${LEAD_PASS_DECISION_LABELS[d.decision]}: ${row.name}`,
          detail: JSON.stringify({ action: `lead_${d.decision}`, reason, skill: LEAD_PASS_SKILL, lead: { pageId: row.pageId, decision: d.decision, passId: d.passId } }),
          clientId: client,
        });
        return { row, already: false, changed };
      });
    },

    /** Redo on the card (verdict 3): the decision, its draft link, its match and its untick are cleared, so the next pass lists it again. */
    async redo(project: string, pageId: string): Promise<boolean> {
      return write(db, (tx) => tx.update(leadRows).set({ passDecision: null, passReason: null, passAt: null, passId: null, passDraftId: null, passClientId: null, passExcludedAt: null }).where(and(eq(leadRows.project, project), eq(leadRows.pageId, norm(pageId)))).run().changes > 0);
    },

    /** D7: the owner unticked these in the review; the draft stays in Mail and the pass does not redo them. */
    async exclude(project: string, pageIds: readonly string[], at: string): Promise<number> {
      if (!pageIds.length) return 0;
      return write(db, (tx) => tx.update(leadRows).set({ passExcludedAt: at }).where(and(eq(leadRows.project, project), inArray(leadRows.pageId, pageIds.map(norm)), isNull(leadRows.passExcludedAt))).run().changes);
    },

    /** D5: a lead not converted and not spam with this reply address (the refusal of `client_create`), or null. */
    async unconvertedLead(project: string, email: string): Promise<LeadRow | null> {
      const e = email.trim().toLowerCase();
      return (
        db
          .select()
          .from(leadRows)
          .where(and(eq(leadRows.project, project), sql`(${leadRows.email} = ${e} or ${leadRows.accountEmail} = ${e})`, isNull(leadRows.convertedAt), sql`(${leadRows.dismissedReason} is null or ${leadRows.dismissedReason} <> 'spam')`, sql`(${leadRows.notionStatus} is null or ${leadRows.notionStatus} = 'New')`))
          .orderBy(sql`${leadRows.receivedAt} desc`)
          .get() ?? null
      );
    },

    // ---- The passes (verdict 4): one row each, so "last pass" and the day's turn budget survive a restart.
    async startPass(project: string, trigger: LeadPassTrigger, at: string): Promise<LeadPassRow> {
      const row = db.insert(leadPasses).values({ project, trigger, startedAt: at }).returning().get();
      if (!row) throw new RepoError("not_found", "The pass could not be recorded");
      return row;
    },
    async finishPass(id: number, s: Partial<Pick<LeadPassRow, "listed" | "turns" | "replied" | "clients" | "spam" | "notNow" | "handedOver" | "failed" | "skipped" | "batchId" | "error">> & { finishedAt?: string | null }): Promise<LeadPassRow | null> {
      return db.update(leadPasses).set(s).where(eq(leadPasses.id, id)).returning().get() ?? null;
    },
    async pass(project: string, id: number): Promise<LeadPassRow | null> {
      return db.select().from(leadPasses).where(and(eq(leadPasses.project, project), eq(leadPasses.id, id))).get() ?? null;
    },
    async passesSince(project: string, since: string): Promise<LeadPassRow[]> {
      return db.select().from(leadPasses).where(and(eq(leadPasses.project, project), gte(leadPasses.startedAt, since))).orderBy(desc(leadPasses.startedAt), desc(leadPasses.id)).all();
    },
    async lastPass(project: string): Promise<LeadPassRow | null> {
      return db.select().from(leadPasses).where(eq(leadPasses.project, project)).orderBy(desc(leadPasses.startedAt), desc(leadPasses.id)).get() ?? null;
    },
    /** Lead turns on this Mac since `since`, every project (verdict 13's 60 a day, a ledger separate from P142's). */
    async passTurnsSince(since: string): Promise<number> {
      return Number(db.select({ n: sql<number>`coalesce(sum(${leadPasses.turns}), 0)` }).from(leadPasses).where(gte(leadPasses.startedAt, since)).get()?.n ?? 0);
    },
    /** An attended session's decisions of one day are one `dock` pass row (verdict 4): found or started, its count bumped. */
    async dockDecision(project: string, decision: LeadPassDecision, at: string): Promise<number> {
      return write(db, (tx) => {
        const day = at.slice(0, 10);
        const found = tx.select().from(leadPasses).where(and(eq(leadPasses.project, project), eq(leadPasses.trigger, "dock"), sql`substr(${leadPasses.startedAt}, 1, 10) = ${day}`)).orderBy(desc(leadPasses.id)).get();
        const row = found ?? tx.insert(leadPasses).values({ project, trigger: "dock", startedAt: at }).returning().get();
        const col = { reply: leadPasses.replied, client: leadPasses.clients, spam: leadPasses.spam, not_now: leadPasses.notNow, hand_over: leadPasses.handedOver }[decision];
        tx.update(leadPasses).set({ [COUNT_KEY[decision]]: sql`${col} + 1`, listed: sql`${leadPasses.listed} + 1`, finishedAt: at }).where(eq(leadPasses.id, row.id)).run();
        return row.id;
      });
    },
    /** The day's open lead batch, or null (the review's banner). */
    async dayBatch(project: string, day: string): Promise<number | null> {
      return (
        db
          .select({ id: batches.id })
          .from(batches)
          .where(and(eq(batches.project, project), eq(batches.intent, LEAD_REPLY_INTENT), isNull(batches.closedAt), sql`substr(${batches.createdAt}, 1, 10) = ${day}`))
          .orderBy(desc(batches.id))
          .get()?.id ?? null
      );
    },
    /** The newest open lead batch of the project (the review opens it even the next morning), or null. */
    async openBatch(project: string): Promise<number | null> {
      return db.select({ id: batches.id }).from(batches).where(and(eq(batches.project, project), eq(batches.intent, LEAD_REPLY_INTENT), isNull(batches.closedAt))).orderBy(desc(batches.id)).get()?.id ?? null;
    },
    /** D10: the hash of the text the review served, set at that read; the ticket's Checked takes it. */
    async setServedHash(project: string, draftId: number, hash: string | null): Promise<void> {
      write(db, (tx) => tx.update(drafts).set({ servedHash: hash }).where(and(eq(drafts.project, project), eq(drafts.id, draftId))).run());
    },
  };
}

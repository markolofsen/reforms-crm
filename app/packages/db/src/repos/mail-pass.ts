import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { LEAD_PASS_REASON_MAX, MAIL_PASS_DECISION_LABELS, MAIL_PASS_SKILL, type MailPassDecision } from "@hub/config/lead-pass";
import type { Db } from "../client";
import { RepoError } from "../errors";
import { write, type WriteTx } from "../tx";
import { clients, drafts, inboundMail, inboxRows, leadPasses, leadRows, sendLog } from "../schema";
import { SQL_OPEN, type InboundRow } from "./inbound-mail";
import { insertEvent, sessionRun } from "./runs";

// The daily mail pass (decision 0055 point 9, P147 3h, migration 0049). Its list is the Mail reader's open threads: the client's
// newest open message (what Mail ▸ Needs you shows), received in the window, with no pass decision yet. Lead notices never reach
// it (the reader dismisses them as `lead_notice`). A decision is written once per row and may change until the owner's review
// click applied it; the display state is derived, never stored. Literal table names in raw SQL (rule 15).

/** What the review and the chips show for a mail-pass row, derived. */
export const MAIL_PASS_DISPLAY = ["new", "drafted", "draft_gone", "proposed", "for_you", "excluded", "sent", "dismissed"] as const;
export type MailPassDisplay = (typeof MAIL_PASS_DISPLAY)[number];
export type MailPassItem = InboundRow & { display: MailPassDisplay; draftStatus: string | null; newSender: boolean };

const COUNT_KEY = { reply: "replied", client: "clients", no_reply: "noReply", spam: "spam", hand_over: "handedOver" } as const;

/** The owner's click (or his own Mail) has acted on this decision: only a new message brings the thread back. */
export const mailDecisionApplied = (r: Pick<InboundRow, "passExcludedAt" | "dismissedAt">): boolean => r.passExcludedAt !== null || r.dismissedAt !== null;

/** Pure: the display state of one row. */
export function mailPassDisplay(r: Pick<InboundRow, "passDecision" | "passDraftId" | "passExcludedAt" | "dismissedAt" | "passReason">, draftStatus: string | null): MailPassDisplay {
  if (!r.passDecision) return "new";
  if (r.passExcludedAt) return "excluded";
  if (r.dismissedAt) return "dismissed";
  if (r.passDecision === "hand_over") return "for_you";
  if (r.passDecision === "spam" || r.passDecision === "no_reply") return "proposed";
  if (r.passDraftId === null) return "draft_gone";
  if (draftStatus === "ready" || draftStatus === "hold") return (r.passReason ?? "").trim().toLowerCase().startsWith("needs your input") ? "for_you" : "drafted";
  if (draftStatus === "sent" || draftStatus === "done") return "sent";
  return "draft_gone";
}

export interface MailDecisionInput {
  project: string;
  inboundId: number;
  decision: MailPassDecision;
  reason: string;
  passId: number | null;
  at: string;
}

/** The pass draft's stamp on its inbound row, in the draft's transaction (a turn that dies after its draft still shows Drafted). */
export function stampMailDraft(tx: WriteTx, o: { project: string; inboundId: number; passId: number | null; draftId: number }): void {
  tx.update(inboundMail).set({ passDraftId: o.draftId, ...(o.passId !== null ? { passId: o.passId } : {}) }).where(and(eq(inboundMail.project, o.project), eq(inboundMail.id, o.inboundId))).run();
}

export function mailPassRepo(db: Db) {
  const draftStatusOf = (ids: readonly number[]): Map<number, string> => (ids.length ? new Map(db.select({ id: drafts.id, status: drafts.status }).from(drafts).where(inArray(drafts.id, [...ids])).all().map((d) => [d.id, d.status])) : new Map());
  /** A sender the project never wrote to: not a reply in our thread, and no mail of ours was sent to the address. */
  const isNewSender = (r: InboundRow): boolean => r.why !== "thread" && !db.select({ id: sendLog.id }).from(sendLog).where(and(eq(sendLog.project, r.project), eq(sendLog.status, "sent"), sql`lower(${sendLog.toAddr}) like ${`%${r.email}%`}`)).get();
  const items = (rows: readonly InboundRow[]): MailPassItem[] => {
    const st = draftStatusOf(rows.flatMap((r) => (r.passDraftId !== null ? [r.passDraftId] : [])));
    return rows.map((r) => {
      const draftStatus = r.passDraftId !== null ? (st.get(r.passDraftId) ?? null) : null;
      return { ...r, draftStatus, display: mailPassDisplay(r, draftStatus), newSender: isNewSender(r) };
    });
  };
  /** The open rows, one per client (its newest), in the window and undecided. */
  const openNewest = (project: string, from: string): InboundRow[] => {
    const rows = db.select().from(inboundMail).where(and(eq(inboundMail.project, project), gte(inboundMail.receivedAt, from), SQL_OPEN)).orderBy(sql`${inboundMail.receivedAt} desc`, sql`${inboundMail.id} desc`).all();
    const seen = new Set<string>();
    return rows.filter((r) => (seen.has(r.email) ? false : (seen.add(r.email), true)));
  };

  return {
    /** The pass's list, newest first: each client's newest open message in the window with no decision; `total` is every due one. */
    async due(project: string, from: string, limit?: number): Promise<{ rows: InboundRow[]; total: number }> {
      const rows = openNewest(project, from).filter((r) => r.passDecision === null);
      return { rows: limit === undefined ? rows : rows.slice(0, limit), total: rows.length };
    },

    /** Re-checked right before each turn: a thread answered, dismissed or decided since the list was read is skipped. */
    async isDue(project: string, inboundId: number, from: string): Promise<boolean> {
      return openNewest(project, from).some((r) => r.id === inboundId && r.passDecision === null);
    },

    async item(project: string, inboundId: number): Promise<MailPassItem | null> {
      const r = db.select().from(inboundMail).where(and(eq(inboundMail.project, project), eq(inboundMail.id, inboundId))).get();
      return r ? (items([r])[0] ?? null) : null;
    },

    /** Every row received at or after `from` that carries a decision (the review's proposals and hand-overs, Overview). */
    async decided(project: string, from: string): Promise<MailPassItem[]> {
      return items(db.select().from(inboundMail).where(and(eq(inboundMail.project, project), gte(inboundMail.receivedAt, from), sql`${inboundMail.passDecision} is not null`)).orderBy(sql`${inboundMail.passAt} desc`, sql`${inboundMail.id} desc`).all());
    },

    /** The rows whose pass draft is in this batch (the review's Mail group). */
    async ofBatch(project: string, batchId: number): Promise<MailPassItem[]> {
      const rows = db.select({ row: inboundMail }).from(inboundMail).innerJoin(drafts, eq(drafts.id, inboundMail.passDraftId)).where(and(eq(inboundMail.project, project), eq(drafts.batchId, batchId))).orderBy(sql`${inboundMail.receivedAt} desc`).all().map((r) => r.row);
      return items(rows);
    },

    /** Whether a draft is a mail-pass draft (autosend's `mail-pass-first-reply`), and the row it answers. */
    async ofDraft(draftId: number): Promise<MailPassItem | null> {
      const r = db.select().from(inboundMail).where(eq(inboundMail.passDraftId, draftId)).get();
      return r ? (items([r])[0] ?? null) : null;
    },

    /** `mail_decide`: one decision per row, changeable until applied; a change moves the old count off its pass. One Activity line. */
    async decide(d: MailDecisionInput): Promise<{ row: InboundRow; already: boolean; changed: MailPassDecision | null }> {
      return write(db, (tx) => {
        const r = tx.select().from(inboundMail).where(and(eq(inboundMail.project, d.project), eq(inboundMail.id, d.inboundId))).get();
        if (!r) throw new RepoError("not_found", `No inbound message ${d.inboundId} in project ${d.project}`);
        if (r.passDecision && mailDecisionApplied(r)) return { row: r, already: true, changed: null };
        const changed = r.passDecision ?? null;
        if (changed && r.passId !== null) {
          const col = leadPasses[COUNT_KEY[changed]];
          tx.update(leadPasses).set({ [COUNT_KEY[changed]]: sql`max(0, ${col} - 1)` }).where(eq(leadPasses.id, r.passId)).run();
        }
        const reason = d.reason.replace(/\s+/g, " ").trim().slice(0, LEAD_PASS_REASON_MAX);
        const row = tx.update(inboundMail).set({ passDecision: d.decision, passReason: reason, passAt: d.at, ...(d.passId !== null ? { passId: d.passId } : {}) }).where(eq(inboundMail.id, r.id)).returning().get();
        if (!row) throw new RepoError("not_found", "The decision could not be written");
        const runId = sessionRun(tx, { project: d.project, batchKey: `mail-pass:${d.passId ?? d.at.slice(0, 10)}`, skill: MAIL_PASS_SKILL, at: d.at });
        const client = tx.select({ id: clients.id }).from(clients).where(and(eq(clients.project, d.project), eq(clients.email, row.email))).get()?.id ?? null;
        insertEvent(tx, {
          project: d.project,
          runId,
          at: d.at,
          kind: d.decision === "hand_over" ? "needs_human" : "decision",
          tool: "mail_decide",
          summary: `Mail ${MAIL_PASS_DECISION_LABELS[d.decision]}: ${row.name || row.email}`,
          detail: JSON.stringify({ action: `mail_${d.decision}`, reason, skill: MAIL_PASS_SKILL, inbound: { id: row.id, decision: d.decision, passId: d.passId } }),
          clientId: client,
        });
        return { row, already: false, changed };
      });
    },

    /**
     * P147 3m item 1: the message went to Mail's Junk (the review click on a junk proposal, or the owner's attended session). The
     * sender's open rows leave Needs you, and Activity gets one line. Call it only after Mail moved the message.
     */
    /**
     * P147 3n N4: why the agent may not move this sender's mail, or null. Someone we know: a Clients card in Notion, a mail we sent
     * them, or a lead. The owner's own buttons are never asked this; the agent's `mail_junk` is.
     */
    async knownSender(project: string, inboundId: number): Promise<string | null> {
      const r = db.select().from(inboundMail).where(and(eq(inboundMail.project, project), eq(inboundMail.id, inboundId))).get();
      if (!r) return null;
      const email = r.email.trim().toLowerCase();
      const c = db.select({ id: clients.id, page: clients.notionPageId }).from(clients).where(and(eq(clients.project, project), eq(clients.email, email))).get();
      if (c?.page) return `${email} has a Clients card in Notion`;
      if (c && db.select({ id: drafts.id }).from(drafts).where(and(eq(drafts.project, project), eq(drafts.clientId, c.id), eq(drafts.status, "sent"))).get()) return `we have written to ${email}`;
      if (db.select({ id: sendLog.id }).from(sendLog).where(and(eq(sendLog.project, project), eq(sendLog.status, "sent"), sql`lower(${sendLog.toAddr}) like ${`%${email}%`}`)).get()) return `we have written to ${email}`;
      if (db.select({ id: leadRows.id }).from(leadRows).where(and(eq(leadRows.project, project), sql`(${leadRows.email} = ${email} or ${leadRows.accountEmail} = ${email})`)).get()) return `${email} is a lead`;
      return null;
    },

    async moved(d: { project: string; inboundId: number; to: "junk" | "trash"; by: "review" | "attended" | "owner"; at: string }): Promise<number[]> {
      return write(db, (tx) => {
        const r = tx.select().from(inboundMail).where(and(eq(inboundMail.project, d.project), eq(inboundMail.id, d.inboundId))).get();
        if (!r) throw new RepoError("not_found", `No inbound message ${d.inboundId} in project ${d.project}`);
        const open = tx.select({ id: inboundMail.id }).from(inboundMail).where(and(eq(inboundMail.project, d.project), eq(inboundMail.email, r.email), SQL_OPEN)).all().map((x) => x.id);
        const ids = r.dismissedAt === null && !open.includes(r.id) ? [...open, r.id] : open;
        if (ids.length) tx.update(inboundMail).set({ dismissedAt: d.at }).where(inArray(inboundMail.id, ids)).run();
        // The moved message itself even when an agent's escalation closed it for the list (P128), and that owed escalation: it kept
        // the person in Needs you, and the owner's Spam or Delete is his answer to it.
        tx.update(inboxRows).set({ repliesOwed: false }).where(and(eq(inboxRows.project, d.project), eq(inboxRows.email, r.email), eq(inboxRows.action, "escalated"), eq(inboxRows.repliesOwed, true))).run();
        const runId = sessionRun(tx, { project: d.project, batchKey: `mail-junk:${d.at.slice(0, 10)}`, skill: MAIL_PASS_SKILL, at: d.at });
        const client = tx.select({ id: clients.id }).from(clients).where(and(eq(clients.project, d.project), eq(clients.email, r.email))).get()?.id ?? null;
        insertEvent(tx, {
          project: d.project,
          runId,
          at: d.at,
          kind: "decision",
          tool: "mail_junk",
          summary: `Mail moved to ${d.to === "trash" ? "Trash" : "Junk"}: ${r.name || r.email}`,
          detail: JSON.stringify({ action: "mail_junk", to: d.to, by: d.by, subject: r.subject.slice(0, 200), inbound: { id: r.id, account: r.account, mailbox: r.mailbox }, closed: ids }),
          clientId: client,
        });
        return ids;
      });
    },

    /** The owner's untick in the review: excluded from today's batch; the next pass leaves the thread alone. */
    async exclude(project: string, ids: readonly number[], at: string): Promise<number> {
      if (!ids.length) return 0;
      return db.update(inboundMail).set({ passExcludedAt: at }).where(and(eq(inboundMail.project, project), inArray(inboundMail.id, [...ids]))).returning({ id: inboundMail.id }).all().length;
    },

    /** The mail passes of a project since `since`, newest first. */
    async passesSince(project: string, since: string) {
      return db.select().from(leadPasses).where(and(eq(leadPasses.project, project), eq(leadPasses.kind, "mail"), gte(leadPasses.startedAt, since))).orderBy(desc(leadPasses.startedAt), desc(leadPasses.id)).all();
    },
  };
}

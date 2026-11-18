import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { STOP_REASONS, type EnrollmentView, type FinishReason, type NotionKind, type SequenceDisplayState, type StopReason } from "@hub/config";
import { addDays, displayStateOf, enrolSnapshot, isDue, transition, type Schedule, type SequenceEvent, type Snapshot } from "@hub/sequences";
import type { Db } from "../client";
import { write } from "../tx";
import { RepoError } from "../errors";
import { clients, drafts, enrollments, marks } from "../schema";
import { parseJson, type DraftRow, type Tx } from "./bulk-shared";

// Follow-up sequences (P47). Every change of an enrollment goes through `transition()` of `@hub/sequences` inside a
// transaction; nothing here writes a state by hand. The hooks (`onClientWrote`, `onStepFinished`, `onStepReopened`) run
// inside the drafts, inbox and clients repositories' own transactions, so a reply finishes the follow-ups in the same
// write that records it. Nothing here sends, schedules or writes Notion; the agent never enrols (the routes and the CLI
// that call `enrol`, `pause` and `resume` are the owner's).

export type EnrollmentRow = typeof enrollments.$inferSelect;
export type NewEnrollment = { project: string; clientId: number; sequence: string; sequenceHash: string; schedule: Schedule; by: string; now?: Date };

/** Our newest message to the client: a draft of theirs that was sent (Sent folder) or that the owner marked done. */
export type Outbound = { draftId: number; at: string; subject: string; mailRef: string | null; sentMessageId: string | null; mailClass: string | null; notionKind: NotionKind | null };

/** An enrollment as a list shows it: the client, the step count, the derived state and the client's open draft. */
export type EnrollmentItem = EnrollmentRow & {
  client: { id: number; name: string; email: string };
  steps: number;
  display: SequenceDisplayState;
  openDraftId: number | null;
  last: Outbound | null;
};

/** A client the owner might enrol: we wrote last, long enough ago, nothing open. Derived on every read, never stored. */
export type Candidate = { client: { id: number; name: string; email: string }; last: Outbound; lastInboundAt: string | null };

const EMPTY_SCHEDULE: Schedule = { delays: [], businessDays: true };
const scheduleOf = (r: Pick<EnrollmentRow, "schedule">): Schedule => parseJson<Schedule>(r.schedule, EMPTY_SCHEDULE);
const snapshotOf = (r: EnrollmentRow): Snapshot => ({ state: r.state, step: r.step, anchorAt: r.anchorAt, nextDueAt: r.nextDueAt, finishedAt: r.finishedAt, finishReason: r.finishReason, schedule: scheduleOf(r) });
const OPEN_STATES = ["active", "paused"] as const;
const isUnique = (e: unknown) => e instanceof Error && /UNIQUE constraint/i.test(e.message);

/** What the owner sees on the skipped step draft when the follow-ups end. */
const SKIP_TEXT: Record<FinishReason, string> = {
  replied: "Client replied",
  bounced: "Follow-ups stopped: bounced",
  opted_out: "Follow-ups stopped: do not contact",
  closed: "Follow-ups stopped: lead closed",
  excluded: "Follow-ups stopped: excluded",
  completed: "Follow-ups finished",
  stopped: "Follow-ups stopped",
};

function apply(tx: Tx, row: EnrollmentRow, e: SequenceEvent, at: string): EnrollmentRow {
  const o = transition(snapshotOf(row), e);
  if (!o.ok) throw new RepoError("wrong_state", o.error);
  const n = o.next;
  const next = tx
    .update(enrollments)
    .set({ state: n.state, step: n.step, anchorAt: n.anchorAt, nextDueAt: n.nextDueAt, finishedAt: n.finishedAt, finishReason: n.finishReason, updatedAt: at })
    .where(eq(enrollments.id, row.id))
    .returning()
    .get();
  if (!next) throw new RepoError("not_found", "No such enrollment");
  if (n.state === "finished" && n.finishReason) skipOpenStep(tx, row.id, SKIP_TEXT[n.finishReason], at);
  return next;
}

/** The open step draft of a finished enrollment is skipped, so a stale nudge cannot be sent. */
function skipOpenStep(tx: Tx, enrollmentId: number, reason: string, at: string): void {
  for (const d of tx.select().from(drafts).where(and(eq(drafts.enrollmentId, enrollmentId), inArray(drafts.status, ["ready", "hold"]))).all()) {
    tx.update(drafts).set({ status: "skipped", skipReason: reason, prevStatus: d.status, prevChecked: d.checked, actedAt: at, updatedAt: at }).where(eq(drafts.id, d.id)).run();
  }
}

export const openEnrollment = (tx: Tx, project: string, clientId: number): EnrollmentRow | null =>
  tx.select().from(enrollments).where(and(eq(enrollments.project, project), eq(enrollments.clientId, clientId), inArray(enrollments.state, [...OPEN_STATES]))).get() ?? null;

/** Our newest outbound message to the client (sent, or done by the owner), or null. */
export function latestOutbound(tx: Tx, clientId: number): Outbound | null {
  const at = sql<string>`coalesce(${drafts.sentAt}, ${drafts.actedAt}, ${drafts.updatedAt})`;
  const r = tx
    .select({ id: drafts.id, at, subject: drafts.subject, mailRef: drafts.mailRef, sentMessageId: drafts.sentMessageId, mailClass: drafts.mailClass, notionKind: drafts.notionKind })
    .from(drafts)
    .where(and(eq(drafts.clientId, clientId), inArray(drafts.status, ["sent", "done"])))
    .orderBy(desc(at), desc(drafts.id))
    .limit(1)
    .get();
  return r ? { draftId: r.id, at: r.at, subject: r.subject, mailRef: r.mailRef, sentMessageId: r.sentMessageId, mailClass: r.mailClass, notionKind: r.notionKind } : null;
}

const openDraftOf = (tx: Tx, clientId: number): DraftRow | null => tx.select().from(drafts).where(and(eq(drafts.clientId, clientId), inArray(drafts.status, ["ready", "hold"]))).get() ?? null;

/**
 * The client wrote (a reply recorded by any skill but the sequence skill's), asked not to be written to, or was crossed off:
 * the open enrollment finishes and its open step draft is skipped, in the caller's transaction. A message dated before our
 * anchor is not a reply. Returns the reason it finished with, or null when there was nothing to finish.
 */
export function onClientWrote(tx: Tx, o: { project: string; clientId: number; reason: Exclude<StopReason, "stopped">; lastInboundAt?: string | null; at: string }): FinishReason | null {
  const row = openEnrollment(tx, o.project, o.clientId);
  if (!row) return null;
  if (o.reason === "replied" && o.lastInboundAt && Date.parse(o.lastInboundAt) <= Date.parse(row.anchorAt)) return null;
  const e: SequenceEvent = o.reason === "replied" ? { type: "reply", at: o.at } : { type: "stop", reason: o.reason, at: o.at };
  return apply(tx, row, e, o.at).finishReason;
}

/** A step draft became sent, done or skipped: the enrollment moves on, once (a later `sent` of a draft already done is no second step). */
export function onStepFinished(tx: Tx, d: Pick<DraftRow, "enrollmentId" | "sequenceStep">, at: string): void {
  if (d.enrollmentId == null || d.sequenceStep == null) return;
  const row = tx.select().from(enrollments).where(eq(enrollments.id, d.enrollmentId)).get();
  if (!row || row.state === "finished" || row.step !== d.sequenceStep) return;
  apply(tx, row, { type: "step_done", step: d.sequenceStep, at }, at);
}

/** Undo (or Reopen) of Done or Skip on a step draft: the step is open again, if it was the last one done. */
export function onStepReopened(tx: Tx, d: Pick<DraftRow, "enrollmentId" | "sequenceStep">, at: string): void {
  if (d.enrollmentId == null || d.sequenceStep == null) return;
  const row = tx.select().from(enrollments).where(eq(enrollments.id, d.enrollmentId)).get();
  if (!row || row.step !== d.sequenceStep + 1) return;
  if (transition(snapshotOf(row), { type: "step_reopened", step: d.sequenceStep, at }).ok) apply(tx, row, { type: "step_reopened", step: d.sequenceStep, at }, at);
}

export function enrollmentsRepo(db: Db) {
  const items = (rows: EnrollmentRow[], now: Date): EnrollmentItem[] => {
    if (rows.length === 0) return [];
    const ids = [...new Set(rows.map((r) => r.clientId))];
    const cs = new Map(db.select({ id: clients.id, name: clients.name, email: clients.email }).from(clients).where(inArray(clients.id, ids)).all().map((c) => [c.id, c]));
    const open = new Map(db.select({ clientId: drafts.clientId, id: drafts.id }).from(drafts).where(and(inArray(drafts.clientId, ids), inArray(drafts.status, ["ready", "hold"]))).all().map((d) => [d.clientId, d.id]));
    return rows.flatMap((r) => {
      const c = cs.get(r.clientId);
      if (!c) return [];
      const openDraftId = open.get(r.clientId) ?? null;
      return [{ ...r, client: c, steps: scheduleOf(r).delays.length, display: displayStateOf(r, now, openDraftId !== null), openDraftId, last: latestOutbound(db, r.clientId) }];
    });
  };
  const own = (tx: Tx, project: string, id: number): EnrollmentRow => {
    const row = tx.select().from(enrollments).where(and(eq(enrollments.id, id), eq(enrollments.project, project))).get();
    if (!row) throw new RepoError("not_found", "No such enrollment in this project");
    return row;
  };
  /** The checks of `enrol` and `notNow`: the client is in the project, has a sent message, no open draft, no open enrollment, no do-not-contact. */
  const admit = (tx: Tx, project: string, clientId: number): Outbound => {
    const c = tx.select({ id: clients.id }).from(clients).where(and(eq(clients.id, clientId), eq(clients.project, project))).get();
    if (!c) throw new RepoError("not_found", "No such client in this project");
    if (tx.select({ id: marks.id }).from(marks).where(and(eq(marks.clientId, clientId), eq(marks.mark, "do_not_contact"))).get()) throw new RepoError("wrong_state", "This client is marked do not contact");
    if (openEnrollment(tx, project, clientId)) throw new RepoError("wrong_state", "This client already has follow-ups running");
    if (openDraftOf(tx, clientId)) throw new RepoError("wrong_state", "This client has an open draft: send or finish it first");
    const last = latestOutbound(tx, clientId);
    if (!last) throw new RepoError("wrong_state", "We have sent this client nothing yet, so there is nothing to follow up");
    return last;
  };
  const insert = (tx: Tx, o: NewEnrollment, snap: Snapshot): EnrollmentRow => {
    const at = (o.now ?? new Date()).toISOString();
    try {
      return tx
        .insert(enrollments)
        .values({ project: o.project, clientId: o.clientId, sequence: o.sequence, sequenceHash: o.sequenceHash, schedule: JSON.stringify(o.schedule), step: snap.step, state: snap.state, nextDueAt: snap.nextDueAt, anchorAt: snap.anchorAt, enrolledAt: at, enrolledBy: o.by, finishedAt: snap.finishedAt, finishReason: snap.finishReason, updatedAt: at })
        .returning()
        .get();
    } catch (e) {
      if (isUnique(e)) throw new RepoError("wrong_state", "This client already has follow-ups running");
      throw e;
    }
  };
  const change = (project: string, id: number, e: (at: string) => SequenceEvent, now?: Date) =>
    write(db, (tx) => {
      const at = (now ?? new Date()).toISOString();
      return apply(tx, own(tx, project, id), e(at), at);
    });

  const list = (project: string, view: EnrollmentView, now: Date): EnrollmentItem[] => {
    if (view === "finished") {
      return items(db.select().from(enrollments).where(and(eq(enrollments.project, project), eq(enrollments.state, "finished"))).orderBy(desc(enrollments.finishedAt), desc(enrollments.id)).limit(200).all(), now);
    }
    const open = items(db.select().from(enrollments).where(and(eq(enrollments.project, project), inArray(enrollments.state, [...OPEN_STATES]))).orderBy(sql`${enrollments.nextDueAt} is null`, enrollments.nextDueAt, enrollments.id).all(), now);
    return view === "due" ? open.filter((e) => isDue(e, now, e.openDraftId !== null)) : open;
  };

  return {
    /** The owner enrols one client: step 1, due after the first wait, counted from our newest sent message. */
    async enrol(o: NewEnrollment): Promise<EnrollmentRow> {
      return write(db, (tx) => insert(tx, o, enrolSnapshot(o.schedule, admit(tx, o.project, o.clientId).at)));
    },

    /** The owner's "Not now" on a candidate: a finished row for this silence, so the client is not offered again until we write again. */
    async notNow(o: NewEnrollment): Promise<EnrollmentRow> {
      return write(db, (tx) => {
        const at = (o.now ?? new Date()).toISOString();
        const anchorAt = admit(tx, o.project, o.clientId).at;
        return insert(tx, o, { state: "finished", step: 1, anchorAt, nextDueAt: null, finishedAt: at, finishReason: "stopped", schedule: o.schedule });
      });
    },

    async stop(project: string, id: number, reason: StopReason = "stopped", now?: Date): Promise<EnrollmentRow> {
      if (!(STOP_REASONS as readonly string[]).includes(reason)) throw new RepoError("wrong_state", `Unknown stop reason "${reason}"`);
      return change(project, id, (at) => (reason === "replied" ? { type: "reply", at } : { type: "stop", reason, at }), now);
    },
    async pause(project: string, id: number, now?: Date): Promise<EnrollmentRow> {
      return change(project, id, (at) => ({ type: "pause", at }), now);
    },
    async resume(project: string, id: number, now?: Date): Promise<EnrollmentRow> {
      return change(project, id, (at) => ({ type: "resume", at }), now);
    },
    /** An out-of-office until `until`: the next step waits; the enrollment stays active. */
    async delay(project: string, id: number, until: string, now?: Date): Promise<EnrollmentRow> {
      if (Number.isNaN(Date.parse(until))) throw new RepoError("wrong_state", `"${until}" is not a date`);
      return change(project, id, () => ({ type: "out_of_office", until: new Date(until).toISOString() }), now);
    },

    async get(project: string, id: number, now: Date = new Date()): Promise<EnrollmentItem | null> {
      const row = db.select().from(enrollments).where(and(eq(enrollments.id, id), eq(enrollments.project, project))).get();
      return row ? (items([row], now)[0] ?? null) : null;
    },

    /** Our newest sent (or done) message to a client of the project, or null. */
    async lastOutbound(project: string, clientId: number): Promise<Outbound | null> {
      const c = db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, clientId), eq(clients.project, project))).get();
      return c ? latestOutbound(db, c.id) : null;
    },

    /** The open enrollment of a client by address, or null. */
    async openFor(project: string, email: string, now: Date = new Date()): Promise<EnrollmentItem | null> {
      const c = db.select({ id: clients.id }).from(clients).where(and(eq(clients.project, project), eq(clients.email, email.trim().toLowerCase()))).get();
      const row = c ? db.select().from(enrollments).where(and(eq(enrollments.project, project), eq(enrollments.clientId, c.id), inArray(enrollments.state, [...OPEN_STATES]))).get() : undefined;
      return row ? (items([row], now)[0] ?? null) : null;
    },

    /** `due`: active, date come, no open draft (soonest first). `active`: every open one. `finished`: the newest 200. */
    async list(project: string, view: EnrollmentView, now: Date = new Date()): Promise<EnrollmentItem[]> {
      return list(project, view, now);
    },

    /**
     * Who the owner might enrol: our newest sent message is newer than their newest inbound, at least `afterDays` old, no
     * `do_not_contact`, no open draft, and no enrollment (open, or a "Not now") already covers that message. Read-only.
     */
    async candidates(project: string, o: { now?: Date; afterDays: number; businessDays: boolean }): Promise<Candidate[]> {
      const now = o.now ?? new Date();
      const rows = db.select().from(clients).where(eq(clients.project, project)).all();
      const blocked = new Set(db.select({ clientId: marks.clientId }).from(marks).where(and(eq(marks.project, project), eq(marks.mark, "do_not_contact"))).all().map((m) => m.clientId));
      const openDraft = new Set(db.select({ clientId: drafts.clientId }).from(drafts).where(and(eq(drafts.project, project), inArray(drafts.status, ["ready", "hold"]))).all().map((d) => d.clientId));
      const covered = new Map<number, string>();
      for (const e of db.select({ clientId: enrollments.clientId, anchorAt: enrollments.anchorAt, state: enrollments.state }).from(enrollments).where(eq(enrollments.project, project)).all()) {
        // An open enrollment covers the client whatever its anchor; a finished one covers its own silence only.
        const key = e.state === "finished" ? e.anchorAt : "9999-12-31T00:00:00.000Z";
        if ((covered.get(e.clientId) ?? "") < key) covered.set(e.clientId, key);
      }
      const out: Candidate[] = [];
      for (const c of rows) {
        if (blocked.has(c.id) || openDraft.has(c.id)) continue;
        const last = latestOutbound(db, c.id);
        if (!last) continue;
        if (c.lastContactAt && Date.parse(c.lastContactAt) >= Date.parse(last.at)) continue;
        if (Date.parse(addDays(last.at, o.afterDays, o.businessDays)) > now.getTime()) continue;
        const cov = covered.get(c.id);
        if (cov && Date.parse(cov) >= Date.parse(last.at)) continue;
        out.push({ client: { id: c.id, name: c.name, email: c.email }, last, lastInboundAt: c.lastContactAt });
      }
      return out.sort((a, b) => a.last.at.localeCompare(b.last.at));
    },

    /** The numbers the Drafts block and `owner-inbox` show. */
    async counts(project: string, now: Date = new Date()): Promise<{ due: number; active: number }> {
      const open = list(project, "active", now);
      return { due: open.filter((e) => isDue(e, now, e.openDraftId !== null)).length, active: open.length };
    },
  };
}

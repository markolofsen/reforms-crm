import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { type EvidenceFinding, type EvidenceLevel, type EvidenceSource, type FinishReason, SETTABLE_STATUSES, TONES, type NotionRef, type DraftStatus, type Mark, type SafetyKind, type SettableStatus, type Tone, type ToneBodies } from "@hub/config";
import type { Db } from "../client";
import { write, type WriteTx } from "../tx";
import { RepoError } from "../errors";
import { clients, drafts } from "../schema";
import { blocksChecked, isSafetyKind } from "../safety";
import { loadSafety, logDraftEvent, now, nowIso, parseJson, type DraftRow } from "./bulk-shared";
import { recordDraft } from "./drafts-record";
import { onStepFinished, onStepReopened } from "./enrollments";
import { insertEvent, sessionRun } from "./runs";
import { bareRef } from "./mail-versions";
import { teamNoticeOf, type TeamNotice } from "./review";

export type NewDraft = Omit<typeof drafts.$inferInsert, "id" | "createdAt" | "updatedAt">;

/**
 * What a session reports after it left one unsent draft in Mail (the draft record (`draft_write`)). The text of the mail is not here:
 * Mail holds the one copy. `excerpt` is an optional short preview for the screen, never the whole body.
 */
export type RecordDraftInput = {
  project: string;
  email: string;
  name: string;
  subject: string;
  /** Message-ID of the message the draft answers (decision 0031 point 2; ours or theirs, P85): the key of re-runs and of the thread Sent detection reads. */
  mailRef?: string | null;
  /**
   * P85: the owner's own words in the session that asked for this message (never the agent's). With them a message whose
   * drafts are all finished gets a NEW draft (not `unchanged`), and the record is the owner writing, so the client's
   * follow-ups are not finished as `replied`. Stored in the draft's context (`ownerRequest`) and its Activity line.
   */
  ownerRequest?: string | null;
  /**
   * P85b: a brand-new thread (no `mailRef`: it answers nothing), written on the owner's words. Its Mail versions are keyed by
   * `newThreadKey(email)`; a rerun updates the client's open new-thread draft; stored in the context (`newThread`).
   */
  newThread?: boolean;
  to?: string | null;
  cc?: string | null;
  reason?: string | null;
  /** The client's Notion page: `client` (a row of the Clients database), `lead` (a lead page) or `none`. */
  notion?: NotionRef | null;
  excerpt?: string | null;
  lastContactAt?: string | null;
  repliesOwed?: boolean;
  /** Added to the client's marks; never removes one the owner set. */
  marks?: Mark[];
  /** The mail this draft answers carried a prompt-injection hint (`injection_suspected`): the hub never sends the draft. Sticky: a re-record cannot clear it. */
  injectionSuspected?: boolean;
  /** Mail class of the project's kind; autosend sends only the classes a project lists. */
  mailClass?: string | null;
  /** The skill that made the draft, for the Agent log line. */
  skill?: string | null;
  /**
   * What the draft was based on, judged by the draft record (`draft_write`) before it wrote (P28). `context` is the validated block;
   * `fingerprint` is the sketch of the reply (ints, never text). Left out, the draft has no evidence and no evidence rule fires.
   */
  evidence?: { level: EvidenceLevel; source: EvidenceSource; findings: EvidenceFinding[]; context?: unknown; similarTo?: string | null; fingerprint?: number[] | null; batchKey?: string | null } | null;
  /** Put the log line in this run (of the same project). Without it the session's run (`evidence.batchKey`) is joined, else one is started. */
  runId?: number | null;
  /** The draft is step `step` of this enrollment (P47, skill `sequence-drafts`): only the open step of an active enrollment is accepted. */
  sequence?: { enrollmentId: number; step: number } | null;
  /** P58/P60: the address the client wrote to and its brand, as the hub's writer resolved them (never the agent's claim). Left out: kept as stored. */
  wroteTo?: string | null;
  brand?: string | null;
  /** The admin's manual composer may create a new thread without an agent owner request. */
  manual?: boolean;
};

/** created: new row; updated: same `mailRef` as the open draft; replaced: another open draft was skipped first; unchanged: this `mailRef` is already a finished draft. */
export type RecordDraftResult = {
  clientId: number;
  draftId: number;
  runId: number;
  action: "created" | "updated" | "replaced" | "unchanged";
  /** P99 S0 (b): false only on `unchanged` (nothing was written); the caller never reports it as recorded. */
  recorded: boolean;
  /** On `unchanged`: the plain sentence for the agent ("not recorded"). */
  message?: string;
  /** Set when this record finished the client's follow-ups (a reply, an opt-out). */ followUps?: FinishReason;
};

const isOpen = (s: DraftStatus) => s === "ready" || s === "hold";
const isFinishedByOwner = (s: DraftStatus) => s === "done" || s === "skipped";

/** P47: a step draft moved by a person (Done, Skip, Undo, Reopen) moves its enrollment in the same transaction. */
function followStatus(tx: WriteTx, before: DraftStatus, after: DraftRow): void {
  if (after.enrollmentId == null) return;
  if (isOpen(before) && isFinishedByOwner(after.status)) onStepFinished(tx, after, nowIso());
  else if (isFinishedByOwner(before) && isOpen(after.status)) onStepReopened(tx, after, nowIso());
}



const isUnique = (e: unknown) => e instanceof Error && /UNIQUE constraint/i.test(e.message);

/**
 * Draft state changes. Every human change keeps the state before it (`prev*`, `actedAt`) for one-step undo and, for a
 * draft in a bulk batch, writes a line to the batch's action log. Nothing here can write `sent`.
 */
export function draftsRepo(db: Db) {
  const row = (id: number) => db.select().from(drafts).where(eq(drafts.id, id)).get() ?? null;

  return {
    async create(input: NewDraft): Promise<number> {
      return db.insert(drafts).values(input).returning({ id: drafts.id }).get().id;
    },

    async get(id: number) {
      return row(id);
    },

    /**
     * The drafts of a project that answer this message (P65 verdict 4: `draft_write` refuses a new reply to a message
     * the project already has a draft for), newest first. The Message-ID is compared bare and lowercased. Read only.
     */
    async byMailRef(project: string, mailRef: string): Promise<DraftRow[]> {
      const ref = bareRef(mailRef);
      if (!ref) return [];
      return db.select().from(drafts).where(and(eq(drafts.project, project), sql`lower(trim(trim(${drafts.mailRef}), '<>')) = ${ref}`)).orderBy(desc(drafts.id)).all();
    },

    /**
     * P87 (B6): the sent draft of a project that went out as this Message-ID (compared bare and lowercased), newest first, or
     * null: a reply to our own sent mail keeps that draft's brand and the address the client wrote to. Read only.
     */
    async bySentMessageId(project: string, messageId: string): Promise<DraftRow | null> {
      const ref = bareRef(messageId);
      if (!ref) return null;
      return db.select().from(drafts).where(and(eq(drafts.project, project), eq(drafts.status, "sent"), sql`lower(trim(trim(${drafts.sentMessageId}), '<>')) = ${ref}`)).orderBy(desc(drafts.id)).limit(1).get() ?? null;
    },

    /** Every draft of one client of a project, newest first (P51: `hub mcp` `client_show`). Read only. */
    async ofClient(project: string, clientId: number): Promise<DraftRow[]> {
      return db.select().from(drafts).where(and(eq(drafts.project, project), eq(drafts.clientId, clientId))).orderBy(desc(drafts.id)).all();
    },

    /**
     * The Checked tick. It is refused (`wrong_state`) while the gate is closed: in a bulk batch every safety result
     * must be acknowledged, on a recorded draft every red one (`blocksChecked`). Returns the updated draft or null.
     */
    async setChecked(id: number, checked: boolean, hash: string | null = null): Promise<DraftRow | null> {
      return write(db, (tx) => {
        const d = tx.select().from(drafts).where(eq(drafts.id, id)).get();
        if (!d) return null;
        if (checked && blocksChecked(loadSafety(tx, d.project, [d]).get(d.id) ?? [], d.batchId != null)) {
          throw new RepoError("wrong_state", "Acknowledge the safety checks first");
        }
        const next = tx
          .update(drafts)
          .set({ checked, checkedHash: checked ? hash : null, prevStatus: d.status, prevChecked: d.checked, actedAt: nowIso(), updatedAt: now })
          .where(eq(drafts.id, id))
          .returning()
          .get();
        if (next) logDraftEvent(tx, next, "decision", checked ? "Checked" : "Unchecked", { action: checked ? "check" : "uncheck" });
        return next ?? null;
      });
    },

    /** Done, skipped, hold, ready. `sent` is refused at run time as well as by the type. */
    async setStatus(id: number, status: SettableStatus, reason?: string | null): Promise<DraftRow | null> {
      if (!(SETTABLE_STATUSES as readonly string[]).includes(status)) {
        throw new RepoError("wrong_state", `The app never sets "${status}": only a mail reader marks a draft sent`);
      }
      return write(db, (tx) => {
        const d = tx.select().from(drafts).where(eq(drafts.id, id)).get();
        if (!d) return null;
        if (d.status === "sent") throw new RepoError("wrong_state", "A sent draft cannot change");
        // P99 S0 (e2): a second close on a stale card does not stack (draft 4: Skip, then Done). Reopen or Undo first.
        if ((status === "done" && d.status === "skipped") || (status === "skipped" && d.status === "done")) {
          throw new RepoError("wrong_state", `Draft ${id} is ${d.status === "skipped" ? "skipped" : "done"}: Reopen or Undo it first`);
        }
        try {
          const next = tx
            .update(drafts)
            .set({ status, skipReason: status === "skipped" ? (reason?.trim() || null) : null, prevStatus: d.status, prevChecked: d.checked, actedAt: nowIso(), updatedAt: now })
            .where(eq(drafts.id, id))
            .returning()
            .get();
          if (next) logDraftEvent(tx, next, "decision", { done: "Marked done", skipped: "Skipped", hold: "Put on hold", ready: "Back to ready" }[status], { action: status, ...(status === "skipped" && reason?.trim() ? { reason: reason.trim() } : {}) });
          if (next) followStatus(tx, d.status, next);
          return next ?? null;
        } catch (e) {
          if (isUnique(e)) throw new RepoError("wrong_state", "This client already has another open draft");
          throw e;
        }
      });
    },

    /** Shows another tone: the body changes, so the Checked tick is cleared (the person must read it again). */
    async setTone(id: number, tone: Tone): Promise<DraftRow | null> {
      if (!(TONES as readonly string[]).includes(tone)) throw new RepoError("wrong_state", `Unknown tone "${tone}"`);
      return write(db, (tx) => {
        const d = tx.select().from(drafts).where(eq(drafts.id, id)).get();
        if (!d) return null;
        const body = parseJson<ToneBodies>(d.tones, {})[tone];
        if (body === undefined) throw new RepoError("wrong_state", `This draft has no "${tone}" version`);
        const next = tx.update(drafts).set({ tone, body, checked: false, checkedHash: null, updatedAt: now }).where(eq(drafts.id, id)).returning().get();
        if (next) logDraftEvent(tx, next, "decision", `Showing the ${tone} version`, { action: "tone", tone });
        return next ?? null;
      });
    },

    /** Acknowledges (or withdraws) one safety result. Returns the draft or null. */
    async acknowledge(id: number, kind: SafetyKind, acked: boolean): Promise<DraftRow | null> {
      if (!isSafetyKind(kind)) throw new RepoError("wrong_state", `Unknown safety kind "${kind}"`);
      return write(db, (tx) => {
        const d = tx.select().from(drafts).where(eq(drafts.id, id)).get();
        if (!d) return null;
        const set = new Set(parseJson<string[]>(d.acked, []));
        if (acked) set.add(kind);
        else set.delete(kind);
        // Withdrawing an acknowledgement also clears Checked: the gate must not be passed by a stale tick.
        const next = tx
          .update(drafts)
          .set({ acked: JSON.stringify([...set]), ...(acked ? {} : { checked: false, checkedHash: null }), updatedAt: now })
          .where(eq(drafts.id, id))
          .returning()
          .get();
        return next ?? null;
      });
    },

    /**
     * P87 (finding 6): "Understood all warnings" of one batch. Every amber safety result of every open draft of the batch is
     * acknowledged, as the owner's act (the route passes the admin gate); red results stay one by one. Logged per draft.
     * Returns how many drafts and results it acknowledged.
     */
    async acknowledgeWarnings(project: string, batchId: number): Promise<{ drafts: number; results: number }> {
      return write(db, (tx) => {
        const rows = tx.select().from(drafts).where(and(eq(drafts.project, project), eq(drafts.batchId, batchId), inArray(drafts.status, ["ready", "hold"]))).all();
        const safety = loadSafety(tx, project, rows);
        let changed = 0;
        let results = 0;
        for (const d of rows) {
          const amber = (safety.get(d.id) ?? []).filter((r) => r.level === "amber" && !r.acked).map((r) => r.kind);
          if (amber.length === 0) continue;
          const set = new Set([...parseJson<string[]>(d.acked, []), ...amber]);
          const next = tx.update(drafts).set({ acked: JSON.stringify([...set]), updatedAt: now }).where(eq(drafts.id, d.id)).returning().get();
          if (next) logDraftEvent(tx, next, "decision", "Understood all warnings", { action: "acknowledge_warnings", kinds: amber });
          changed += 1;
          results += amber.length;
        }
        return { drafts: changed, results };
      });
    },

    record: (input: RecordDraftInput): Promise<RecordDraftResult> => recordDraft(db, input),

    /**
     * A revision the hub's own writer saved (`draft_write {draft}`, coordinator 2026-11-19): the open draft keeps its id,
     * client, mailRef, recipients and context block; its preview text, the brand it answers for and the address the client
     * wrote to are replaced, and "I read the checks" is cleared because the text changed (decision 0013). Logged as
     * "Draft updated" like the draft record (`draft_write`). Refuses a draft that is not open (done, sent, skipped) or of another project.
     */
    async revised(project: string, draftId: number, r: { excerpt: string; wroteTo: string | null; brand: string | null; reason?: string | null }): Promise<{ draftId: number; clientId: number; action: "updated" }> {
      return write(db, (tx) => {
        const d = tx.select().from(drafts).where(and(eq(drafts.id, draftId), eq(drafts.project, project))).get();
        if (!d) throw new RepoError("not_found", `No draft ${draftId} in project ${project}`);
        if (!isOpen(d.status)) throw new RepoError("wrong_state", `Draft ${draftId} is ${d.status}: only a ready or held draft is revised in place`);
        const at = nowIso();
        // P99 S0 (c): a revision may replace the recorded "Why this email"; omitted, it stays.
        const reason = r.reason?.trim() || null;
        tx.update(drafts).set({ body: r.excerpt, wroteTo: r.wroteTo, brand: r.brand, ...(reason ? { reason } : {}), checked: false, checkedHash: null, updatedAt: now }).where(eq(drafts.id, d.id)).run();
        const c = tx.select({ name: clients.name, email: clients.email }).from(clients).where(eq(clients.id, d.clientId)).get();
        const runId = sessionRun(tx, { project, runId: d.runId, skill: "draft_write", at });
        insertEvent(tx, { project, runId, at, kind: "draft_created", summary: `Draft updated: ${c?.name || c?.email || d.toAddr}`, detail: JSON.stringify({ draftId: d.id, action: "update", skill: "draft_write", mailRef: d.mailRef }), clientId: d.clientId, tool: null });
        return { draftId: d.id, clientId: d.clientId, action: "updated" as const };
      });
    },

    /**
     * Drafts that could still turn out to be sent: ready, hold or done (the person may press Send in Mail without
     * pressing Done), made since `since`, bulk or recorded by a session alike. The Sent reconciler reads these and nothing else.
     */
    async awaitingSent(project: string, since: string): Promise<DraftRow[]> {
      return db
        .select()
        .from(drafts)
        .where(and(eq(drafts.project, project), inArray(drafts.status, ["ready", "hold", "done"]), gte(drafts.createdAt, since)))
        .all();
    },

    /**
     * P85: the Sent messages already attributed to a draft of the project (the Message-ID a sent draft was marked with),
     * sent since `since`. Sent detection never gives one of them to another draft.
     */
    async sentMessageIds(project: string, since: string): Promise<string[]> {
      return db
        .select({ id: drafts.sentMessageId })
        .from(drafts)
        .where(and(eq(drafts.project, project), eq(drafts.status, "sent"), gte(drafts.sentAt, since)))
        .all()
        .map((r) => r.id ?? "")
        .filter(Boolean);
    },

    /** Drafts of the project by status, every status present (0 when none). Reads the `drafts_project_status` index; the Overview's one count. */
    async countsByStatus(project: string): Promise<Record<DraftStatus, number>> {
      const out: Record<DraftStatus, number> = { ready: 0, hold: 0, done: 0, sent: 0, skipped: 0 };
      const rows = db
        .select({ status: drafts.status, n: sql<number>`count(*)` })
        .from(drafts)
        .where(eq(drafts.project, project))
        .groupBy(drafts.status)
        .all();
      for (const r of rows) out[r.status] = r.n;
      return out;
    },

    /** Open drafts (ready or hold) whose mail carried an injection hint: the hub never sends them, a person must look. */
    async injectionHeld(project: string): Promise<number> {
      return db
        .select({ n: sql<number>`count(*)` })
        .from(drafts)
        .where(and(eq(drafts.project, project), eq(drafts.injectionSuspected, true), inArray(drafts.status, ["ready", "hold"])))
        .get()?.n ?? 0;
    },

    /** P90: what another person did in this draft's thread or to its client (the card's teammate line), for the agent's tools. */
    async teamNotice(id: number): Promise<TeamNotice> {
      const row = db.select({ d: drafts, c: clients }).from(drafts).innerJoin(clients, eq(drafts.clientId, clients.id)).where(eq(drafts.id, id)).get();
      if (!row) return { repliedElsewhere: null, teamSent: null };
      const last = db.select({ at: sql<string | null>`max(${drafts.sentAt})` }).from(drafts).where(eq(drafts.clientId, row.c.id)).get()?.at ?? null;
      return teamNoticeOf(row.d, row.c, last);
    },

    /**
     * P90: the newest Sent message that answers this draft's thread and is not the Hub's (Sent detection's `elsewhereOf`).
     * Writes only when it is newer than what is stored; never touches the status, `updatedAt` or anything in Mail.
     */
    async markElsewhere(id: number, seen: { at: string; from: string; messageId: string }): Promise<boolean> {
      return write(db, (tx) => {
        const d = tx.select({ at: drafts.elsewhereAt, id: drafts.elsewhereMessageId }).from(drafts).where(eq(drafts.id, id)).get();
        if (!d || d.id === seen.messageId || (d.at && d.at >= seen.at)) return false;
        return tx.update(drafts).set({ elsewhereAt: seen.at, elsewhereFrom: seen.from.slice(0, 200), elsewhereMessageId: seen.messageId }).where(eq(drafts.id, id)).run().changes > 0;
      });
    },

    /**
     * The only place that writes `sent`. It is called by a mail reader that saw the message in the Sent folder, never
     * from a route or a keypress (`SETTABLE_STATUSES` has no `sent`). Idempotent: a draft already sent returns as is;
     * a skipped or unknown one is refused with null. The sent state has no undo.
     */
    async markSent(id: number, seen: { at: string; via: string; messageId: string }): Promise<DraftRow | null> {
      return write(db, (tx) => {
        const d = tx.select().from(drafts).where(eq(drafts.id, id)).get();
        if (!d) return null;
        if (d.status === "sent") return d;
        if (d.status !== "ready" && d.status !== "hold" && d.status !== "done") return null;
        const next = tx
          .update(drafts)
          .set({ status: "sent", sentAt: seen.at, sentVia: seen.via, sentMessageId: seen.messageId, prevStatus: null, prevChecked: null, actedAt: nowIso(), updatedAt: now })
          .where(eq(drafts.id, id))
          .returning()
          .get();
        if (next) logDraftEvent(tx, next, "decision", "Seen in the Sent folder", { action: "sent", via: seen.via, messageId: seen.messageId, at: seen.at });
        // A step marked done earlier has already moved its enrollment; a ready or held one moves now, at the sent date.
        if (next && isOpen(d.status)) onStepFinished(tx, next, seen.at);
        return next ?? null;
      });
    },

    /** One step back: the status and the Checked tick the draft had before its last human action. */
    async undo(id: number): Promise<DraftRow | null> {
      return write(db, (tx) => {
        const d = tx.select().from(drafts).where(eq(drafts.id, id)).get();
        if (!d) return null;
        if (d.prevStatus == null) throw new RepoError("wrong_state", "Nothing to undo for this draft");
        try {
          const next = tx
            .update(drafts)
            .set({ status: d.prevStatus, skipReason: null, checked: d.prevChecked ?? false, prevStatus: null, prevChecked: null, actedAt: null, updatedAt: now })
            .where(eq(drafts.id, id))
            .returning()
            .get();
          if (next) logDraftEvent(tx, next, "decision", "Undid the last action", { action: "undo" });
          if (next) followStatus(tx, d.status, next);
          return next ?? null;
        } catch (e) {
          if (isUnique(e)) throw new RepoError("wrong_state", "This client already has another open draft");
          throw e;
        }
      });
    },
  };
}

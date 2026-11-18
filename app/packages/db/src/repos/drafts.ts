import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { type EvidenceFinding, type EvidenceLevel, type EvidenceSource, type FinishReason, MARKS, SEQUENCE_SKILL, SETTABLE_STATUSES, TONES, type NotionRef, type DraftStatus, type Mark, type SafetyKind, type SettableStatus, type Tone, type ToneBodies } from "@hub/config";
import type { Db } from "../client";
import { write, type WriteTx } from "../tx";
import { RepoError } from "../errors";
import { drafts, enrollments, marks } from "../schema";
import { blocksChecked, isSafetyKind } from "../safety";
import { loadSafety, logDraftEvent, nowIso, parseJson, type DraftRow } from "./bulk-shared";
import { touchClient } from "./clients";
import { onClientWrote, onStepFinished, onStepReopened } from "./enrollments";
import { upsertInbox } from "./inbox";
import { insertEvent, sessionRun } from "./runs";

export type NewDraft = Omit<typeof drafts.$inferInsert, "id" | "createdAt" | "updatedAt">;

/**
 * What a session reports after it left one unsent draft in Mail (`hub record-draft`). The text of the mail is not here:
 * Mail holds the one copy. `excerpt` is an optional short preview for the screen, never the whole body.
 */
export type RecordDraftInput = {
  project: string;
  email: string;
  name: string;
  subject: string;
  /** Message-ID of the thread, or the id of the draft the agent made in Mail: the key of re-runs and of Sent matching. */
  mailRef?: string | null;
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
   * What the draft was based on, judged by `hub record-draft` before it wrote (P28). `context` is the validated block;
   * `fingerprint` is the sketch of the reply (ints, never text). Left out, the draft has no evidence and no evidence rule fires.
   */
  evidence?: { level: EvidenceLevel; source: EvidenceSource; findings: EvidenceFinding[]; context?: unknown; similarTo?: string | null; fingerprint?: number[] | null; batchKey?: string | null } | null;
  /** Put the log line in this run (of the same project). Without it the session's run (`evidence.batchKey`) is joined, else one is started. */
  runId?: number | null;
  /** The draft is step `step` of this enrollment (P47, skill `sequence-drafts`): only the open step of an active enrollment is accepted. */
  sequence?: { enrollmentId: number; step: number } | null;
};

/** created: new row; updated: same `mailRef` as the open draft; replaced: another open draft was skipped first; unchanged: this `mailRef` is already a finished draft. */
export type RecordDraftResult = { clientId: number; draftId: number; runId: number; action: "created" | "updated" | "replaced" | "unchanged"; /** Set when this record finished the client's follow-ups (a reply, an opt-out). */ followUps?: FinishReason };

const isOpen = (s: DraftStatus) => s === "ready" || s === "hold";
const isFinishedByOwner = (s: DraftStatus) => s === "done" || s === "skipped";

/** P47: a step draft moved by a person (Done, Skip, Undo, Reopen) moves its enrollment in the same transaction. */
function followStatus(tx: WriteTx, before: DraftStatus, after: DraftRow): void {
  if (after.enrollmentId == null) return;
  if (isOpen(before) && isFinishedByOwner(after.status)) onStepFinished(tx, after, nowIso());
  else if (isFinishedByOwner(before) && isOpen(after.status)) onStepReopened(tx, after, nowIso());
}

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

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
     * The one writer of a draft a session made outside a batch. One transaction: find or create the client, then the
     * draft. The same `mailRef` as the client's open draft updates it (a re-run is idempotent); another one marks the
     * old draft `skipped` first (the unique index `drafts_client_open` allows one open draft) and inserts. Never
     * writes `sent`, never deletes. A `do_not_contact` mark does not stop the record: the safety layer flags it.
     */
    async record(input: RecordDraftInput): Promise<RecordDraftResult> {
      for (const m of input.marks ?? []) if (!(MARKS as readonly string[]).includes(m)) throw new RepoError("wrong_state", `Unknown mark "${m}"`);
      return write(db, (tx) => {
        const at = nowIso();
        const client = touchClient(tx, input);
        for (const mark of new Set(input.marks ?? [])) {
          tx.insert(marks).values({ project: input.project, clientId: client.id, mark }).onConflictDoNothing().run();
        }
        const runId = sessionRun(tx, { project: input.project, runId: input.runId, batchKey: input.evidence?.batchKey, skill: input.skill, at });
        const log = (kind: "draft_created" | "decision", summary: string, detail: Record<string, unknown>) =>
          insertEvent(tx, { project: input.project, runId, at, kind, summary: `${summary}: ${input.name || input.email}`, detail: JSON.stringify(detail), clientId: client.id, tool: null });

        // P47. A step draft must be the open step of an active enrollment of this client. Any other record (but the sequence
        // skill's own) is the client writing back: their follow-ups finish here, in this transaction, and the open step draft is skipped.
        const seq = input.sequence ?? null;
        let followUps: FinishReason | null = null;
        if (seq) {
          const e = tx.select().from(enrollments).where(eq(enrollments.id, seq.enrollmentId)).get();
          if (!e || e.project !== input.project || e.clientId !== client.id) throw new RepoError("not_found", "No such enrollment for this client in this project");
          if (e.state !== "active") throw new RepoError("wrong_state", `The follow-ups of this client are ${e.state}${e.finishReason ? ` (${e.finishReason})` : ""}: no step is due`);
          if (e.step !== seq.step) throw new RepoError("wrong_state", `Step ${seq.step} is not the open step (${e.step})`);
        } else if (input.skill !== SEQUENCE_SKILL) {
          followUps = onClientWrote(tx, { project: input.project, clientId: client.id, reason: (input.marks ?? []).includes("do_not_contact") ? "opted_out" : "replied", lastInboundAt: input.lastContactAt ?? null, at });
        }
        const stopped = followUps ? { followUps } : {};

        const mailRef = input.mailRef ?? null;
        // The triage list: a recorded draft is a client the agent handled, whatever else happens below.
        upsertInbox(tx, { project: input.project, email: input.email, name: input.name, action: input.injectionSuspected ? "injection_suspected" : "drafted", subject: input.subject, mailRef, lastInboundAt: input.lastContactAt ?? null, mailClass: input.mailClass ?? null, reason: input.reason ?? null, repliesOwed: input.repliesOwed ?? true, notion: input.notion ?? null, skill: input.skill ?? null }, at);
        const fields = {
          subject: input.subject,
          toAddr: (input.to ?? input.email).trim().toLowerCase(),
          ccAddr: input.cc ?? null,
          reason: input.reason ?? null,
          notionKind: input.notion?.kind ?? null,
          notionPageId: input.notion?.pageId ?? null,
          notionUrl: input.notion?.url ?? null,
          body: input.excerpt ?? "",
          mailRef,
          mailClass: input.mailClass ?? null,
          ...(input.evidence
            ? {
                evidence: input.evidence.level,
                evidenceSource: input.evidence.source,
                evidenceFindings: JSON.stringify(input.evidence.findings),
                context: input.evidence.context === undefined ? null : JSON.stringify(input.evidence.context),
                similarTo: input.evidence.similarTo ?? null,
                fingerprint: input.evidence.fingerprint?.length ? JSON.stringify(input.evidence.fingerprint) : null,
                batchKey: input.evidence.batchKey ?? null,
              }
            : {}),
        };
        const flagged = input.injectionSuspected === true;
        const existing = tx.select().from(drafts).where(eq(drafts.clientId, client.id)).all();
        // A follow-up step answers our own earlier message, so its mailRef can equal a finished draft's: a rerun of a step is the same step.
        const sameRef = mailRef == null ? undefined : existing.find((d) => d.mailRef === mailRef && (!seq || (d.enrollmentId === seq.enrollmentId && d.sequenceStep === seq.step)));
        const open = existing.find((d) => d.status === "ready" || d.status === "hold");

        if (sameRef && sameRef !== open) {
          // Finished (done, sent or skipped) and the same message: a re-run must not bring it back.
          return { clientId: client.id, draftId: sameRef.id, runId, action: "unchanged" as const, ...stopped };
        }
        if (open && sameRef === open) {
          // A revision of the same draft (P51): new text, so "I read the checks" no longer holds (decision 0013).
          tx.update(drafts).set({ ...fields, ...(flagged ? { injectionSuspected: true } : {}), checked: false, checkedHash: null, updatedAt: now }).where(eq(drafts.id, open.id)).run();
          log("draft_created", "Draft updated", { draftId: open.id, action: "update", skill: input.skill ?? null, mailRef });
          return { clientId: client.id, draftId: open.id, runId, action: "updated" as const, ...stopped };
        }
        if (open && seq) throw new RepoError("wrong_state", "This client has an open draft: a follow-up step is not recorded over it");
        if (open) {
          tx.update(drafts).set({ status: "skipped", skipReason: "Replaced by a newer draft", prevStatus: open.status, prevChecked: open.checked, actedAt: at, updatedAt: now }).where(eq(drafts.id, open.id)).run();
          log("decision", "Replaced by a newer draft", { draftId: open.id, action: "replaced" });
        }
        const d = tx
          .insert(drafts)
          .values({ project: input.project, clientId: client.id, runId, batchId: null, ...fields, injectionSuspected: flagged, status: "ready", ...(seq ? { enrollmentId: seq.enrollmentId, sequenceStep: seq.step } : {}) })
          .returning({ id: drafts.id })
          .get();
        log("draft_created", "Draft recorded", { draftId: d.id, action: "create", skill: input.skill ?? null, mailRef });
        return { clientId: client.id, draftId: d.id, runId, action: open ? ("replaced" as const) : ("created" as const), ...stopped };
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

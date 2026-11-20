import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { BULK_SKILL, type EvidenceFinding, type EvidenceLevel, type EvidenceSource, type FinishReason, MARKS, SEQUENCE_SKILL, SETTABLE_STATUSES, TONES, type NotionRef, type DraftStatus, type Mark, type SafetyKind, type SettableStatus, type Tone, type ToneBodies } from "@hub/config";
import type { Db } from "../client";
import { write, type WriteTx } from "../tx";
import { RepoError } from "../errors";
import { batches, clients, drafts, enrollments, mailVersions, marks } from "../schema";
import { blocksChecked, isSafetyKind } from "../safety";
import { loadSafety, logDraftEvent, nowIso, parseJson, type DraftRow } from "./bulk-shared";
import { touchClient } from "./clients";
import { onClientWrote, onStepFinished, onStepReopened } from "./enrollments";
import { upsertInbox } from "./inbox";
import { insertEvent, sessionRun } from "./runs";
import { bareRef } from "./mail-versions";

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
  /** Message-ID of the message the draft answers (decision 0031 point 2; ours or theirs, P85): the key of re-runs and of the thread Sent detection reads. */
  mailRef?: string | null;
  /**
   * P85: the owner's own words in the session that asked for this message (never the agent's). With them a message whose
   * drafts are all finished gets a NEW draft (not `unchanged`), and the record is the owner writing, so the client's
   * follow-ups are not finished as `replied`. Stored in the draft's context (`ownerRequest`) and its Activity line.
   */
  ownerRequest?: string | null;
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
  /** P58/P60: the address the client wrote to and its brand, as the hub's writer resolved them (never the agent's claim). Left out: kept as stored. */
  wroteTo?: string | null;
  brand?: string | null;
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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The evidence block's `context`, with the owner's words beside it (P85). Null when there is neither. */
function contextJson(context: unknown, ownerRequest: string | null): string | null {
  if (!ownerRequest) return context === undefined ? null : JSON.stringify(context);
  return JSON.stringify({ ...(isRecord(context) ? context : {}), ownerRequest });
}

const purposeOf = (context: unknown): string | null => (isRecord(context) && typeof context.purpose === "string" ? context.purpose.trim() || null : null);

/**
 * P85: the batch of one `bulk-drafts` run (its `agent_runs` row, joined by `batchKey`): made by the run's first written
 * draft, joined by the rest; the client is added to its list once. Name and brief are the owner's words (or the run's
 * purpose). This is the only writer of `batches` (decision 0025: a batch is the agent's, the admin only views it).
 */
function joinBatch(tx: WriteTx, o: { project: string; runId: number; clientId: number; brief: string | null; batchKey: string; at: string }): number {
  const found = tx.select().from(batches).where(and(eq(batches.project, o.project), eq(batches.runId, o.runId))).get();
  const row = found ?? tx.insert(batches).values({ project: o.project, name: batchName(o.brief, o.batchKey), intent: "custom", status: "ready", audience: "agent", clientIds: "[]", total: 0, excluded: "{}", brief: o.brief, runId: o.runId, createdAt: o.at }).returning().get();
  const ids = parseJson<number[]>(row.clientIds, []);
  if (!ids.includes(o.clientId)) {
    ids.push(o.clientId);
    tx.update(batches).set({ clientIds: JSON.stringify(ids), total: ids.length }).where(eq(batches.id, row.id)).run();
  }
  return row.id;
}

const batchName = (brief: string | null, key: string): string => {
  const line = (brief ?? "").replace(/\s+/g, " ").trim();
  return line ? (line.length > 60 ? `${line.slice(0, 59)}…` : line) : key;
};

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

        const ownerRequest = input.ownerRequest?.trim() || null;
        // P47. A step draft must be the open step of an active enrollment of this client. Any other record (but the sequence
        // skill's own) is the client writing back: their follow-ups finish here, in this transaction, and the open step draft is skipped.
        const seq = input.sequence ?? null;
        let followUps: FinishReason | null = null;
        if (seq) {
          const e = tx.select().from(enrollments).where(eq(enrollments.id, seq.enrollmentId)).get();
          if (!e || e.project !== input.project || e.clientId !== client.id) throw new RepoError("not_found", "No such enrollment for this client in this project");
          if (e.state !== "active") throw new RepoError("wrong_state", `The follow-ups of this client are ${e.state}${e.finishReason ? ` (${e.finishReason})` : ""}: no step is due`);
          if (e.step !== seq.step) throw new RepoError("wrong_state", `Step ${seq.step} is not the open step (${e.step})`);
        } else if (input.skill !== SEQUENCE_SKILL && !ownerRequest) {
          // P85: a message on the owner's initiative is not the client writing back; their follow-ups stay as they are.
          followUps = onClientWrote(tx, { project: input.project, clientId: client.id, reason: (input.marks ?? []).includes("do_not_contact") ? "opted_out" : "replied", lastInboundAt: input.lastContactAt ?? null, at });
        }
        const stopped = followUps ? { followUps } : {};

        const mailRef = input.mailRef ?? null;
        // The triage list: a recorded draft is a client the agent handled, whatever else happens below.
        // P85: a message on the owner's initiative owes the client no reply (repliesOwed false unless stated).
        upsertInbox(tx, { project: input.project, email: input.email, name: input.name, action: input.injectionSuspected ? "injection_suspected" : "drafted", subject: input.subject, mailRef, lastInboundAt: input.lastContactAt ?? null, mailClass: input.mailClass ?? null, reason: input.reason ?? null, repliesOwed: input.repliesOwed ?? !ownerRequest, notion: input.notion ?? null, skill: input.skill ?? null }, at);
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
          ...(input.wroteTo !== undefined ? { wroteTo: input.wroteTo } : {}),
          ...(input.brand !== undefined ? { brand: input.brand } : {}),
          ...(input.evidence
            ? {
                evidence: input.evidence.level,
                evidenceSource: input.evidence.source,
                evidenceFindings: JSON.stringify(input.evidence.findings),
                context: contextJson(input.evidence.context, ownerRequest),
                similarTo: input.evidence.similarTo ?? null,
                fingerprint: input.evidence.fingerprint?.length ? JSON.stringify(input.evidence.fingerprint) : null,
                batchKey: input.evidence.batchKey ?? null,
              }
            : ownerRequest
              ? { context: contextJson(undefined, ownerRequest) }
              : {}),
        };
        // P85: a campaign (`bulk-drafts`, one `batchKey`) is one batch in Drafts; joined only by a draft that is written.
        const batchKey = input.evidence?.batchKey?.trim() || null;
        const inBatch = (): { batchId?: number } => (input.skill === BULK_SKILL && batchKey ? { batchId: joinBatch(tx, { project: input.project, runId, clientId: client.id, brief: ownerRequest ?? purposeOf(input.evidence?.context), batchKey, at }) } : {});
        const flagged = input.injectionSuspected === true;
        const existing = tx.select().from(drafts).where(eq(drafts.clientId, client.id)).all();
        // A follow-up step answers our own earlier message, so its mailRef can equal a finished draft's: a rerun of a step is the same step.
        // The same Message-ID with or without angle brackets (draft_write returns it bare, P52) is the same message.
        // P85: a message can have a finished draft and, on the owner's words, an open one; the open one is the rerun's.
        const open = existing.find((d) => d.status === "ready" || d.status === "hold");
        const matches = mailRef == null ? [] : existing.filter((d) => bareRef(d.mailRef) === bareRef(mailRef) && (!seq || (d.enrollmentId === seq.enrollmentId && d.sequenceStep === seq.step)));
        const sameRef = matches.find((d) => d === open) ?? matches[0];

        // P65: the Mail versions `draft_write` saved for this thread before this record become this draft's.
        const linkVersions = (draftId: number) => {
          if (mailRef) tx.update(mailVersions).set({ draftId }).where(and(eq(mailVersions.project, input.project), eq(mailVersions.mailRef, bareRef(mailRef)), isNull(mailVersions.draftId))).run();
        };
        if (sameRef && sameRef !== open && !ownerRequest) {
          // Finished (done, sent or skipped) and the same message: a re-run must not bring it back. The owner's own words
          // (P85) ask for a new message, so they record a new draft beside the finished one.
          return { clientId: client.id, draftId: sameRef.id, runId, action: "unchanged" as const, ...stopped };
        }
        if (open && sameRef === open) {
          // A revision of the same draft (P51): new text, so "I read the checks" no longer holds (decision 0013).
          tx.update(drafts).set({ ...fields, ...inBatch(), ...(flagged ? { injectionSuspected: true } : {}), checked: false, checkedHash: null, updatedAt: now }).where(eq(drafts.id, open.id)).run();
          log("draft_created", "Draft updated", { draftId: open.id, action: "update", skill: input.skill ?? null, mailRef });
          linkVersions(open.id);
          return { clientId: client.id, draftId: open.id, runId, action: "updated" as const, ...stopped };
        }
        if (open && seq) throw new RepoError("wrong_state", "This client has an open draft: a follow-up step is not recorded over it");
        // P85: a message on the owner's words never pushes aside a draft that waits for his review (a reply the client is
        // owed, or an open follow-up step): he closes or revises that one first.
        if (open && ownerRequest) throw new RepoError("wrong_state", `This client has an open draft (${open.id}${open.enrollmentId != null ? ", a follow-up step" : ""}): revise it, or Skip or Done it, before a new message on your words is recorded`);
        if (open) {
          tx.update(drafts).set({ status: "skipped", skipReason: "Replaced by a newer draft", prevStatus: open.status, prevChecked: open.checked, actedAt: at, updatedAt: now }).where(eq(drafts.id, open.id)).run();
          log("decision", "Replaced by a newer draft", { draftId: open.id, action: "replaced" });
        }
        const d = tx
          .insert(drafts)
          .values({ project: input.project, clientId: client.id, runId, batchId: null, ...fields, ...inBatch(), injectionSuspected: flagged, status: "ready", ...(seq ? { enrollmentId: seq.enrollmentId, sequenceStep: seq.step } : {}) })
          .returning({ id: drafts.id })
          .get();
        log("draft_created", "Draft recorded", { draftId: d.id, action: "create", skill: input.skill ?? null, mailRef, ...(ownerRequest ? { ownerRequest } : {}) });
        linkVersions(d.id);
        return { clientId: client.id, draftId: d.id, runId, action: open ? ("replaced" as const) : ("created" as const), ...stopped };
      });
    },

    /**
     * A revision the hub's own writer saved (`draft_write {draft}`, coordinator 2026-11-19): the open draft keeps its id,
     * client, mailRef, recipients and context block; its preview text, the brand it answers for and the address the client
     * wrote to are replaced, and "I read the checks" is cleared because the text changed (decision 0013). Logged as
     * "Draft updated" like `hub record-draft`. Refuses a draft that is not open (done, sent, skipped) or of another project.
     */
    async revised(project: string, draftId: number, r: { excerpt: string; wroteTo: string | null; brand: string | null }): Promise<{ draftId: number; clientId: number; action: "updated" }> {
      return write(db, (tx) => {
        const d = tx.select().from(drafts).where(and(eq(drafts.id, draftId), eq(drafts.project, project))).get();
        if (!d) throw new RepoError("not_found", `No draft ${draftId} in project ${project}`);
        if (!isOpen(d.status)) throw new RepoError("wrong_state", `Draft ${draftId} is ${d.status}: only a ready or held draft is revised in place`);
        const at = nowIso();
        tx.update(drafts).set({ body: r.excerpt, wroteTo: r.wroteTo, brand: r.brand, checked: false, checkedHash: null, updatedAt: now }).where(eq(drafts.id, d.id)).run();
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

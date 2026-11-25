import { and, eq, isNull } from "drizzle-orm";
import { BULK_SKILL, newThreadKey, type FinishReason, MARKS, SEQUENCE_SKILL } from "@hub/config";
import type { Db } from "../client";
import { write, type WriteTx } from "../tx";
import { RepoError } from "../errors";
import { batches, drafts, enrollments, mailVersions, marks } from "../schema";
import { now, nowIso, parseJson } from "./bulk-shared";
import { touchClient } from "./clients";
import { onClientWrote } from "./enrollments";
import { upsertInbox } from "./inbox";
import { insertEvent, sessionRun } from "./runs";
import { bareRef } from "./mail-versions";
import { joinLeadBatch, stampLeadDraft } from "./lead-pass";
import type { RecordDraftInput, RecordDraftResult } from "./drafts";

// P126 DB1: the one writer of a draft a session made outside a batch, and the helpers only it uses.
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The record's `context`, with the owner's words beside it (P85). Null when there is neither. */
function contextJson(context: unknown, ownerRequest: string | null, newThread = false): string | null {
  if (!ownerRequest && !newThread) return context === undefined ? null : JSON.stringify(context);
  return JSON.stringify({ ...(isRecord(context) ? context : {}), ...(ownerRequest ? { ownerRequest } : {}), ...(newThread ? { newThread: true } : {}) });
}

/** P85b: a draft recorded as a new thread (no mailRef, `newThread` in its context). */
const isNewThreadRow = (d: { mailRef: string | null; context: string | null }): boolean => d.mailRef == null && parseJson<Record<string, unknown> | null>(d.context, null)?.newThread === true;

const purposeOf = (context: unknown): string | null => (isRecord(context) && typeof context.purpose === "string" ? context.purpose.trim() || null : null);

/**
 * P85: the batch of one `bulk-drafts` run (its `agent_runs` row, joined by `batchKey`): made by the run's first written
 * draft, joined by the rest; the client is added to its list once. Name and brief are the owner's words (or the run's
 * purpose). This is the only writer of `batches` (decision 0025: a batch is the agent's, the admin only views it).
 */
function joinBatch(tx: WriteTx, o: { project: string; runId: number; clientId: number; brief: string | null; title: string | null; at: string }): number {
  const found = tx.select().from(batches).where(and(eq(batches.project, o.project), eq(batches.runId, o.runId))).get();
  const row = found ?? tx.insert(batches).values({ project: o.project, name: batchName(o.title, o.at), intent: "custom", status: "ready", audience: "agent", clientIds: "[]", total: 0, excluded: "{}", brief: o.brief, runId: o.runId, createdAt: o.at }).returning().get();
  const ids = parseJson<number[]>(row.clientIds, []);
  if (!ids.includes(o.clientId)) {
    ids.push(o.clientId);
    tx.update(batches).set({ clientIds: JSON.stringify(ids), total: ids.length }).where(eq(batches.id, row.id)).run();
  }
  return row.id;
}

/**
 * P87 (finding 8): a batch's name is the agent's short English title (`context.batchTitle`), else "Campaign 20 Nov 2026". The
 * owner's phrase stays the brief; a title in another script (the owner's words pasted as the title) is not taken.
 */
export const batchName = (title: string | null, at: string): string => {
  const t = (title ?? "").replace(/\s+/g, " ").trim();
  if (t && !/[\u0400-\u04ff]/.test(t)) return t.length > 60 ? `${t.slice(0, 59)}…` : t;
  const d = new Date(at);
  return `Campaign ${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const titleOf = (context: unknown): string | null => (isRecord(context) && typeof context.batchTitle === "string" ? context.batchTitle.trim() || null : null);

/**
 * P87 (B2): the run key of a `bulk-drafts` record. The agent's `batchKey`, else one derived from the owner's words and the day,
 * so every record of one phrase joins one run and one batch (the agent once left the key out and the campaign was no batch).
 * Neither: null, and the record is refused.
 */
export function bulkKeyOf(batchKey: string | null | undefined, ownerRequest: string | null, at: string): string | null {
  const key = batchKey?.trim();
  if (key) return key;
  const words = ownerRequest?.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  if (!words) return null;
  let h = 0x811c9dc5;
  for (const ch of words) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  return `owner-${at.slice(0, 10)}-${h.toString(16).padStart(8, "0")}`;
}

/**
 * The one writer of a draft a session made outside a batch. One transaction: find or create the client, then the
 * draft. The same `mailRef` as the client's open draft updates it (a re-run is idempotent); another one marks the
 * old draft `skipped` first (the unique index `drafts_client_open` allows one open draft) and inserts. Never
 * writes `sent`, never deletes. A `do_not_contact` mark does not stop the record: the safety layer flags it.
 */
export async function recordDraft(db: Db, input: RecordDraftInput): Promise<RecordDraftResult> {
  for (const m of input.marks ?? []) if (!(MARKS as readonly string[]).includes(m)) throw new RepoError("wrong_state", `Unknown mark "${m}"`);
  return write(db, (tx) => {
    const at = nowIso();
    const client = touchClient(tx, input);
    for (const mark of new Set(input.marks ?? [])) {
      tx.insert(marks).values({ project: input.project, clientId: client.id, mark }).onConflictDoNothing().run();
    }
    const ownerWords = input.ownerRequest?.trim() || null;
    // P87 (B2): a campaign record always has a run key, so its drafts are one batch whether or not the agent passed one.
    const runKey = input.skill === BULK_SKILL ? bulkKeyOf(input.batchKey, ownerWords, at) : (input.batchKey ?? null);
    if (input.skill === BULK_SKILL && !runKey) throw new RepoError("wrong_state", "A bulk-drafts record needs context.batchKey (one per run, the same for every client of the run) or ownerRequest (the owner's words): without either its drafts are no batch");
    const runId = sessionRun(tx, { project: input.project, runId: input.runId, batchKey: runKey, skill: input.skill, at });
    const log = (kind: "draft_created" | "decision", summary: string, detail: Record<string, unknown>) =>
      insertEvent(tx, { project: input.project, runId, at, kind, summary: `${summary}: ${input.name || input.email}`, detail: JSON.stringify(detail), clientId: client.id, tool: null });

    const ownerRequest = ownerWords;
    const newThread = input.newThread === true;
    if (newThread && !ownerRequest && input.manual !== true) throw new RepoError("wrong_state", "A new thread is recorded only on the owner's words (ownerRequest)");
    if (newThread && input.mailRef) throw new RepoError("wrong_state", "A new thread answers no message: no mailRef");
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
      ...(input.followUpN != null ? { followUpN: input.followUpN } : {}),
      ...(input.brand !== undefined ? { brand: input.brand } : {}),
      ...(input.context !== undefined || ownerRequest || newThread ? { context: contextJson(input.context ?? undefined, ownerRequest, newThread) } : {}),
      ...(input.findings ? { findings: JSON.stringify(input.findings) } : {}),
      ...(input.batchKey !== undefined || runKey ? { batchKey: runKey } : {}),
    };
    // P85: a campaign (`bulk-drafts`, one `batchKey`) is one batch in Drafts; joined only by a draft that is written.
    const lead = input.leadPass ?? null;
    // P147 verdict 6: a lead pass draft joins the day's lead batch (one review a day), whatever run wrote it.
    const inBatch = (): { batchId?: number } =>
      lead ? { batchId: joinLeadBatch(tx, { project: input.project, day: lead.day, clientId: client.id, runId, at }) } : input.skill === BULK_SKILL && runKey ? { batchId: joinBatch(tx, { project: input.project, runId, clientId: client.id, brief: ownerRequest ?? purposeOf(input.context), title: titleOf(input.context), at }) } : {};
    const stamp = (draftId: number) => (lead ? stampLeadDraft(tx, { project: input.project, pageId: lead.pageId, passId: lead.passId, draftId }) : undefined);
    const flagged = input.injectionSuspected === true;
    const existing = tx.select().from(drafts).where(eq(drafts.clientId, client.id)).all();
    // A follow-up step answers our own earlier message, so its mailRef can equal a finished draft's: a rerun of a step is the same step.
    // The same Message-ID with or without angle brackets (draft_write returns it bare, P52) is the same message.
    // P85: a message can have a finished draft and, on the owner's words, an open one; the open one is the rerun's.
    const open = existing.find((d) => d.status === "ready" || d.status === "hold");
    const matches = newThread ? existing.filter(isNewThreadRow) : mailRef == null ? [] : existing.filter((d) => bareRef(d.mailRef) === bareRef(mailRef) && (!seq || (d.enrollmentId === seq.enrollmentId && d.sequenceStep === seq.step)));
    const sameRef = matches.find((d) => d === open) ?? matches[0];

    // P65: the Mail versions `draft_write` saved for this thread before this record become this draft's.
    const linkVersions = (draftId: number) => {
      const key = mailRef ?? (newThread ? newThreadKey(input.email) : null);
      if (key) tx.update(mailVersions).set({ draftId }).where(and(eq(mailVersions.project, input.project), eq(mailVersions.mailRef, bareRef(key)), isNull(mailVersions.draftId))).run();
    };
    if (sameRef && sameRef !== open && !ownerRequest) {
      // Finished (done, sent or skipped) and the same message: a re-run must not bring it back. The owner's own words
      // (P85) ask for a new message, so they record a new draft beside the finished one.
      return { clientId: client.id, draftId: sameRef.id, runId, action: "unchanged" as const, recorded: false, message: `Not recorded: draft ${sameRef.id} is ${sameRef.status} (finished) and answers this message; nothing was recorded. A new message needs ownerRequest (the owner's words) and its own draft_write reply to the newest message of the thread.`, ...stopped };
    }
    if (open && sameRef === open) {
      // A revision of the same draft (P51): new text, so "I read the checks" no longer holds (decision 0013).
      tx.update(drafts).set({ ...fields, ...inBatch(), ...(flagged ? { injectionSuspected: true } : {}), checked: false, checkedHash: null, updatedAt: now }).where(eq(drafts.id, open.id)).run();
      log("draft_created", "Draft updated", { draftId: open.id, action: "update", skill: input.skill ?? null, mailRef });
      linkVersions(open.id);
      stamp(open.id);
      return { clientId: client.id, draftId: open.id, runId, action: "updated" as const, recorded: true, ...stopped };
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
    stamp(d.id);
    return { clientId: client.id, draftId: d.id, runId, action: open ? ("replaced" as const) : ("created" as const), recorded: true, ...stopped };
  });
}

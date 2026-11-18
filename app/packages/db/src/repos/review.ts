import { inArray } from "drizzle-orm";
import { type EnrollmentState, type EvidenceFinding, type EvidenceLevel, type EvidenceSource, type Mark, type SafetyResult, type ToneBodies } from "@hub/config";
import { blocksChecked } from "../safety";
import { clients, enrollments, marks } from "../schema";
import { loadSafety, parseJson, type DraftRow, type Tx } from "./bulk-shared";

type ClientRaw = typeof clients.$inferSelect;

/** One draft as the review screen needs it: the same for a recorded draft and a draft of a bulk batch. */
export type ReviewDraft = DraftRow & {
  toneBodies: ToneBodies;
  safetyResults: SafetyResult[];
  /** Checked is refused right now (the same rule `drafts.setChecked` enforces). */
  blocked: boolean;
  client: { id: number; name: string; email: string; repliesOwed: boolean; lastContactAt: string | null; marks: Mark[] };
  /** What the draft was based on: the stored evidence block, parsed. Null when the draft has none. */
  basedOn: BasedOn | null;
  /** The follow-up sequence this draft is a step of (P47), or null. */
  sequence: StepOf | null;
};

export type StepOf = { enrollmentId: number; sequence: string; step: number; steps: number; state: EnrollmentState };

export type BasedOn = {
  level: EvidenceLevel;
  source: EvidenceSource | null;
  findings: EvidenceFinding[];
  similarTo: string | null;
  context: Record<string, unknown>;
};

/** Adds the client, the marks, the tone bodies and the typed safety results to a set of drafts. */
export function toReviewDrafts(tx: Tx, project: string, rows: Array<{ d: DraftRow; c: ClientRaw }>, now?: Date): ReviewDraft[] {
  const safety = loadSafety(tx, project, rows.map((r) => r.d), now);
  const ids = [...new Set(rows.map((r) => r.c.id))];
  const markRows = ids.length ? tx.select({ clientId: marks.clientId, mark: marks.mark }).from(marks).where(inArray(marks.clientId, ids)).all() : [];
  const marksBy = new Map<number, Mark[]>();
  for (const m of markRows) marksBy.set(m.clientId, [...(marksBy.get(m.clientId) ?? []), m.mark]);
  const enrollmentIds = [...new Set(rows.flatMap((r) => (r.d.enrollmentId == null ? [] : [r.d.enrollmentId])))];
  const enrolled = new Map(enrollmentIds.length ? tx.select().from(enrollments).where(inArray(enrollments.id, enrollmentIds)).all().map((e) => [e.id, e]) : []);
  const stepOf = (d: DraftRow): StepOf | null => {
    const e = d.enrollmentId == null ? undefined : enrolled.get(d.enrollmentId);
    return e && d.sequenceStep != null ? { enrollmentId: e.id, sequence: e.sequence, step: d.sequenceStep, steps: parseJson<{ delays?: number[] }>(e.schedule, {}).delays?.length ?? d.sequenceStep, state: e.state } : null;
  };
  return rows.map(({ d, c }) => {
    const results = safety.get(d.id) ?? [];
    return {
      ...d,
      toneBodies: parseJson<ToneBodies>(d.tones, {}),
      safetyResults: results,
      blocked: blocksChecked(results, d.batchId != null),
      basedOn: d.evidence == null ? null : { level: d.evidence, source: d.evidenceSource, findings: parseJson<EvidenceFinding[]>(d.evidenceFindings, []), similarTo: d.similarTo, context: parseJson<Record<string, unknown>>(d.context, {}) },
      client: { id: c.id, name: c.name, email: c.email, repliesOwed: c.repliesOwed, lastContactAt: c.lastContactAt, marks: marksBy.get(c.id) ?? [] },
      sequence: stepOf(d),
    };
  });
}

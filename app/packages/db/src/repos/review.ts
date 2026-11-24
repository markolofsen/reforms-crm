import { inArray, sql } from "drizzle-orm";
import { type DraftFinding, type EnrollmentState, type Mark, type SafetyResult, type ToneBodies } from "@hub/config";
import { blocksChecked } from "../safety";
import { type clients, drafts, enrollments, marks } from "../schema";
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
  /** P87 (B3): how many other drafts the Hub holds for this client (earlier or finished), for the card's history line. */
  otherDrafts: number;
} & TeamNotice;

/**
 * P90: what another person did in this draft's thread or to this client, for an open draft (ready, hold, done); both null
 * otherwise. `repliedElsewhere`: a Sent reply to the draft's thread that is not the Hub's (Sent detection), named by the
 * client's Notion `Last sent by` when that stamp is within 15 minutes of it, else by the sender. `teamSent`: the Notion stamp
 * of another person, newer than the client's last message and than this Hub's last send to them.
 */
export type TeamNotice = {
  repliedElsewhere: { at: string; by: string; messageId: string } | null;
  teamSent: { at: string; by: string } | null;
};

const NOTION_NEAR_MS = 15 * 60_000;
const OPEN_FOR_NOTICE = new Set(["ready", "hold", "done"]);

/** `"Anna Lee" <anna@x>` → `Anna Lee`; a bare address stays the address. */
export function senderName(from: string): string {
  const t = from.trim();
  const name = t.replace(/<[^>]*>/, "").replace(/^"|"$/g, "").trim();
  return name || (/<([^>]+)>/.exec(t)?.[1] ?? t).trim();
}

export function teamNoticeOf(
  d: Pick<DraftRow, "status" | "elsewhereAt" | "elsewhereFrom" | "elsewhereMessageId">,
  c: Pick<ClientRaw, "lastContactAt" | "teamSentAt" | "teamSentBy">,
  lastHubSentAt: string | null,
): TeamNotice {
  if (!OPEN_FOR_NOTICE.has(d.status)) return { repliedElsewhere: null, teamSent: null };
  const t = (s: string | null | undefined) => (s ? Date.parse(s) : Number.NaN);
  const stamp = c.teamSentAt && c.teamSentBy ? { at: c.teamSentAt, by: c.teamSentBy } : null;
  const repliedElsewhere = d.elsewhereAt && d.elsewhereMessageId
    ? { at: d.elsewhereAt, messageId: d.elsewhereMessageId, by: stamp && Math.abs(t(stamp.at) - t(d.elsewhereAt)) <= NOTION_NEAR_MS ? stamp.by : senderName(d.elsewhereFrom ?? "") || "Someone" }
    : null;
  const newer = (a: number, b: string | null) => !b || !(t(b) >= a);
  const teamSent = stamp && newer(t(stamp.at), c.lastContactAt) && newer(t(stamp.at), lastHubSentAt) ? stamp : null;
  return { repliedElsewhere, teamSent };
}

export type StepOf = { enrollmentId: number; sequence: string; step: number; steps: number; state: EnrollmentState };

export type BasedOn = {
  findings: DraftFinding[];
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
  const counted = ids.length ? tx.select({ clientId: drafts.clientId, n: sql<number>`count(*)`, sentAt: sql<string | null>`max(${drafts.sentAt})` }).from(drafts).where(inArray(drafts.clientId, ids)).groupBy(drafts.clientId).all() : [];
  const perClient = new Map<number, number>(counted.map((r) => [r.clientId, r.n]));
  const lastSent = new Map<number, string | null>(counted.map((r) => [r.clientId, r.sentAt]));
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
      basedOn: d.context == null && d.findings == null ? null : { findings: parseJson<DraftFinding[]>(d.findings, []), context: parseJson<Record<string, unknown>>(d.context, {}) },
      client: { id: c.id, name: c.name, email: c.email, repliesOwed: c.repliesOwed, lastContactAt: c.lastContactAt, marks: marksBy.get(c.id) ?? [] },
      sequence: stepOf(d),
      otherDrafts: Math.max(0, (perClient.get(c.id) ?? 1) - 1),
      ...teamNoticeOf(d, c, lastSent.get(c.id) ?? null),
    };
  });
}

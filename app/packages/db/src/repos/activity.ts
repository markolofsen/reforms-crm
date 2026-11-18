import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { RunStatus } from "@hub/config";
import type { Db } from "../client";
import { agentEvents, agentRuns, clients, drafts, inboxRows } from "../schema";

// Activity (P48 W5): what the agent did, one row per client event, grouped by session (one session is one run: the
// `record-*` calls of a session join its run by `batchKey`). The outcome and the reason are read from the event's detail,
// so nothing hides behind a click. Read only.

export type ActivityOutcome = "drafted" | "skipped" | "escalated" | "flagged" | "other";
export type ActivityFilter = "all" | RunStatus;

export interface ActivityRow {
  id: number;
  runId: number;
  at: string;
  client: { id: number; name: string } | null;
  who: string;
  outcome: ActivityOutcome;
  why: string | null;
  draftId: number | null;
}

export interface ActivitySession {
  runId: number;
  startedAt: string;
  finishedAt: string | null;
  skill: string | null;
  trigger: string;
  status: RunStatus;
  /** Null while the hub does not know them (a session seen only through `record-*`): never 0. */
  model: string | null;
  tokens: { in: number; out: number } | null;
  costUsd: number | null;
  durationS: number | null;
  rows: ActivityRow[];
}

export interface Activity { sessions: ActivitySession[]; counts: Record<ActivityFilter, number> }

type Detail = { action?: unknown; reason?: unknown; draftId?: unknown; inboxId?: unknown };
const detailOf = (text: string | null): Detail => {
  try {
    const v: unknown = JSON.parse(text ?? "{}");
    return v && typeof v === "object" ? (v as Detail) : {};
  } catch {
    return {};
  }
};
const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);

/** The client decisions a session records, in the owner's words. Anything else in a run is a note. */
const OUTCOME: Record<string, ActivityOutcome> = { drafted: "drafted", create: "drafted", update: "drafted", skipped: "skipped", escalated: "escalated", injection_suspected: "flagged" };

function outcomeOf(kind: string, d: Detail): ActivityOutcome {
  const a = str(d.action);
  if (kind === "needs_human") return a === "injection_suspected" ? "flagged" : "escalated";
  if (kind !== "decision" && kind !== "draft_created") return "other";
  return (a && OUTCOME[a]) || "other";
}

/** A client decision (`IT-Helpdesk: escalated`, detail has `inboxId`) names the client first; a draft line (`Draft recorded: Anna`) last. */
function whoOf(summary: string, nameFirst: boolean): string {
  const i = nameFirst ? summary.indexOf(": ") : summary.lastIndexOf(": ");
  if (i < 0) return summary;
  return nameFirst ? summary.slice(0, i) : summary.slice(i + 2);
}

/** A run the hub learned only through `record-*` (no model, no tokens, no cost) shows none of those numbers. */
function runNumbers(r: typeof agentRuns.$inferSelect) {
  if (r.model === null && r.tokensIn === 0 && r.tokensOut === 0 && r.costUsd === 0) return { model: null, tokens: null, costUsd: null, durationS: null };
  const dur = r.finishedAt ? (Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000 : null;
  return { model: r.model, tokens: { in: r.tokensIn, out: r.tokensOut }, costUsd: r.costUsd, durationS: dur !== null && Number.isFinite(dur) ? Math.max(0, Math.round(dur)) : null };
}

export async function activityOf(db: Db, project: string, filter: ActivityFilter = "all", limit = 50): Promise<Activity> {
  const counts: Record<ActivityFilter, number> = { all: 0, ok: 0, needs_human: 0, failed: 0 };
  for (const c of db.select({ status: agentRuns.status, n: sql<number>`count(*)` }).from(agentRuns).where(eq(agentRuns.project, project)).groupBy(agentRuns.status).all()) {
    counts[c.status] = c.n;
    counts.all += c.n;
  }
  const runs = db
    .select()
    .from(agentRuns)
    .where(filter === "all" ? eq(agentRuns.project, project) : and(eq(agentRuns.project, project), eq(agentRuns.status, filter)))
    .orderBy(desc(agentRuns.startedAt), desc(agentRuns.id))
    .limit(limit)
    .all();
  if (runs.length === 0) return { sessions: [], counts };

  const events = db
    .select({ id: agentEvents.id, runId: agentEvents.runId, at: agentEvents.at, kind: agentEvents.kind, summary: agentEvents.summary, detail: agentEvents.detail, clientId: agentEvents.clientId, clientName: clients.name })
    .from(agentEvents)
    .leftJoin(clients, eq(clients.id, agentEvents.clientId))
    .where(and(eq(agentEvents.project, project), inArray(agentEvents.runId, runs.map((r) => r.id))))
    .orderBy(asc(agentEvents.runId), asc(agentEvents.seq))
    .all();
  const details = new Map(events.map((e) => [e.id, detailOf(e.detail)]));

  // A recorded client without a draft has no client id on its event: find its row through the inbox address, if one exists.
  const inboxIds = [...new Set([...details.values()].map((d) => int(d.inboxId)).filter((x): x is number => x !== null))];
  const byInbox = new Map<number, { id: number; name: string }>();
  if (inboxIds.length) {
    for (const r of db.select({ inboxId: inboxRows.id, id: clients.id, name: clients.name }).from(inboxRows).innerJoin(clients, and(eq(clients.project, inboxRows.project), eq(clients.email, inboxRows.email))).where(inArray(inboxRows.id, inboxIds)).all()) byInbox.set(r.inboxId, { id: r.id, name: r.name });
  }
  // A drafted row's "why" is the draft's own reason (the event does not repeat it).
  const draftIds = [...new Set([...details.values()].map((d) => int(d.draftId)).filter((x): x is number => x !== null))];
  const reasons = new Map(draftIds.length ? db.select({ id: drafts.id, reason: drafts.reason }).from(drafts).where(and(eq(drafts.project, project), inArray(drafts.id, draftIds))).all().map((d) => [d.id, d.reason]) : []);

  const rowsOf = new Map<number, ActivityRow[]>();
  for (const e of events) {
    const d = details.get(e.id) ?? {};
    const draftId = int(d.draftId);
    const outcome = outcomeOf(e.kind, d);
    const client = e.clientId !== null && e.clientName !== null ? { id: e.clientId, name: e.clientName } : (byInbox.get(int(d.inboxId) ?? -1) ?? null);
    const why = str(d.reason) ?? (outcome === "drafted" && draftId !== null ? str(reasons.get(draftId)) : null);
    const list = rowsOf.get(e.runId) ?? [];
    list.push({ id: e.id, runId: e.runId, at: e.at, client, who: whoOf(e.summary, int(d.inboxId) !== null), outcome, why, draftId });
    rowsOf.set(e.runId, list);
  }
  const sessions = runs.map((r): ActivitySession => ({ runId: r.id, startedAt: r.startedAt, finishedAt: r.finishedAt, skill: r.skill, trigger: r.trigger, status: r.status, ...runNumbers(r), rows: rowsOf.get(r.id) ?? [] }));
  return { sessions, counts };
}

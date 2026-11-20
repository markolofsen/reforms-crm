import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../client";
import { agentEvents, clients, drafts, inboxRows } from "../schema";

// Activity (P73, decision 0037): one timeline of what the agent decided, newest first. A row is one `agent_events` row that
// names a client decision (drafted, updated a draft, skipped, escalated, flagged); the run it joined is not read, since a run
// is neither a session nor a day (one `record-*` call each, or one draft's lifetime across days). Notes (thoughts, tool steps,
// errors) are the session log's (`hub log`), not this screen's. The outcome and the reason are read from the event's detail.
// Read only.

export type ActivityOutcome = "drafted" | "updated" | "skipped" | "escalated" | "flagged";
/** The views of the View menu, by outcome: Needs you is escalated and flagged, Drafts is drafted and updated. */
export type ActivityView = "all" | "needs_you" | "drafts" | "skipped";
const VIEW_OF: Record<ActivityOutcome, Exclude<ActivityView, "all">> = { drafted: "drafts", updated: "drafts", skipped: "skipped", escalated: "needs_you", flagged: "needs_you" };

export interface ActivityRow {
  id: number;
  at: string;
  client: { id: number; name: string } | null;
  who: string;
  outcome: ActivityOutcome;
  why: string | null;
  draftId: number | null;
  /** The skill the event itself names (never the run's, never the hub's own `draft_write`). */
  skill: string | null;
}

export interface Activity {
  rows: ActivityRow[];
  counts: Record<ActivityView, number>;
  /** The cursor of the next page (`<at>|<id>` of the last row), null when this page is the last. */
  next: string | null;
  /** The client the timeline is narrowed to, when `client` was asked for and exists. */
  client: { id: number; name: string } | null;
}

export interface TimelineQuery { view?: ActivityView; client?: number | null; before?: string | null; limit?: number }

type Detail = { action?: unknown; reason?: unknown; draftId?: unknown; inboxId?: unknown; skill?: unknown };
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

/** The client decisions a session records, in the owner's words. */
const OUTCOME: Record<string, ActivityOutcome> = { drafted: "drafted", create: "drafted", update: "updated", skipped: "skipped", escalated: "escalated", injection_suspected: "flagged" };

/** The outcome of an event, or null for one that is not a client decision. A draft line with no action is a draft made. */
export function outcomeOf(kind: string, d: Detail): ActivityOutcome | null {
  const a = str(d.action);
  if (kind === "needs_human") return a === "injection_suspected" ? "flagged" : "escalated";
  if (kind === "draft_created") return a ? (OUTCOME[a] ?? null) : "drafted";
  if (kind !== "decision") return null;
  return (a && OUTCOME[a]) || null;
}

/** A client decision (`IT-Helpdesk: escalated`, detail has `inboxId`) names the client first; a draft line (`Draft recorded: Anna`) last. */
function whoOf(summary: string, nameFirst: boolean): string {
  const i = nameFirst ? summary.indexOf(": ") : summary.lastIndexOf(": ");
  if (i < 0) return summary;
  return nameFirst ? summary.slice(0, i) : summary.slice(i + 2);
}

/** The hub's own writer is not a skill the owner knows (`draft_write` saves a revision). */
const HUB_WRITERS = new Set(["draft_write"]);
const skillOf = (d: Detail): string | null => {
  const s = str(d.skill);
  return s && !HUB_WRITERS.has(s) ? s : null;
};

const CURSOR = /^(.+)\|(\d+)$/;
/** `<at>|<id>`: rows strictly older than it, in the timeline's order (`at` desc, then `id` desc). */
function olderThan(before: string | null | undefined): (r: { at: string; id: number }) => boolean {
  const m = before ? CURSOR.exec(before) : null;
  if (!m) return () => true;
  const at = m[1] ?? "";
  const id = Number(m[2]);
  return (r) => r.at < at || (r.at === at && r.id < id);
}

export async function timelineOf(db: Db, project: string, q: TimelineQuery = {}): Promise<Activity> {
  const view = q.view ?? "all";
  const limit = q.limit ?? 100;
  const events = db
    .select({ id: agentEvents.id, at: agentEvents.at, kind: agentEvents.kind, summary: agentEvents.summary, detail: agentEvents.detail, clientId: agentEvents.clientId, clientName: clients.name })
    .from(agentEvents)
    .leftJoin(clients, eq(clients.id, agentEvents.clientId))
    .where(and(eq(agentEvents.project, project), inArray(agentEvents.kind, ["decision", "draft_created", "needs_human"])))
    .all();
  const decided = events.flatMap((e) => {
    const d = detailOf(e.detail);
    const outcome = outcomeOf(e.kind, d);
    return outcome ? [{ e, d, outcome }] : [];
  });

  // A recorded client without a draft has no client id on its event: find its row through the inbox address, if one exists.
  const inboxIds = [...new Set(decided.map(({ d }) => int(d.inboxId)).filter((x): x is number => x !== null))];
  const byInbox = new Map<number, { id: number; name: string }>();
  if (inboxIds.length) {
    for (const r of db.select({ inboxId: inboxRows.id, id: clients.id, name: clients.name }).from(inboxRows).innerJoin(clients, and(eq(clients.project, inboxRows.project), eq(clients.email, inboxRows.email))).where(and(eq(inboxRows.project, project), inArray(inboxRows.id, inboxIds))).all()) byInbox.set(r.inboxId, { id: r.id, name: r.name });
  }
  const resolved = decided.map((x) => ({ ...x, client: x.e.clientId !== null && x.e.clientName !== null ? { id: x.e.clientId, name: x.e.clientName } : (byInbox.get(int(x.d.inboxId) ?? -1) ?? null) }));

  const client = q.client != null ? (db.select({ id: clients.id, name: clients.name }).from(clients).where(and(eq(clients.id, q.client), eq(clients.project, project))).get() ?? null) : null;
  const scoped = q.client != null ? resolved.filter((x) => x.client?.id === q.client) : resolved;

  const counts: Record<ActivityView, number> = { all: scoped.length, needs_you: 0, drafts: 0, skipped: 0 };
  for (const x of scoped) counts[VIEW_OF[x.outcome]] += 1;

  const older = olderThan(q.before);
  const inView = scoped
    .filter((x) => (view === "all" || VIEW_OF[x.outcome] === view) && older(x.e))
    .sort((a, b) => (a.e.at === b.e.at ? b.e.id - a.e.id : a.e.at < b.e.at ? 1 : -1));
  const page = inView.slice(0, limit);

  // A draft row's "why" is the draft's own reason (the event does not repeat it).
  const draftIds = [...new Set(page.map(({ d }) => int(d.draftId)).filter((x): x is number => x !== null))];
  const reasons = new Map(draftIds.length ? db.select({ id: drafts.id, reason: drafts.reason }).from(drafts).where(and(eq(drafts.project, project), inArray(drafts.id, draftIds))).all().map((d) => [d.id, d.reason]) : []);

  const rows = page.map(({ e, d, outcome, client: c }): ActivityRow => {
    const draftId = int(d.draftId);
    const why = str(d.reason) ?? ((outcome === "drafted" || outcome === "updated") && draftId !== null ? str(reasons.get(draftId)) : null);
    return { id: e.id, at: e.at, client: c, who: whoOf(e.summary, int(d.inboxId) !== null), outcome, why, draftId, skill: skillOf(d) };
  });
  const last = rows.at(-1);
  return { rows, counts, next: inView.length > limit && last ? `${last.at}|${last.id}` : null, client };
}

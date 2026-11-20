import { and, eq, inArray } from "drizzle-orm";
import { BATCH_SEND_ACTOR } from "@hub/config";
import type { Db } from "../client";
import { agentEvents, clients, drafts, inboxRows, messengerDrafts, sendLog } from "../schema";

// Activity (P73, decision 0037): one timeline of what the agent decided, newest first. A row is one `agent_events` row that
// names a client decision (drafted, updated a draft, skipped, escalated, flagged); the run it joined is not read, since a run
// is neither a session nor a day (one `record-*` call each, or one draft's lifetime across days). Notes (thoughts, tool steps,
// errors) are the session log's (`hub log`), not this screen's. The outcome and the reason are read from the event's detail.
// P87 (finding 5, decision 0037 as amended): what went out is part of the one timeline too: every `send_log` row that was sent
// (both doors, Mail and the messengers) is a row of All, outcome `sent`, its why the way it went. Read only.

export type ActivityOutcome = "drafted" | "updated" | "skipped" | "escalated" | "flagged" | "linked" | "sent";
/** The views of the View menu, by outcome: Needs you is escalated and flagged, Drafts is drafted and updated. */
export type ActivityView = "all" | "needs_you" | "drafts" | "skipped";
// A chat the Hub linked by itself (P84, outcome `linked`) and a send (P87, `sent`; its own list is Activity ▸ Sends) are in All only.
const VIEW_OF: Record<ActivityOutcome, Exclude<ActivityView, "all"> | null> = { drafted: "drafts", updated: "drafts", skipped: "skipped", escalated: "needs_you", flagged: "needs_you", linked: null, sent: null };

export interface ActivityRow {
  /** The source row's id: an `agent_events` id, or a `send_log` id for a send. */
  id: number;
  /** Unique across both sources (`event:12`, `send:3`): the list key and the cursor's tie-break (the two tables' ids collide). */
  key: string;
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
const OUTCOME: Record<string, ActivityOutcome> = { drafted: "drafted", create: "drafted", update: "updated", skipped: "skipped", escalated: "escalated", injection_suspected: "flagged", linked: "linked" };

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

const CURSOR = /^(.+)\|(event|send):(\d+)$/;
type Pos = { at: string; src: "event" | "send"; id: number };
/** The timeline's order, newest first: `at` desc, then a send before an event, then the id desc. */
const newerFirst = (a: Pos, b: Pos): number => (a.at === b.at ? (a.src === b.src ? b.id - a.id : a.src === "send" ? -1 : 1) : a.at < b.at ? 1 : -1);
/** `<at>|<key>`: rows strictly older than it, in the timeline's order. */
function olderThan(before: string | null | undefined): (r: Pos) => boolean {
  const m = before ? CURSOR.exec(before) : null;
  if (!m) return () => true;
  const at: Pos = { at: m[1] ?? "", src: m[2] === "send" ? "send" : "event", id: Number(m[3]) };
  return (r) => newerFirst(at, r) < 0;
}

const CHANNEL_WORD: Record<string, string> = { telegram_user: "Telegram", telegram_bot: "Telegram bot", whatsapp: "WhatsApp" };
/** How a send went, in the words of Activity ▸ Sends: Batch, By hand, Autosend; a message names its messenger. */
const viaOf = (r: { actor: string; mode: string; channel: string }): string => (r.channel !== "mail" ? `${r.actor === BATCH_SEND_ACTOR ? "Batch" : "By hand"} on ${CHANNEL_WORD[r.channel] ?? r.channel}` : r.actor === BATCH_SEND_ACTOR ? "Batch" : r.mode === "auto" ? "Autosend" : "By hand");

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
  const resolvedEvents = decided.map((x) => ({ ...x, client: x.e.clientId !== null && x.e.clientName !== null ? { id: x.e.clientId, name: x.e.clientName } : (byInbox.get(int(x.d.inboxId) ?? -1) ?? null) }));

  // P87: the sends, each with its client through the Mail draft or the messenger draft it carried.
  const sendRows = db
    .select({ id: sendLog.id, createdAt: sendLog.createdAt, doneAt: sendLog.doneAt, actor: sendLog.actor, mode: sendLog.mode, channel: sendLog.channel, toAddr: sendLog.toAddr, subject: sendLog.subject, draftId: sendLog.draftId, mailClient: drafts.clientId, chatClient: messengerDrafts.clientId })
    .from(sendLog)
    .leftJoin(drafts, eq(drafts.id, sendLog.draftId))
    .leftJoin(messengerDrafts, eq(messengerDrafts.id, sendLog.messengerDraftId))
    .where(and(eq(sendLog.project, project), eq(sendLog.status, "sent")))
    .all();
  const sendClientIds = [...new Set(sendRows.map((r) => r.mailClient ?? r.chatClient).filter((x): x is number => x !== null))];
  const names = new Map(sendClientIds.length ? db.select({ id: clients.id, name: clients.name }).from(clients).where(and(eq(clients.project, project), inArray(clients.id, sendClientIds))).all().map((c) => [c.id, c.name]) : []);
  type Item = { pos: Pos; outcome: ActivityOutcome; client: { id: number; name: string } | null; row: () => Omit<ActivityRow, "client"> };
  const items: Item[] = [
    ...resolvedEvents.map(({ e, d, outcome, client: c }): Item => ({
      pos: { at: e.at, src: "event", id: e.id },
      outcome,
      client: c,
      row: () => ({ id: e.id, key: `event:${e.id}`, at: e.at, who: whoOf(e.summary, int(d.inboxId) !== null), outcome, why: str(d.reason), draftId: int(d.draftId), skill: skillOf(d) }),
    })),
    ...sendRows.map((r): Item => {
      const cid = r.mailClient ?? r.chatClient;
      const name = cid !== null ? names.get(cid) : undefined;
      const at = r.doneAt ?? r.createdAt;
      return {
        pos: { at, src: "send", id: r.id },
        outcome: "sent",
        client: cid !== null && name !== undefined ? { id: cid, name } : null,
        row: () => ({ id: r.id, key: `send:${r.id}`, at, who: r.channel === "mail" ? r.toAddr : r.subject, outcome: "sent", why: viaOf(r), draftId: r.channel === "mail" ? r.draftId : null, skill: null }),
      };
    }),
  ];
  const resolved = items;

  const client = q.client != null ? (db.select({ id: clients.id, name: clients.name }).from(clients).where(and(eq(clients.id, q.client), eq(clients.project, project))).get() ?? null) : null;
  const scoped = q.client != null ? resolved.filter((x) => x.client?.id === q.client) : resolved;

  const counts: Record<ActivityView, number> = { all: scoped.length, needs_you: 0, drafts: 0, skipped: 0 };
  for (const x of scoped) {
    const v = VIEW_OF[x.outcome];
    if (v) counts[v] += 1;
  }

  const older = olderThan(q.before);
  const inView = scoped.filter((x) => (view === "all" || VIEW_OF[x.outcome] === view) && older(x.pos)).sort((a, b) => newerFirst(a.pos, b.pos));
  const page = inView.slice(0, limit).map((x) => ({ ...x.row(), client: x.client }));

  // A draft row's "why" is the draft's own reason (the event does not repeat it).
  const draftIds = [...new Set(page.filter((r) => r.outcome === "drafted" || r.outcome === "updated").map((r) => r.draftId).filter((x): x is number => x !== null))];
  const reasons = new Map(draftIds.length ? db.select({ id: drafts.id, reason: drafts.reason }).from(drafts).where(and(eq(drafts.project, project), inArray(drafts.id, draftIds))).all().map((d) => [d.id, d.reason]) : []);

  const rows = page.map((r): ActivityRow => (r.why === null && (r.outcome === "drafted" || r.outcome === "updated") && r.draftId !== null ? { ...r, why: str(reasons.get(r.draftId)) } : r));
  const last = rows.at(-1);
  return { rows, counts, next: inView.length > limit && last ? `${last.at}|${last.key}` : null, client };
}

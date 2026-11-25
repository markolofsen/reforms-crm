import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { followUpDisplay, type FollowUpChannel, type FollowUpDecision, type FollowUpDisplay, type FollowUpStopReason, type FollowUpTrigger, type FollowUpWaitingOn } from "@hub/config/follow-ups";
import type { Db } from "../client";
import { RepoError } from "../errors";
import { agentEvents, clients, drafts, enrollments, followUpSweeps, followUps, marks, messengerChats, messengerDrafts, sendLog } from "../schema";
import { write } from "../tx";
import { conversationsRepo } from "./conversations";
import { dueClients, type DueChat, type DueClient, type DueFacts } from "./follow-up-due";
import { clientOfChat, followUpNudgeSent, followUpWeWrote, noteChatOutbound } from "./follow-up-hooks";
import { insertEvent, sessionRun } from "./runs";

// The follow-up plans and sweeps (decision 0050, P142 F1). A plan is the agent's notes (verdict 3): `decide` writes what the turn
// decided and one Activity line; the owner's Change date, Stop and Resume write the same row. Nothing here refuses a draft or a
// send. The facts the selector reads (`facts`) are the Hub's own rows: Mail's conversation words, the linked chats' durable
// inbound and outbound times, the open drafts, the marks and the open enrolments.

export type FollowUpRow = typeof followUps.$inferSelect;
export type FollowUpSweepRow = typeof followUpSweeps.$inferSelect;

/** What `follow_up_plan` (or an owner route) writes. */
export interface FollowUpDecisionInput {
  project: string;
  clientId: number;
  decision: FollowUpDecision;
  nextAt: string | null;
  waitingOn: FollowUpWaitingOn | null;
  reason: string;
  stopReason: FollowUpStopReason | null;
  channel: FollowUpChannel | null;
  nudgeN: number | null;
  tz: string | null;
  line: string | null;
  at: string;
  /** The session's action id: one Activity run per session (or sweep turn). */
  batchKey: string | null;
}

/** One plan as the admin and `client_show` read it, with the derived state. */
export interface FollowUpItem extends FollowUpRow {
  clientName: string;
  display: FollowUpDisplay;
  nudgeReady: boolean;
}

const STATE_OF: Record<FollowUpDecision, FollowUpRow["state"]> = { nudge: "waiting", wait: "waiting", stop: "stopped", hand_over: "handed_over" };
const ACTION_OF: Record<FollowUpDecision, string> = { nudge: "follow_up_nudge", wait: "follow_up_wait", stop: "follow_up_stop", hand_over: "escalated" };

/** The Activity line of a decision: "Follow-up · Женя · nudged on WhatsApp (2nd) · next 30 Nov". */
export function decisionSummary(name: string, d: Pick<FollowUpDecisionInput, "decision" | "channel" | "nudgeN" | "nextAt" | "stopReason">): string {
  const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;
  const ch = d.channel ? { mail: "Mail", telegram_user: "Telegram", telegram_bot: "Telegram bot", whatsapp: "WhatsApp" }[d.channel] : null;
  const what =
    d.decision === "nudge"
      ? `nudged${ch ? ` on ${ch}` : ""}${d.nudgeN ? ` (${ord(d.nudgeN)})` : ""}`
      : d.decision === "wait"
        ? "waits"
        : d.decision === "stop"
          ? `stopped${d.stopReason ? ` (${d.stopReason.replace(/_/g, " ")})` : ""}`
          : "handed to you";
  const next = d.nextAt && (d.decision === "nudge" || d.decision === "wait") ? `next ${new Date(`${d.nextAt.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : null;
  return ["Follow-up", name, what, next].filter((x): x is string => !!x).join(" · ");
}

/** The selector's facts of every live client of the project (verdict 2). Read only: `hub mcp` reads it too. */
export async function followUpFacts(db: Db, project: string, now: Date): Promise<{ facts: DueFacts[]; unlinkedWroteLast: number }> {
  const people = db.select().from(clients).where(and(eq(clients.project, project), isNull(clients.mergedInto))).all();
  const mail = new Map((await conversationsRepo(db).list(project, "all", { limit: 100_000, now, ensure: false })).rows.map((r) => [r.client.id, r]));
  const dnc = new Set(db.select({ id: marks.clientId }).from(marks).where(and(eq(marks.project, project), eq(marks.mark, "do_not_contact"))).all().map((r) => r.id));
  const enrolled = new Set(db.select({ id: enrollments.clientId }).from(enrollments).where(and(eq(enrollments.project, project), inArray(enrollments.state, ["active", "paused"]))).all().map((r) => r.id));
  const plans = new Map(db.select().from(followUps).where(eq(followUps.project, project)).all().map((p) => [p.clientId, p]));
  const openChat = new Set(db.select({ ch: messengerDrafts.channel, id: messengerDrafts.chatId }).from(messengerDrafts).where(and(eq(messengerDrafts.project, project), eq(messengerDrafts.status, "draft"))).all().map((r) => `${r.ch}:${r.id}`));
  const cached = db.all<{ channel: string; chat_id: string; last_in: string | null; last_out: string | null }>(
    sql`select channel, chat_id, max(case when direction = 'in' then sent_at end) as last_in, max(case when direction = 'out' then sent_at end) as last_out from messenger_messages where project = ${project} group by channel, chat_id`,
  );
  const cache = new Map(cached.map((r) => [`${r.channel}:${r.chat_id}`, r]));
  const later = (a: string | null | undefined, b: string | null | undefined) => (!a ? (b ?? null) : !b ? a : a > b ? a : b);
  const byClient = new Map<number, DueChat[]>();
  let unlinkedWroteLast = 0;
  for (const c of db.select().from(messengerChats).where(eq(messengerChats.project, project)).all()) {
    const k = `${c.channel}:${c.chatId}`;
    const chat: DueChat = { id: c.id, channel: c.channel, chatId: c.chatId, replyMode: c.replyMode, lastInAt: later(c.lastInboundAt, cache.get(k)?.last_in), lastOutAt: later(c.lastOutboundAt, cache.get(k)?.last_out), openDraft: openChat.has(k) };
    const client = clientOfChat(db, project, c.channel, c.chatId);
    if (client === null) {
      if (chat.lastOutAt && (!chat.lastInAt || chat.lastOutAt > chat.lastInAt)) unlinkedWroteLast++;
      continue;
    }
    byClient.set(client, [...(byClient.get(client) ?? []), chat]);
  }
  const out: DueFacts[] = people.map((c) => {
    const m = mail.get(c.id);
    const p = plans.get(c.id);
    return {
      clientId: c.id,
      name: c.name,
      email: c.email,
      doNotContact: dnc.has(c.id),
      enrolled: enrolled.has(c.id),
      mail: m ? { wrote: m.state === "wrote", openDraft: m.state === "draft" || m.state === "hold", theirLastAt: m.theirLastAt, ourLastAt: m.ourLastAt } : null,
      chats: byClient.get(c.id) ?? [],
      plan: p ? { state: p.state, nextAt: p.nextAt, nudgesSent: p.nudgesSent } : null,
    };
  });
  return { facts: out, unlinkedWroteLast };
}

/**
 * The agent's decision (verdict 9): one row per client, so a rerun the same day replaces it, never stacks. The count is not
 * moved here (only a sent nudge moves it, verdict 11). One Activity line per call. Returns the row and whether it replaced
 * a decision of the same day.
 */
export function decideFollowUp(db: Db, d: FollowUpDecisionInput, by: "agent" | "owner" = "agent"): { row: FollowUpRow; sameDay: boolean; name: string } {
  return write(db, (tx) => {
    const client = tx.select({ id: clients.id, name: clients.name }).from(clients).where(and(eq(clients.project, d.project), eq(clients.id, d.clientId))).get();
    if (!client) throw new RepoError("not_found", `No client ${d.clientId} in project ${d.project}`);
    const old = tx.select().from(followUps).where(and(eq(followUps.project, d.project), eq(followUps.clientId, d.clientId))).get();
    const sameDay = !!old && old.decidedAt.slice(0, 10) === d.at.slice(0, 10);
    const values = {
      state: STATE_OF[d.decision],
      nextAt: d.decision === "nudge" || d.decision === "wait" ? d.nextAt : null,
      waitingOn: d.waitingOn,
      reason: d.reason.slice(0, 200),
      stopReason: d.decision === "stop" ? d.stopReason : null,
      channel: d.channel ?? old?.channel ?? null,
      tz: d.tz ?? old?.tz ?? null,
      line: d.line ? d.line.slice(0, 160) : null,
      decidedBy: by,
      decidedAt: d.at,
      updatedAt: d.at,
    };
    const row = old
      ? tx.update(followUps).set(values).where(eq(followUps.id, old.id)).returning().get()
      : tx.insert(followUps).values({ project: d.project, clientId: d.clientId, nudgesSent: 0, ...values }).returning().get();
    if (!row) throw new RepoError("not_found", "The plan could not be written");
    const runId = sessionRun(tx, { project: d.project, batchKey: d.batchKey ? `follow-up:${d.batchKey}` : `follow-up:${d.at.slice(0, 10)}`, skill: "follow-up-sweep", at: d.at });
    insertEvent(tx, {
      project: d.project,
      runId,
      at: d.at,
      kind: d.decision === "hand_over" ? "needs_human" : "decision",
      tool: "follow_up_plan",
      summary: decisionSummary(client.name, d),
      detail: JSON.stringify({ action: by === "owner" ? "follow_up_owner" : ACTION_OF[d.decision], reason: d.reason, skill: "follow-up-sweep", followUp: { decision: d.decision, nextAt: values.nextAt, nudgeN: d.nudgeN, channel: values.channel, line: values.line, by, sameDay } }),
      clientId: d.clientId,
    });
    return { row, sameDay, name: client.name };
  });
}

export function followUpsRepo(db: Db) {
  const planOf = (project: string, clientId: number) => db.select().from(followUps).where(and(eq(followUps.project, project), eq(followUps.clientId, clientId))).get() ?? null;
  /** Clients with an open nudge draft (Mail or a messenger draft with `follow_up_n`). */
  const readyClients = (project: string): Set<number> => {
    const mail = db.select({ id: drafts.clientId }).from(drafts).where(and(eq(drafts.project, project), isNotNull(drafts.followUpN), inArray(drafts.status, ["ready", "hold"]))).all();
    const chat = db.select({ id: messengerDrafts.clientId }).from(messengerDrafts).where(and(eq(messengerDrafts.project, project), isNotNull(messengerDrafts.followUpN), eq(messengerDrafts.status, "draft"))).all();
    return new Set([...mail, ...chat].map((r) => r.id).filter((x): x is number => x !== null));
  };
  const item = (r: FollowUpRow & { clientName: string }, ready: Set<number>, now: Date): FollowUpItem => {
    const nudgeReady = ready.has(r.clientId);
    return { ...r, nudgeReady, display: followUpDisplay({ state: r.state, nextAt: r.nextAt, nudgeReady }, now) };
  };
  const facts = (project: string, now: Date) => followUpFacts(db, project, now);
  const decide = async (d: FollowUpDecisionInput, by: "agent" | "owner" = "agent") => decideFollowUp(db, d, by);

  return {
    facts,
    decide,
    /** The silent clients of verdict 2, in the sweep's order, and the count of unlinked chats where we wrote last. */
    async due(project: string, now: Date, today: string = now.toISOString().slice(0, 10)): Promise<{ clients: DueClient[]; unlinkedWroteLast: number }> {
      const f = await facts(project, now);
      return { clients: dueClients(f.facts, today), unlinkedWroteLast: f.unlinkedWroteLast };
    },
    get: async (project: string, clientId: number): Promise<FollowUpRow | null> => planOf(project, clientId),
    async one(project: string, clientId: number, now: Date = new Date()): Promise<FollowUpItem | null> {
      const r = planOf(project, clientId);
      if (!r) return null;
      const name = db.select({ name: clients.name }).from(clients).where(eq(clients.id, clientId)).get()?.name ?? "";
      return item({ ...r, clientName: name }, readyClients(project), now);
    },
    /** Every plan of the project, with the client's name and the derived state; the soonest next date first. */
    async list(project: string, now: Date = new Date()): Promise<FollowUpItem[]> {
      const rows = db.select({ f: followUps, name: clients.name }).from(followUps).innerJoin(clients, eq(clients.id, followUps.clientId)).where(eq(followUps.project, project)).all();
      const ready = readyClients(project);
      return rows.map((r) => item({ ...r.f, clientName: r.name }, ready, now)).sort((a, b) => (a.nextAt ?? "9999").localeCompare(b.nextAt ?? "9999") || a.clientId - b.clientId);
    },
    /** The dated lines of a client's decisions, newest last (Activity keeps them; the plan keeps only the newest). */
    async lines(project: string, clientId: number, limit = 5): Promise<Array<{ at: string; summary: string; line: string | null }>> {
      const rows = db
        .select({ at: agentEvents.at, summary: agentEvents.summary, detail: agentEvents.detail })
        .from(agentEvents)
        .where(and(eq(agentEvents.project, project), eq(agentEvents.clientId, clientId), sql`json_extract(${agentEvents.detail}, '$.followUp') is not null`))
        .orderBy(desc(agentEvents.at), desc(agentEvents.id))
        .limit(limit)
        .all();
      return rows.reverse().map((r) => {
        let line: string | null = null;
        try {
          const v = JSON.parse(r.detail ?? "{}") as { followUp?: { line?: unknown } };
          line = typeof v.followUp?.line === "string" ? v.followUp.line : null;
        } catch {
          line = null;
        }
        return { at: r.at, summary: r.summary, line };
      });
    },
    /** The owner's Change date: the plan waits until `nextAt` (a plan is made when there is none). */
    async ownerDate(project: string, clientId: number, nextAt: string, at: string = new Date().toISOString()) {
      const old = planOf(project, clientId);
      return (await decide({ project, clientId, decision: "wait", nextAt, waitingOn: old?.waitingOn ?? "them", reason: "the owner changed the date", stopReason: null, channel: old?.channel ?? null, nudgeN: null, tz: old?.tz ?? null, line: null, at, batchKey: null }, "owner")).row;
    },
    /** The owner's Stop (Undo is Resume). */
    async ownerStop(project: string, clientId: number, at: string = new Date().toISOString()) {
      const old = planOf(project, clientId);
      return (await decide({ project, clientId, decision: "stop", nextAt: null, waitingOn: old?.waitingOn ?? null, reason: "the owner stopped the follow-ups", stopReason: "done", channel: old?.channel ?? null, nudgeN: null, tz: old?.tz ?? null, line: null, at, batchKey: null }, "owner")).row;
    },
    /** The owner's Resume: the plan waits again with no date, so the next sweep lists the client. */
    async ownerResume(project: string, clientId: number, at: string = new Date().toISOString()) {
      const old = planOf(project, clientId);
      if (!old) throw new RepoError("not_found", `Client ${clientId} has no follow-up plan in project ${project}`);
      return (await decide({ project, clientId, decision: "wait", nextAt: null, waitingOn: old.waitingOn ?? "them", reason: "the owner resumed the follow-ups", stopReason: null, channel: old.channel, nudgeN: null, tz: old.tz, line: null, at, batchKey: null }, "owner")).row;
    },
    /**
     * The messenger door sent a draft (F5): the chat's `last_outbound_at` moves, a stop or hand-over waits again, and a nudge draft
     * (`follow_up_n`) counts once on its client's plan.
     */
    async messengerSent(project: string, draftId: number, at: string): Promise<void> {
      write(db, (tx) => {
        const d = tx.select().from(messengerDrafts).where(and(eq(messengerDrafts.project, project), eq(messengerDrafts.id, draftId))).get();
        if (!d) return;
        noteChatOutbound(tx, project, d.channel, d.chatId, at);
        const client = d.clientId ?? clientOfChat(tx, project, d.channel, d.chatId);
        if (client === null) return;
        followUpWeWrote(tx, project, client, at);
        if (d.followUpN != null) followUpNudgeSent(tx, project, client, { at, n: d.followUpN, channel: d.channel });
      });
    },
    /** Autopilot nudges sent in a chat since `since`, and how many in a row since the client's last message (verdict 8's caps). */
    async autopilotNudges(project: string, chat: { channel: string; chatId: string; lastInAt: string | null }, since: string): Promise<{ today: number; inARow: number }> {
      const to = `${chat.channel === "whatsapp" ? "whatsapp" : "telegram"}:${chat.chatId}`;
      const rows = db
        .select({ at: sendLog.createdAt })
        .from(sendLog)
        .innerJoin(messengerDrafts, eq(messengerDrafts.id, sendLog.messengerDraftId))
        .where(and(eq(sendLog.project, project), eq(sendLog.channel, chat.channel as "whatsapp"), eq(sendLog.toAddr, to), eq(sendLog.actor, "autopilot"), eq(sendLog.status, "sent"), isNotNull(messengerDrafts.followUpN)))
        .all();
      return { today: rows.filter((r) => r.at >= since).length, inARow: rows.filter((r) => !chat.lastInAt || r.at > chat.lastInAt).length };
    },
  };
}

/** The sweeps (verdicts 10 and 19): one row each, so the day's turns and "last swept" survive a restart. */
export function followUpSweepsRepo(db: Db) {
  return {
    async startSweep(project: string, trigger: FollowUpTrigger, at: string): Promise<FollowUpSweepRow> {
      const row = db.insert(followUpSweeps).values({ project, trigger, startedAt: at }).returning().get();
      if (!row) throw new RepoError("not_found", "The sweep could not be recorded");
      return row;
    },
    async finishSweep(id: number, s: Partial<Pick<FollowUpSweepRow, "listed" | "turns" | "nudged" | "waited" | "stopped" | "handedOver" | "failed" | "skipped" | "error">> & { finishedAt: string }): Promise<FollowUpSweepRow | null> {
      return db.update(followUpSweeps).set(s).where(eq(followUpSweeps.id, id)).returning().get() ?? null;
    },
    /** The project's sweeps since `since`, newest first (the one-a-day rule, the Run-now cap, Overview's line). */
    async sweepsSince(project: string, since: string): Promise<FollowUpSweepRow[]> {
      return db.select().from(followUpSweeps).where(and(eq(followUpSweeps.project, project), gte(followUpSweeps.startedAt, since))).orderBy(desc(followUpSweeps.startedAt)).all();
    },
    async lastSweep(project: string): Promise<FollowUpSweepRow | null> {
      return db.select().from(followUpSweeps).where(eq(followUpSweeps.project, project)).orderBy(desc(followUpSweeps.startedAt), desc(followUpSweeps.id)).get() ?? null;
    },
    /** Sweep turns on this Mac since `since`, every project (verdict 19's 60 a day; the ledger is these rows, not memory). */
    async turnsSince(since: string): Promise<number> {
      return Number(db.select({ n: sql<number>`coalesce(sum(${followUpSweeps.turns}), 0)` }).from(followUpSweeps).where(gte(followUpSweeps.startedAt, since)).get()?.n ?? 0);
    },
  };
}

import { AUTOPILOT_POOL } from "@hub/config/autopilot";
import { newActionId } from "@hub/config/action-id";
import { FOLLOW_UP_FAILURES_STOP, FOLLOW_UP_INSTANCE_TURNS_PER_DAY, FOLLOW_UP_SWEEP_TURNS, FOLLOW_UP_TURN_TIMEOUT_MS, type FollowUpBrain, type FollowUpTrigger, type FollowUpTurnResult } from "@hub/config/follow-ups";
import type { DueClient, FollowUpSweepRow, Repos } from "@hub/db";
import { errFields, ops, withAction } from "@hub/log/ops";
import type { AutopilotHandle } from "../messengers/autopilot/wake";
import { systemClock, type Clock } from "../messengers/autopilot/scheduler";
import type { NudgeSender } from "./nudges";
import { prefetch, type PrefetchDeps } from "./prefetch";
import { noteContext, noteTargets, stampToldReports, type BugReportsPort, type NoteTarget } from "./bug-notes";

// One follow-up sweep of one project (decision 0050 points 2, 3 and 7; P142 F4). The server's list (verdict 2), then one headless
// turn per client, one at a time, in one of the pool's two slots and only while no autopilot turn waits (autopilot first). Budgets:
// 30 turns a sweep (the rest roll to tomorrow, oldest date first) and 60 a day on this Mac, read from `follow_up_sweeps`, so a
// restart refills nothing. A failed turn leaves the client's date as it was (it is listed again); three failures in a row stop the
// sweep with its reason. Every turn and the sweep are one ops line each, inside their action ids.

export interface SweepDeps {
  repos: Repos;
  brain: FollowUpBrain;
  autopilot?: AutopilotHandle | undefined;
  nudges?: NudgeSender | undefined;
  prefetch: Omit<PrefetchDeps, "repos">;
  clock?: Clock;
  /** The calendar day the selector compares plan dates with (YYYY-MM-DD), the Mac's own by default. */
  today?: (now: Date) => string;
  limits?: Partial<{ sweepTurns: number; instanceTurns: number; timeoutMs: number; failuresStop: number; slotPollMs: number }>;
  /** P145 B4: the project's Bug reports in Notion (the Fixed ones to tell, and `Client told`); absent, no notes are written. */
  bugReports?: BugReportsPort | undefined;
}

const log = ops("follow-ups");
const DAY_MS = 24 * 3_600_000;
export const localDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Counts = Pick<FollowUpSweepRow, "listed" | "turns" | "nudged" | "waited" | "stopped" | "handedOver" | "failed" | "skipped">;

/** Waits for one pool slot: none of autopilot's turns queued, and the pool not full with its turns and ours. Returns the release. */
async function slot(d: SweepDeps, clock: Clock, pollMs: number): Promise<() => void> {
  const s = d.autopilot?.scheduler;
  if (!s) return () => {};
  for (;;) {
    const st = s.state();
    if (st.queued === 0 && st.running + s.lent < AUTOPILOT_POOL) break;
    await new Promise<void>((r) => clock.setTimeout(r, pollMs));
  }
  s.lent++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    s.lent--;
    s.pump();
  };
}

/** Whether one of the client's linked chats has autopilot on or in dry run: the turn may then carry the verdict send. */
async function autopilotChatOf(d: SweepDeps, project: string, c: DueClient): Promise<{ chat: number | null; mode: "on" | "dry_run" | null }> {
  if (!d.autopilot) return { chat: null, mode: null };
  for (const ch of c.chats) {
    const sw = await d.autopilot.switches.chat(project, ch).catch(() => null);
    if (sw && (sw.state.state === "on" || sw.state.state === "dry_run")) return { chat: ch.id, mode: sw.state.state };
  }
  return { chat: null, mode: null };
}

async function oneTurn(d: SweepDeps, clock: Clock, project: string, c: DueClient, timeoutMs: number, note: { id: number; target: NoteTarget } | null = null): Promise<FollowUpTurnResult> {
  const actionId = newActionId("t");
  return withAction(actionId, async () => {
    const t0 = clock.now();
    const ap = await autopilotChatOf(d, project, c);
    const pre = await prefetch({ repos: d.repos, ...d.prefetch }, project, c);
    // P145 B4: a fixed bug's note carries the report as filed, inside the data block.
    const context = note ? `${pre.context}\n${noteContext(note.target)}` : pre.context;
    const ctl = new AbortController();
    const timer = clock.setTimeout(() => ctl.abort(), timeoutMs);
    let r: FollowUpTurnResult;
    try {
      r = await d.brain.turn({ project, client: c.clientId, actionId, context, autopilotChat: ap.chat, mode: ap.mode, ...(note ? { bugNote: { id: note.id, channel: note.target.channel } } : {}) }, ctl.signal);
    } catch (e) {
      r = { kind: "failed", code: "failed", detail: e instanceof Error ? e.message : String(e) };
    } finally {
      clock.clearTimeout(timer);
    }
    if (ctl.signal.aborted && r.kind === "failed") r = { ...r, code: "timeout", detail: "the turn took over two minutes" };
    const fields = { project, client: c.clientId, ms: clock.now() - t0, ...(r.costUsd != null ? { costUsd: r.costUsd } : {}) };
    if (r.kind === "decided") log.info(`turn decided: ${r.decision}`, { ...fields, decision: r.decision, ...(r.nudge ? { nudge: r.nudge.draftId } : {}) });
    else if (r.kind === "undecided") log.warn("turn recorded no decision", fields);
    else log.warn(`turn failed: ${r.code}`, { ...fields, code: r.code });
    // Verdict 8: only the server reads the switches; a send verdict in a chat that is on (mode on) is held for its time.
    if (r.kind === "decided" && r.nudge && ap.mode === "on" && ap.chat !== null && d.nudges) await d.nudges.hold({ project, chat: r.nudge.chat ?? ap.chat, draftId: r.nudge.draftId, text: r.nudge.text, sendAfter: r.nudge.sendAfter, actionId });
    return r;
  });
}

/** Runs one sweep to its end and returns its row. Never throws: an error is the row's `error`. */
export async function runSweep(d: SweepDeps, project: string, trigger: FollowUpTrigger): Promise<FollowUpSweepRow | null> {
  const clock = d.clock ?? systemClock;
  const l = { sweepTurns: FOLLOW_UP_SWEEP_TURNS, instanceTurns: FOLLOW_UP_INSTANCE_TURNS_PER_DAY, timeoutMs: FOLLOW_UP_TURN_TIMEOUT_MS, failuresStop: FOLLOW_UP_FAILURES_STOP, slotPollMs: 1_000, ...d.limits };
  const actionId = newActionId("s");
  return withAction(actionId, async () => {
    const now = new Date(clock.now());
    const row = await d.repos.followUps.startSweep(project, trigger, now.toISOString());
    const counts: Counts = { listed: 0, turns: 0, nudged: 0, waited: 0, stopped: 0, handedOver: 0, failed: 0, skipped: 0 };
    let error: string | null = null;
    try {
      const used = await d.repos.followUps.turnsSince(new Date(now.getTime() - DAY_MS).toISOString());
      let room = Math.max(0, Math.min(l.sweepTurns, l.instanceTurns - used));
      // P145 B4: the fixed bugs' notes first, in the same budget; a client noted today is not also nudged today.
      const noted = new Set<number>();
      if (d.bugReports) {
        const targets = await noteTargets(d.repos, d.bugReports, project, now).catch((e: unknown) => (log.warn("fixed bug notes: the list failed", { project, ...errFields(e) }), [] as NoteTarget[]));
        for (const t of targets) {
          if (room <= 0 || noted.has(t.client.clientId)) continue;
          const claim = await d.repos.bugNotes.claim({ project, reportPageId: t.report.pageId, clientId: t.client.clientId, channel: t.channel });
          if (!claim) continue;
          const release = await slot(d, clock, l.slotPollMs);
          let r: FollowUpTurnResult;
          try {
            r = await oneTurn(d, clock, project, t.client, l.timeoutMs, { id: claim.id, target: t });
          } finally {
            release();
          }
          room--;
          counts.turns++;
          noted.add(t.client.clientId);
          const after = await d.repos.bugNotes.get(claim.id);
          if (!after?.draftId && !after?.messengerDraftId) {
            await d.repos.bugNotes.release(claim.id);
            log.warn("fixed bug note: the turn wrote no draft; tomorrow tries again", { project, client: t.client.clientId, ...(r.kind === "failed" ? { code: r.code } : {}) });
          } else log.info("fixed bug note drafted", { project, client: t.client.clientId, channel: t.channel });
          if (r.kind === "failed") counts.failed++;
          else if (r.kind === "decided" && r.decision === "nudge") counts.nudged++;
          await d.repos.followUps.finishSweep(row.id, counts);
        }
      }
      const due = await d.repos.followUps.due(project, now, (d.today ?? localDay)(now));
      const clients = due.clients.filter((c) => !noted.has(c.clientId));
      counts.listed = clients.length + noted.size;
      if (room < clients.length) counts.skipped += clients.length - room;
      if (room === 0 && clients.length) error = `today's ${l.instanceTurns} follow-up turns on this Mac are used up`;
      let inARow = 0;
      for (const c of clients.slice(0, room)) {
        const release = await slot(d, clock, l.slotPollMs);
        let r: FollowUpTurnResult;
        try {
          r = await oneTurn(d, clock, project, c, l.timeoutMs);
        } finally {
          release();
        }
        counts.turns++;
        await d.repos.followUps.finishSweep(row.id, counts); // the turn budget is durable as the sweep goes
        if (r.kind === "failed") {
          counts.failed++;
          inARow++;
          if (inARow >= l.failuresStop) {
            error = `${l.failuresStop} turns failed in a row: ${r.detail.slice(0, 200)}`;
            counts.skipped += counts.listed - counts.turns - counts.skipped;
            break;
          }
          continue;
        }
        inARow = 0;
        if (r.kind === "undecided") counts.skipped++;
        else if (r.decision === "nudge") counts.nudged++;
        else if (r.decision === "wait") counts.waited++;
        else if (r.decision === "stop") counts.stopped++;
        else counts.handedOver++;
      }
    } catch (e) {
      error = `the sweep failed: ${e instanceof Error ? e.message.slice(0, 200) : "error"}`;
      log.error("the follow-up sweep failed", { project, ...errFields(e) });
    }
    // P145 B4: Client told in Notion for every report whose clients were all told (a failure waits for the next sweep).
    if (d.bugReports) await stampToldReports(d.repos, d.bugReports, project, new Date(clock.now())).catch((e: unknown) => log.warn("fixed bug notes: Client told failed", { project, ...errFields(e) }));
    const done = await d.repos.followUps.finishSweep(row.id, { ...counts, error, finishedAt: new Date(clock.now()).toISOString() });
    const fields = { project, trigger, ...counts };
    if (error) log.warn(`sweep stopped: ${error}`, fields);
    else log.info(`sweep done: ${counts.turns} turn(s) of ${counts.listed} listed`, fields);
    return done;
  });
}

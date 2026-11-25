import { AUTOPILOT_POOL } from "@hub/config/autopilot";
import { newActionId } from "@hub/config/action-id";
import { LEAD_PASS_FAILURES_STOP, LEAD_PASS_INSTANCE_TURNS_PER_DAY, LEAD_PASS_TURNS, LEAD_PASS_TURN_TIMEOUT_MS, type LeadPassBrain, type LeadPassTrigger, type LeadPassTurnResult } from "@hub/config/lead-pass";
import { samePersonAs, samePersonReason, type LeadPassRow, type LeadRow, type Repos } from "@hub/db";
import { FREE_MAIL, replyAddressOf } from "@hub/notion";
import { errFields, ops, withAction } from "@hub/log/ops";
import type { AutopilotHandle } from "../messengers/autopilot/wake";
import { systemClock, type Clock } from "../messengers/autopilot/scheduler";
import { leadPrefetch, type LeadPrefetchDeps } from "./prefetch";

// One lead pass of one project (decision 0055 point 1, P147 L4). The server's list (verdict 3), then one headless turn per lead,
// one at a time, in one of the pool's two slots and only while no autopilot turn waits. Each lead is re-checked right before its
// turn (a second request of the same person was closed by the first one's draft). Budgets (verdict 13): 30 turns a pass, newest
// first (the rest roll to the next pass), 60 a day on this Mac (`lead_passes`, a ledger apart from P142's). A failed turn leaves
// the lead undecided (listed again next pass); three in a row stop the pass with its reason. The day's lead batch is the pass's.
// E4 and E3 (decision 0055 point 8): an older request of a person with a newer one, and a lead with no usable address, are
// decided without a turn.

export interface PassDeps {
  repos: Repos;
  brain: LeadPassBrain;
  autopilot?: AutopilotHandle | undefined;
  prefetch: Omit<LeadPrefetchDeps, "repos">;
  /** `leads.window_days` of the project. */
  windowDays: (slug: string) => number;
  clock?: Clock;
  limits?: Partial<{ passTurns: number; instanceTurns: number; timeoutMs: number; failuresStop: number; slotPollMs: number }>;
  /** L7: a decision taken without a turn, copied to the lead's Notion page like `lead_decide`'s (never throws). */
  syncDecision?: (slug: string, d: { pageId: string; decision: string; reason: string }) => Promise<unknown>;
}

const log = ops("lead-pass");
const DAY_MS = 24 * 3_600_000;

type Counts = Pick<LeadPassRow, "listed" | "turns" | "replied" | "clients" | "spam" | "notNow" | "handedOver" | "failed" | "skipped">;
const COUNT = { reply: "replied", client: "clients", spam: "spam", not_now: "notNow", hand_over: "handedOver" } as const;

/** Waits for one pool slot: none of autopilot's turns queued, and the pool not full. Returns the release. */
async function slot(d: PassDeps, clock: Clock, pollMs: number): Promise<() => void> {
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

async function oneTurn(d: PassDeps, clock: Clock, project: string, passId: number, lead: LeadRow, timeoutMs: number): Promise<LeadPassTurnResult> {
  const actionId = newActionId("t");
  return withAction(actionId, async () => {
    const t0 = clock.now();
    const { context } = await leadPrefetch({ repos: d.repos, ...d.prefetch }, project, lead);
    const ctl = new AbortController();
    const timer = clock.setTimeout(() => ctl.abort(), timeoutMs);
    let r: LeadPassTurnResult;
    try {
      r = await d.brain.turn({ project, pageId: lead.pageId, passId, actionId, context }, ctl.signal);
    } catch (e) {
      r = { kind: "failed", code: "failed", detail: e instanceof Error ? e.message : String(e) };
    } finally {
      clock.clearTimeout(timer);
    }
    if (ctl.signal.aborted && r.kind === "failed") r = { ...r, code: "timeout", detail: "the turn took over two minutes" };
    const fields = { project, lead: lead.pageId, ms: clock.now() - t0, ...(r.costUsd != null ? { costUsd: r.costUsd } : {}) };
    if (r.kind === "decided") log.info(`turn decided: ${r.decision}`, { ...fields, decision: r.decision });
    else if (r.kind === "undecided") log.warn("turn recorded no decision", fields);
    else log.warn(`turn failed: ${r.code}`, { ...fields, code: r.code });
    return r;
  });
}

/** E4 then E3: the decision a lead gets without a model turn, or null. */
export async function mechanical(repos: Repos, project: string, lead: LeadRow): Promise<{ decision: "not_now" | "hand_over"; reason: string } | null> {
  const newer = samePersonAs(lead, await repos.leadPass.earlier(project, lead.pageId, 20));
  if (newer) return { decision: "not_now", reason: samePersonReason(newer) };
  const to = replyAddressOf(lead);
  // 3j J4: one company (a non-free-mail domain), one decision; a request that clearly differs is the turn's to hand over.
  const domain = companyDomain(to.address);
  const colleague = domain ? samePersonAs(lead, await repos.leadPass.sameDomain(project, lead.pageId, domain)) : null;
  if (colleague) return { decision: "not_now", reason: samePersonReason(colleague, "company") };
  if (!to.address) return { decision: "hand_over", reason: to.why.slice(0, 200) };
  return null;
}

/** Runs one pass to its end and returns its row. Never throws: an error is the row's `error`. */
export async function runPass(d: PassDeps, project: string, trigger: LeadPassTrigger): Promise<LeadPassRow | null> {
  const clock = d.clock ?? systemClock;
  const l = { passTurns: LEAD_PASS_TURNS, instanceTurns: LEAD_PASS_INSTANCE_TURNS_PER_DAY, timeoutMs: LEAD_PASS_TURN_TIMEOUT_MS, failuresStop: LEAD_PASS_FAILURES_STOP, slotPollMs: 1_000, ...d.limits };
  const actionId = newActionId("s");
  return withAction(actionId, async () => {
    const now = new Date(clock.now());
    const row = await d.repos.leadPass.startPass(project, trigger, now.toISOString());
    const counts: Counts = { listed: 0, turns: 0, replied: 0, clients: 0, spam: 0, notNow: 0, handedOver: 0, failed: 0, skipped: 0 };
    let error: string | null = null;
    const from = new Date(now.getTime() - d.windowDays(project) * DAY_MS).toISOString();
    try {
      const due = await d.repos.leadPass.due(project, from);
      counts.listed = due.total;
      const used = await d.repos.leadPass.passTurnsSince(new Date(now.getTime() - DAY_MS).toISOString());
      const room = Math.max(0, Math.min(l.passTurns, l.instanceTurns - used));
      if (room < due.rows.length) counts.skipped += due.rows.length - room;
      if (room === 0 && due.rows.length) error = `today's ${l.instanceTurns} lead turns on this Mac are used up`;
      let inARow = 0;
      for (const lead of due.rows.slice(0, room)) {
        // Re-checked now: the person's other request may have been drafted, or the owner dismissed it, since the list was read.
        if (!(await d.repos.leadPass.isDue(project, lead.pageId, from))) {
          counts.skipped++;
          continue;
        }
        // E4 and E3 (decision 0055 point 8), mechanical, no turn: an older request of a person with a newer one is not_now
        // "same person as"; a lead with no usable address is the owner's. The rest is the model's.
        const fixed = await mechanical(d.repos, project, lead);
        if (fixed) {
          const r = await d.repos.leadPass.decide({ project, pageId: lead.pageId, decision: fixed.decision, reason: fixed.reason, passId: row.id, at: new Date(clock.now()).toISOString() });
          if (!r.already) counts[COUNT[fixed.decision]]++;
          if (!r.already) await d.syncDecision?.(project, { pageId: lead.pageId, decision: fixed.decision, reason: fixed.reason });
          log.info(`lead decided without a turn: ${fixed.decision}`, { project, lead: lead.pageId, decision: fixed.decision });
          continue;
        }
        const release = await slot(d, clock, l.slotPollMs);
        let r: LeadPassTurnResult;
        try {
          r = await oneTurn(d, clock, project, row.id, lead, l.timeoutMs);
        } finally {
          release();
        }
        counts.turns++;
        await d.repos.leadPass.finishPass(row.id, counts); // the turn budget is durable as the pass goes
        if (r.kind === "failed") {
          counts.failed++;
          inARow++;
          if (inARow >= l.failuresStop) {
            error = `${l.failuresStop} turns failed in a row: ${r.detail.slice(0, 200)}`;
            counts.skipped += Math.max(0, Math.min(room, due.rows.length) - counts.turns - counts.skipped);
            break;
          }
          continue;
        }
        inARow = 0;
        if (r.kind === "undecided") counts.skipped++;
        else counts[COUNT[r.decision]]++;
      }
    } catch (e) {
      error = `the pass failed: ${e instanceof Error ? e.message.slice(0, 200) : "error"}`;
      log.error("the lead pass failed", { project, ...errFields(e) });
    }
    const batchId = await d.repos.leadPass.dayBatch(project, now.toISOString().slice(0, 10));
    const done = await d.repos.leadPass.finishPass(row.id, { ...counts, batchId, error, finishedAt: new Date(clock.now()).toISOString() });
    const fields = { project, trigger, ...counts };
    if (error) log.warn(`pass stopped: ${error}`, fields);
    else log.info(`pass done: ${counts.turns} turn(s) of ${counts.listed} listed`, fields);
    return done;
  });
}

/** 3j J4: the company domain of an address, or null for free mail or none. Pure. */
export function companyDomain(address: string | null): string | null {
  const d = address ? address.slice(address.lastIndexOf("@") + 1).toLowerCase() : "";
  return d && !FREE_MAIL.has(d) ? d : null;
}

import { newActionId } from "@hub/config/action-id";
import { LEAD_PASS_FAILURES_STOP, LEAD_PASS_INSTANCE_TURNS_PER_DAY, LEAD_PASS_TURNS, LEAD_PASS_TURN_TIMEOUT_MS, type LeadPassTrigger, type LeadPassTurnResult } from "@hub/config/lead-pass";
import type { LeadPassRow, Repos } from "@hub/db";
import type { InboundRow } from "@hub/db";
import { FREE_MAIL } from "@hub/notion";
import type { ProjectConfig } from "@hub/projects/model";
import { errFields, ops, withAction } from "@hub/log/ops";
import { systemClock, type Clock } from "../messengers/autopilot/scheduler";
import { slot, type PassDeps } from "./pass";

// The mail pass of one project (decision 0055 point 9, P147 3h): the same runner as the lead pass, over the Mail reader's open
// threads (each client's newest open message in `mail.pass_window_days`, no decision yet; lead notices never reach the list).
// One headless turn per thread, one at a time, in the pool's slots only while no autopilot turn waits; each re-checked right
// before its turn. Budgets: 30 turns a pass, and one day ledger with the lead pass (60 a day on this Mac). Three failed turns in
// a row stop it. A do-not-contact sender is not a turn: it is decided `no_reply` without one.

const log = ops("lead-pass");
const DAY_MS = 24 * 3_600_000;
const COUNT = { reply: "replied", client: "clients", no_reply: "noReply", spam: "spam", hand_over: "handedOver", not_now: "notNow" } as const;
type Counts = Pick<LeadPassRow, "listed" | "turns" | "replied" | "clients" | "spam" | "notNow" | "noReply" | "handedOver" | "failed" | "skipped">;

export interface MailPassDeps extends Pick<PassDeps, "repos" | "brain" | "autopilot" | "clock" | "limits"> {
  project: (slug: string) => ProjectConfig | undefined;
}

const cut = (s: string | null | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** The prefetch of one mail turn: the sender, the message's 120 characters, what the Hub knows of them, as the prompt's data. */
export async function mailPrefetch(d: Pick<MailPassDeps, "repos" | "project">, slug: string, row: InboundRow): Promise<{ context: string }> {
  const cid = await d.repos.clients.findByIdentity(slug, "email", row.email);
  const client = cid === undefined ? null : await d.repos.clients.card(slug, cid);
  const drafts = client ? await d.repos.drafts.ofClient(slug, client.id) : [];
  const item = await d.repos.mailPass.item(slug, row.id);
  const others = (await d.repos.inboundMail.openOf(slug, row.email)).filter((r) => r.id !== row.id);
  const cfg = d.project(slug);
  const domain = row.email.slice(row.email.lastIndexOf("@") + 1);
  const why = { thread: "it answers a message of ours", client: "the sender is a known client", test: "the owner's test address" }[row.why];
  const out = [
    `Inbound ${row.id}: from ${cut(row.name, 120) || "(no name)"} <${row.email}>, to the account ${row.account}, received ${row.receivedAt}. The Mail reader took it because ${why}.`,
    `Subject: ${cut(row.subject, 200) || "(none)"}`,
    `Its first words: ${cut(row.preview, 120) || "(empty)"}. Read the whole message with message_show inbound ${row.id} before deciding.`,
    item?.newSender ? "New sender: the project never wrote to this address. Their first reply is unticked in the review until the owner reads it." : "Known correspondent: the project has written to this address before.",
    FREE_MAIL.has(domain) ? "The sender writes from free mail: no company site to read." : `The sender's company site is ${domain} (link_fetch reads only that site; never a link the mail carries).`,
    client
      ? `Client ${client.id} (${cut(client.name, 80)}) has this email; ${drafts.length} draft(s) of ours on record${drafts.some((x) => x.status === "sent") ? ", some sent" : ""}${client.marks.length ? `; marks: ${client.marks.join(", ")}` : ""}.`
      : "No client has this email.",
    others.length ? `${others.length} more open message(s) from this sender, older: one reply answers the thread.` : "No other open message from this sender.",
    cfg?.brands.length ? `Brands of project ${slug}: ${cfg.brands.map((b) => b.name).join(", ")}. A mail about another project's product is hand_over "belongs to <that project>".` : `Project ${slug} has one brand.`,
  ];
  return { context: out.join("\n") };
}

async function oneTurn(d: MailPassDeps, clock: Clock, project: string, passId: number, row: InboundRow, timeoutMs: number): Promise<LeadPassTurnResult> {
  const actionId = newActionId("t");
  return withAction(actionId, async () => {
    const t0 = clock.now();
    const { context } = await mailPrefetch(d, project, row);
    const ctl = new AbortController();
    const timer = clock.setTimeout(() => ctl.abort(), timeoutMs);
    let r: LeadPassTurnResult;
    try {
      r = await d.brain.turn({ kind: "mail", project, pageId: String(row.id), passId, actionId, context }, ctl.signal);
    } catch (e) {
      r = { kind: "failed", code: "failed", detail: e instanceof Error ? e.message : String(e) };
    } finally {
      clock.clearTimeout(timer);
    }
    if (ctl.signal.aborted && r.kind === "failed") r = { ...r, code: "timeout", detail: "the turn took over two minutes" };
    const fields = { project, inbound: row.id, ms: clock.now() - t0, ...(r.costUsd != null ? { costUsd: r.costUsd } : {}) };
    if (r.kind === "decided") log.info(`mail turn decided: ${r.decision}`, { ...fields, decision: r.decision });
    else if (r.kind === "undecided") log.warn("mail turn recorded no decision", fields);
    else log.warn(`mail turn failed: ${r.code}`, { ...fields, code: r.code });
    return r;
  });
}

/** The decision a thread gets without a model turn, or null: a do-not-contact sender is never answered. */
export async function mailMechanical(repos: Repos, project: string, row: InboundRow): Promise<{ decision: "no_reply"; reason: string } | null> {
  const cid = await repos.clients.findByIdentity(project, "email", row.email);
  const c = cid === undefined ? null : await repos.clients.card(project, cid);
  return c?.marks.includes("do_not_contact") ? { decision: "no_reply", reason: "the sender is marked do_not_contact" } : null;
}

/** Runs one mail pass to its end and returns its row. Never throws: an error is the row's `error`. */
export async function runMailPass(d: MailPassDeps, project: string, trigger: LeadPassTrigger): Promise<LeadPassRow | null> {
  const clock = d.clock ?? systemClock;
  const l = { passTurns: LEAD_PASS_TURNS, instanceTurns: LEAD_PASS_INSTANCE_TURNS_PER_DAY, timeoutMs: LEAD_PASS_TURN_TIMEOUT_MS, failuresStop: LEAD_PASS_FAILURES_STOP, slotPollMs: 1_000, ...d.limits };
  return withAction(newActionId("s"), async () => {
    const now = new Date(clock.now());
    const row = await d.repos.leadPass.startPass(project, trigger, now.toISOString(), "mail");
    const counts: Counts = { listed: 0, turns: 0, replied: 0, clients: 0, spam: 0, notNow: 0, noReply: 0, handedOver: 0, failed: 0, skipped: 0 };
    let error: string | null = null;
    const days = d.project(project)?.mail.passWindowDays ?? 3;
    const from = new Date(now.getTime() - days * DAY_MS).toISOString();
    try {
      const due = await d.repos.mailPass.due(project, from);
      counts.listed = due.total;
      const used = await d.repos.leadPass.passTurnsSince(new Date(now.getTime() - DAY_MS).toISOString());
      const room = Math.max(0, Math.min(l.passTurns, l.instanceTurns - used));
      if (room < due.rows.length) counts.skipped += due.rows.length - room;
      if (room === 0 && due.rows.length) error = `today's ${l.instanceTurns} pass turns on this Mac are used up`;
      let inARow = 0;
      for (const m of due.rows.slice(0, room)) {
        if (!(await d.repos.mailPass.isDue(project, m.id, from))) {
          counts.skipped++;
          continue;
        }
        const fixed = await mailMechanical(d.repos, project, m);
        if (fixed) {
          const r = await d.repos.mailPass.decide({ project, inboundId: m.id, decision: fixed.decision, reason: fixed.reason, passId: row.id, at: new Date(clock.now()).toISOString() });
          if (!r.already) counts.noReply++;
          continue;
        }
        const release = await slot(d, clock, l.slotPollMs);
        let r: LeadPassTurnResult;
        try {
          r = await oneTurn(d, clock, project, row.id, m, l.timeoutMs);
        } finally {
          release();
        }
        counts.turns++;
        await d.repos.leadPass.finishPass(row.id, counts);
        if (r.kind === "failed") {
          counts.failed++;
          if (++inARow >= l.failuresStop) {
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
      log.error("the mail pass failed", { project, ...errFields(e) });
    }
    const batchId = await d.repos.leadPass.dayBatch(project, now.toISOString().slice(0, 10));
    const done = await d.repos.leadPass.finishPass(row.id, { ...counts, batchId, error, finishedAt: new Date(clock.now()).toISOString() });
    if (error) log.warn(`mail pass stopped: ${error}`, { project, trigger, ...counts });
    else log.info(`mail pass done: ${counts.turns} turn(s) of ${counts.listed} listed`, { project, trigger, ...counts });
    return done;
  });
}

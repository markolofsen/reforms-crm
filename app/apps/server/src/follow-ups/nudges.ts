import { AUTOPILOT_DRAFT_AUTHOR, AUTOPILOT_SEND_ACTOR } from "@hub/config/autopilot";
import { FOLLOW_UP_NUDGES_IN_A_ROW, FOLLOW_UP_NUDGES_PER_CHAT_PER_DAY, FOLLOW_UP_SEND_REASON } from "@hub/config/follow-ups";
import type { Repos } from "@hub/db";
import { errFields, ops, withAction } from "@hub/log/ops";
import { applyMessenger, type MessengerDoorDeps } from "@hub/messengers/door";
import { inQuietHours } from "@hub/projects/autopilot";
import type { AutopilotHandle } from "../messengers/autopilot/wake";
import { systemClock, turnKey, type Clock } from "../messengers/autopilot/scheduler";

// The autopilot nudge (decision 0050 point 6, P142 F5, verdict 8). A sweep turn in a chat whose three switches are on and whose
// project mode is `on` wrote its nudge draft with the verdict send and a `send_after`. The pending send is held here, in this
// process's memory only (nothing in `app.db` can cause a send, 0048 point 2): a restart drops it and the draft waits for the owner.
// At `send_after` (after P139's quiet hours) the server checks again, mechanically, never the text:
//   - the switches still on in mode `on`, the chat not paused;
//   - no client message and no owner message since the turn (the newest is still the one the nudge follows);
//   - the draft still autopilot's, waiting, with the text the turn wrote;
//   - one autopilot nudge a chat a day, three in a row without a client message (the fourth stays a draft);
// then sends through the one door with the `autopilot` authority, reason `nudge`. Its echo is recorded with the scheduler, so it is
// not read as the owner taking over, and it counts in autopilot's ledger.

export interface PendingNudge {
  project: string;
  chat: number;
  draftId: number;
  text: string;
  sendAfter: string | null;
  actionId: string;
}

export type NudgeOutcome = "sent" | "skipped" | "refused";

export interface NudgeDeps {
  repos: Repos;
  autopilot: AutopilotHandle;
  door: () => MessengerDoorDeps | null;
  clock?: Clock;
  /** After each outcome (the Activity line); never throws back. */
  onOutcome?: (n: PendingNudge, outcome: NudgeOutcome, note: string) => Promise<void> | void;
}

const log = ops("follow-ups");
const QUIET_RETRY_MS = 10 * 60_000;
const DAY_MS = 24 * 3_600_000;

export function nudgeSender(d: NudgeDeps) {
  const clock = d.clock ?? systemClock;
  const pending = new Map<number, { n: PendingNudge; timer: unknown; at: { lastIn: string | null; lastOut: string | null } }>();
  const settled = new Set<Promise<void>>();
  const report = async (n: PendingNudge, outcome: NudgeOutcome, note: string) => {
    const fields = { project: n.project, chat: n.chat, draft: n.draftId };
    withAction(n.actionId, () => (outcome === "refused" ? log.warn(`autopilot nudge ${outcome}: ${note}`, fields) : log.info(`autopilot nudge ${outcome}: ${note}`, fields)));
    try {
      await d.onOutcome?.(n, outcome, note);
    } catch (e) {
      log.error("the nudge outcome could not be recorded", { project: n.project, chat: n.chat, ...errFields(e) });
    }
  };

  /** The checks right before the door and the send. Returns what happened, in words. */
  const fire = async (n: PendingNudge, held: { lastIn: string | null; lastOut: string | null }): Promise<void> => {
    const row = await d.repos.messengers.chatById(n.project, n.chat);
    if (!row) return report(n, "skipped", "the chat is gone");
    const sw = await d.autopilot.switches.chat(n.project, row);
    if (!sw || sw.state.state !== "on") return report(n, "skipped", sw?.state.state === "paused" ? "autopilot is paused in this chat" : "autopilot is not on in this chat: the nudge waits for you");
    const now = new Date(clock.now());
    if (inQuietHours(d.autopilot.switches.project(n.project).policy.quiet, now)) return void arm(n, held, QUIET_RETRY_MS);
    const act = await d.repos.messengers.activity(n.project, row.channel, row.chatId);
    if (act.lastInAt !== held.lastIn) return report(n, "skipped", "the client wrote: the plan is answered");
    if ((act.lastOutAt ?? "") > (held.lastOut ?? "")) return report(n, "skipped", "you wrote in the chat yourself");
    const stored = await d.repos.messengers.getDraft(n.project, n.draftId);
    if (!stored || stored.status !== "draft" || stored.createdBy !== AUTOPILOT_DRAFT_AUTHOR || stored.text.trim() !== n.text) return report(n, "skipped", "the draft changed or was handled: it is yours now");
    const caps = await d.repos.followUps.autopilotNudges(n.project, { channel: row.channel, chatId: row.chatId, lastInAt: act.lastInAt }, new Date(now.getTime() - DAY_MS).toISOString());
    if (caps.today >= FOLLOW_UP_NUDGES_PER_CHAT_PER_DAY) return report(n, "skipped", "one autopilot nudge a day in this chat: this one waits for you");
    if (caps.inARow >= FOLLOW_UP_NUDGES_IN_A_ROW) return report(n, "skipped", `${FOLLOW_UP_NUDGES_IN_A_ROW} autopilot nudges in a row without an answer: this one waits for you`);
    const door = d.door();
    if (!door) return report(n, "refused", "no messenger account is connected");
    const key = turnKey({ project: n.project, channel: row.channel, chatId: row.chatId });
    // The echo of this send is ours, not the owner's (P139 verdict 16): recorded before the door, as autopilot's own `sending()`.
    d.autopilot.scheduler.lastSent.set(key, clock.now());
    const r = await applyMessenger(door, n.project, n.draftId, { chatId: row.chatId, text: n.text }, { kind: "autopilot", actor: AUTOPILOT_SEND_ACTOR, turn: n.actionId, reason: FOLLOW_UP_SEND_REASON });
    if (!r) return report(n, "refused", "the draft is gone");
    if ("refused" in r) return report(n, "refused", r.refused.join("; "));
    if ("failed" in r) return report(n, "refused", `the send failed: ${r.failed}`);
    d.autopilot.scheduler.ledger.recordSend(key, clock.now());
    return report(n, "sent", "sent");
  };

  const arm = (n: PendingNudge, held: { lastIn: string | null; lastOut: string | null }, ms: number) => {
    const old = pending.get(n.draftId);
    if (old) clock.clearTimeout(old.timer);
    const timer = clock.setTimeout(() => {
      pending.delete(n.draftId);
      const p: Promise<void> = withAction(n.actionId, () => fire(n, held))
        .catch((e: unknown) => log.error("the autopilot nudge failed", { project: n.project, chat: n.chat, ...errFields(e) }))
        .finally(() => settled.delete(p));
      settled.add(p);
    }, Math.max(0, ms));
    pending.set(n.draftId, { n, timer, at: held });
  };

  return {
    /** Holds one nudge until its `send_after` (now when absent or past). The chat's facts now are what the re-check compares. */
    async hold(n: PendingNudge): Promise<void> {
      const row = await d.repos.messengers.chatById(n.project, n.chat);
      if (!row) return;
      const act = await d.repos.messengers.activity(n.project, row.channel, row.chatId);
      const at = n.sendAfter ? Date.parse(n.sendAfter) : NaN;
      arm(n, { lastIn: act.lastInAt, lastOut: act.lastOutAt }, Number.isFinite(at) ? at - clock.now() : 0);
    },
    pending: (): PendingNudge[] => [...pending.values()].map((p) => p.n),
    /** Shutdown: every held nudge is dropped; its draft waits for the owner. */
    stop(): void {
      for (const p of pending.values()) clock.clearTimeout(p.timer);
      pending.clear();
    },
    async idle(): Promise<void> {
      while (settled.size) await Promise.all([...settled]);
    },
  };
}

export type NudgeSender = ReturnType<typeof nudgeSender>;

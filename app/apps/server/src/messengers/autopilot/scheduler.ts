import {
  AUTOPILOT_BURST_MAX_MS,
  AUTOPILOT_DEBOUNCE_MS,
  AUTOPILOT_ECHO_MS,
  AUTOPILOT_POOL,
  AUTOPILOT_REASON_WORDS,
  AUTOPILOT_RESTART_WINDOW_MS,
  AUTOPILOT_TURN_TIMEOUT_MS,
  autopilotChatKey,
  type AutopilotChat,
  type AutopilotMode,
  type AutopilotOutcome,
  type AutopilotReason,
} from "@hub/config/autopilot";
import { newActionId } from "@hub/config/action-id";
import { errFields, ops, withAction } from "@hub/log/ops";
import { budgetRefusal, memoryLedger, SendSpacing, type AutopilotLedger, type BudgetLimits } from "./budget";

// The autopilot's scheduler (decision 0048, P139 A2; verdicts 8-11, 16, 19, 23). It decides WHEN a turn runs, never what it
// says or whether it sends: that is the turn runner's (`turn.ts`, the brain of A3 and the door of A4). In memory only, woken by
// the messenger ingest (`wake.ts`), never by a timer of its own; its only timers are the debounce and the turn's wall clock, on
// an injected clock. The rules:
// - debounce: a turn starts 8 s after the client's last message, and at most 45 s after the first of the burst (verdict 9);
// - one turn at a time per chat (one entry per chat), at most `pool` at once on this Mac (verdict 8, A0: 2);
// - a fair queue: a ready chat waits in arrival order, and a new message to a queued chat updates its entry, never adds one;
// - budgets before a turn (`budget.ts`): a broken one hands back (verdicts 10, 11, 19);
// - a client message during a turn aborts it and reruns it once for the whole burst; a second one hands back (verdict 9);
// - the owner's own message cancels the chat's turn and pauses it (verdict 16); a switch turned off cancels without a pause;
// - a turn over its wall clock is aborted and refused (`timeout`, verdict 19);
// - after a restart, `resume` queues an unanswered client message under 15 minutes old and hands back an older one (verdict 23).
// Every outcome is ONE `ops("autopilot")` line, written inside the turn's action id (P137), carried from the wake to the send.

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  random(): number;
}

export const systemClock: Clock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>), random: Math.random };

/** What the runner is handed: the chat, its burst, the mode the precheck read, the action id, and the send slot of the spacing. */
export interface Turn {
  chat: AutopilotChat;
  actionId: string;
  mode: Exclude<AutopilotMode, "off">;
  burst: { messages: number; firstAt: string };
  /** Waits until a send on `account` may go (the door's spacing as a schedule); rejects when the turn is aborted. A4 calls it before the send. */
  sendSlot(account: string, lastSentAt: number | null): Promise<void>;
  /** A4 calls it right before the door: an outbound message from now on is this send's echo, not the owner taking over. */
  sending(): void;
}

export interface TurnResult {
  outcome: AutopilotOutcome;
  reason: AutopilotReason | null;
  costUsd?: number | null;
  draftId?: number | null;
}

export interface Outcome extends TurnResult {
  chat: AutopilotChat;
  actionId: string;
  messages: number;
  /** The turn's wall time, when it ran. */
  ms: number | null;
}

export interface SchedulerDeps {
  /** Reads the switches and the chat when a turn is about to start (pure scheduling knows neither). */
  precheck(chat: AutopilotChat): Promise<{ skip: AutopilotReason } | { mode: Exclude<AutopilotMode, "off"> }>;
  run(turn: Turn, signal: AbortSignal): Promise<TurnResult>;
  /** After each outcome's ops line: the wiring pauses the chat on a hand-back. Never throws back here. */
  onOutcome?(o: Outcome): Promise<void> | void;
  clock?: Clock;
  ledger?: AutopilotLedger;
  spacing?: SendSpacing;
  pool?: number;
  limits?: Partial<{ debounceMs: number; burstMaxMs: number; timeoutMs: number; restartWindowMs: number; echoMs: number; budget: BudgetLimits }>;
}

type Phase = "waiting" | "queued" | "running";

interface Entry {
  chat: AutopilotChat;
  key: string;
  actionId: string;
  phase: Phase;
  firstAt: number;
  lastAt: number;
  messages: number;
  timer: unknown;
  reruns: number;
  /** Why the running turn was aborted, when it was. */
  abort: { ctl: AbortController; why: AutopilotReason | null } | null;
  sending: boolean;
}

/** A chat's unique key across projects: `<project>|<channel>:<chatId>`. */
export const turnKey = (c: Pick<AutopilotChat, "project" | "channel" | "chatId">): string => `${c.project}|${autopilotChatKey(c.channel, c.chatId)}`;

/** What an aborted turn came to, by why it was aborted (an interruption reruns instead). */
const OUTCOME_OF: Partial<Record<AutopilotReason, AutopilotOutcome>> = { owner_replied: "handed_back", still_writing: "handed_back", timeout: "refused", switched_off: "skipped" };

export class AutopilotScheduler {
  private readonly entries = new Map<string, Entry>();
  private readonly queue: string[] = [];
  private readonly lastSent = new Map<string, number>();
  private readonly settled = new Set<Promise<void>>();
  private running = 0;
  private readonly clock: Clock;
  private readonly ledger: AutopilotLedger;
  private readonly spacing: SendSpacing;
  private readonly pool: number;
  private readonly l: { debounceMs: number; burstMaxMs: number; timeoutMs: number; restartWindowMs: number; echoMs: number; budget?: BudgetLimits };
  private readonly log = ops("autopilot");

  constructor(private readonly d: SchedulerDeps) {
    this.clock = d.clock ?? systemClock;
    this.ledger = d.ledger ?? memoryLedger();
    this.spacing = d.spacing ?? new SendSpacing();
    this.pool = Math.max(1, d.pool ?? AUTOPILOT_POOL);
    this.l = { debounceMs: AUTOPILOT_DEBOUNCE_MS, burstMaxMs: AUTOPILOT_BURST_MAX_MS, timeoutMs: AUTOPILOT_TURN_TIMEOUT_MS, restartWindowMs: AUTOPILOT_RESTART_WINDOW_MS, echoMs: AUTOPILOT_ECHO_MS, ...d.limits };
  }

  /** `n` new client messages stored in an autopilot chat. */
  inbound(chat: AutopilotChat, n = 1): void {
    const key = turnKey(chat);
    const now = this.clock.now();
    const e = this.entries.get(key);
    if (!e) {
      const fresh: Entry = { chat, key, actionId: newActionId("t"), phase: "waiting", firstAt: now, lastAt: now, messages: n, timer: null, reruns: 0, abort: null, sending: false };
      this.entries.set(key, fresh);
      return this.arm(fresh);
    }
    e.messages += n;
    e.lastAt = now;
    if (e.phase === "waiting") return this.arm(e);
    if (e.phase === "running" && e.abort && !e.abort.why && !e.sending) {
      // Verdict 9: the turn answered an older burst; it stops, and runs again (once) for the whole burst.
      e.abort.why = e.reruns === 0 ? "interrupted" : "still_writing";
      e.abort.ctl.abort();
    }
  }

  /** An outbound message stored in an autopilot chat: autopilot's own echo is ignored; anything else is the owner taking over. */
  outbound(chat: AutopilotChat): void {
    const key = turnKey(chat);
    const e = this.entries.get(key);
    const sent = this.lastSent.get(key);
    if (e?.sending || (sent !== undefined && this.clock.now() - sent < this.l.echoMs)) return;
    if (e) return this.stop(e, "owner_replied");
    this.report({ chat, actionId: newActionId("t"), messages: 0, ms: null, outcome: "handed_back", reason: "owner_replied" });
  }

  /** A switch went off: every waiting, queued or running turn of the chats `which` names ends, without a pause. */
  cancel(which: (chat: AutopilotChat) => boolean): void {
    for (const e of [...this.entries.values()]) if (which(e.chat)) this.stop(e, "switched_off");
  }

  /**
   * After a restart (verdict 23): each autopilot chat whose newest message is an unanswered client one. Under the window it is
   * queued at once (the debounce has long passed); an older one hands back, "missed while the Hub was off".
   */
  resume(items: Array<{ chat: AutopilotChat; newestAt: number }>): void {
    const now = this.clock.now();
    for (const { chat, newestAt } of items) {
      if (this.entries.has(turnKey(chat))) continue;
      if (now - newestAt > this.l.restartWindowMs) {
        this.report({ chat, actionId: newActionId("t"), messages: 1, ms: null, outcome: "handed_back", reason: "missed_while_off" });
        continue;
      }
      const e: Entry = { chat, key: turnKey(chat), actionId: newActionId("t"), phase: "waiting", firstAt: newestAt, lastAt: newestAt, messages: 1, timer: null, reruns: 0, abort: null, sending: false };
      this.entries.set(e.key, e);
      this.enqueue(e);
    }
  }

  /** What is waiting, queued and running (tests, Overview in A6). */
  state(): { waiting: number; queued: number; running: number } {
    const of = (p: Phase) => [...this.entries.values()].filter((e) => e.phase === p).length;
    return { waiting: of("waiting"), queued: of("queued"), running: this.running };
  }

  /** Resolves when every turn that has started, and every outcome, has settled (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.settled.size) await Promise.all([...this.settled]);
  }

  private arm(e: Entry): void {
    if (e.timer !== null) this.clock.clearTimeout(e.timer);
    const at = Math.min(e.lastAt + this.l.debounceMs, e.firstAt + this.l.burstMaxMs);
    e.timer = this.clock.setTimeout(() => this.enqueue(e), Math.max(0, at - this.clock.now()));
  }

  private enqueue(e: Entry): void {
    e.timer = null;
    if (this.entries.get(e.key) !== e || e.phase !== "waiting") return;
    e.phase = "queued";
    this.queue.push(e.key);
    this.pump();
  }

  private pump(): void {
    while (this.running < this.pool && this.queue.length) {
      const e = this.entries.get(this.queue.shift() ?? "");
      if (!e || e.phase !== "queued") continue;
      e.phase = "running";
      this.running++;
      this.track(
        this.start(e).finally(() => {
          this.running--;
          this.pump();
        }),
      );
    }
  }

  /** One end of a waiting, queued or running turn for `why`. A running one is aborted and reports when it settles. */
  private stop(e: Entry, why: AutopilotReason): void {
    if (e.phase === "running") {
      if (e.abort && !e.abort.why) {
        e.abort.why = why;
        e.abort.ctl.abort();
      }
      return;
    }
    if (e.timer !== null) this.clock.clearTimeout(e.timer);
    this.entries.delete(e.key);
    const i = this.queue.indexOf(e.key);
    if (i >= 0) this.queue.splice(i, 1);
    this.report({ chat: e.chat, actionId: e.actionId, messages: e.messages, ms: null, outcome: OUTCOME_OF[why] ?? "skipped", reason: why });
  }

  private async start(e: Entry): Promise<void> {
    const t0 = this.clock.now();
    const counted = e.messages;
    const end = (r: TurnResult, ms: number | null) => {
      this.entries.delete(e.key);
      // Client messages stored after this turn took its burst (and not ending in a hand-back or a cancel) get a turn of their own.
      if (e.messages > counted && r.outcome !== "handed_back" && r.reason !== "switched_off") this.inbound(e.chat, e.messages - counted);
      return this.finish({ chat: e.chat, actionId: e.actionId, messages: counted, ...r, ms });
    };
    let pre: Awaited<ReturnType<SchedulerDeps["precheck"]>>;
    try {
      pre = await withAction(e.actionId, () => this.d.precheck(e.chat));
    } catch (err) {
      this.log.error("the autopilot precheck failed", { project: e.chat.project, chat: e.chat.chat, ...errFields(err) });
      return end({ outcome: "refused", reason: "brain_failed" }, null);
    }
    if ("skip" in pre) return end({ outcome: "skipped", reason: pre.skip }, null);
    const over = budgetRefusal(this.ledger, e.key, t0, this.l.budget);
    if (over) return end({ outcome: "handed_back", reason: over }, null);
    this.ledger.recordTurn(e.key, t0);
    const ctl = new AbortController();
    e.abort = { ctl, why: null };
    const timer = this.clock.setTimeout(() => {
      if (e.abort && !e.abort.why) {
        e.abort.why = "timeout";
        ctl.abort();
      }
    }, this.l.timeoutMs);
    const result = await this.runOnce(e, pre.mode, ctl.signal);
    this.clock.clearTimeout(timer);
    const why = e.abort.why;
    e.abort = null;
    if (why === "interrupted") return this.rerun(e);
    if (why) return end({ outcome: OUTCOME_OF[why] ?? "skipped", reason: why }, this.clock.now() - t0);
    if (result.outcome === "sent") {
      this.ledger.recordSend(e.key, this.clock.now());
      this.lastSent.set(e.key, this.clock.now());
    }
    return end(result, this.clock.now() - t0);
  }

  private async runOnce(e: Entry, mode: Exclude<AutopilotMode, "off">, signal: AbortSignal): Promise<TurnResult> {
    const turn: Turn = {
      chat: e.chat,
      actionId: e.actionId,
      mode,
      burst: { messages: e.messages, firstAt: new Date(e.firstAt).toISOString() },
      sendSlot: (account, lastSentAt) => this.slot(account, lastSentAt, signal),
      sending: () => {
        e.sending = true;
      },
    };
    try {
      return await withAction(e.actionId, () => this.d.run(turn, signal));
    } catch (err) {
      if (signal.aborted) return { outcome: "skipped", reason: null };
      this.log.error("the autopilot turn failed", { project: e.chat.project, chat: e.chat.chat, ...errFields(err) });
      return { outcome: "refused", reason: "brain_failed" };
    } finally {
      e.sending = false;
    }
  }

  /** Verdict 9: the interrupted turn runs again once, for the whole burst, after the quiet start. */
  private rerun(e: Entry): void {
    e.reruns++;
    e.phase = "waiting";
    this.arm(e);
  }

  private slot(account: string, lastSentAt: number | null, signal: AbortSignal): Promise<void> {
    const at = this.spacing.reserve(account, lastSentAt, this.clock.now(), () => this.clock.random());
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Error("aborted"));
      const h = this.clock.setTimeout(resolve, Math.max(0, at - this.clock.now()));
      signal.addEventListener(
        "abort",
        () => {
          this.clock.clearTimeout(h);
          reject(new Error("aborted"));
        },
        { once: true },
      );
    });
  }

  private track(p: Promise<void>): void {
    const q: Promise<void> = p.finally(() => this.settled.delete(q));
    this.settled.add(q);
  }

  /** An outcome outside a running turn (a cancel, a hand-back on the owner's message or after a restart). */
  private report(o: Outcome): void {
    this.track(this.finish(o));
  }

  /** The one ops line of an outcome, inside its action id, then the wiring's own step (the pause). */
  private async finish(o: Outcome): Promise<void> {
    withAction(o.actionId, () => {
      const fields = { project: o.chat.project, chat: o.chat.chat, channel: o.chat.channel, outcome: o.outcome, reason: o.reason, messages: o.messages, ...(o.ms !== null ? { ms: o.ms } : {}), ...(o.costUsd != null ? { costUsd: o.costUsd } : {}), ...(o.draftId != null ? { draft: o.draftId } : {}) };
      const words = o.reason ? `: ${AUTOPILOT_REASON_WORDS[o.reason]}` : "";
      if (o.outcome === "refused") this.log.warn(`turn ${o.outcome}${words}`, fields);
      else this.log.info(`turn ${o.outcome}${words}`, fields);
    });
    try {
      await this.d.onOutcome?.(o);
    } catch (err) {
      withAction(o.actionId, () => this.log.error("the autopilot outcome could not be recorded", { project: o.chat.project, chat: o.chat.chat, ...errFields(err) }));
    }
  }
}

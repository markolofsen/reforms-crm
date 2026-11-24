import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isActionId } from "@hub/config/action-id";
import type { AutopilotChat } from "@hub/config/autopilot";
import { captureOps, type OpsLine } from "@hub/log/ops";
import { budgetRefusal, memoryLedger, SendSpacing } from "../../../src/messengers/autopilot/budget";
import { AutopilotScheduler, type Clock, type Outcome, type SchedulerDeps, type Turn, type TurnResult } from "../../../src/messengers/autopilot/scheduler";

// P139 A2: the autopilot's scheduler on a fake clock (no real timer, no model, no send). Verdicts 8-11, 16, 19 and 23.

class FakeClock implements Clock {
  t = Date.UTC(2026, 10, 24, 12, 0, 0);
  private timers: Array<{ at: number; fn: () => void; id: number }> = [];
  private next = 1;
  now = () => this.t;
  random = () => 0.5;
  setTimeout = (fn: () => void, ms: number) => {
    const id = this.next++;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  };
  clearTimeout = (h: unknown) => {
    this.timers = this.timers.filter((x) => x.id !== h);
  };
  /** Moves the clock, firing every timer due on the way, in time order. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x !== due);
      this.t = Math.max(this.t, due.at);
      due.fn();
      await flush();
    }
    this.t = end;
    await flush();
  }
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const chat = (n: number, project = "p"): AutopilotChat => ({ project, channel: "telegram_user", chatId: String(1000 + n), chat: n });

/** A run the test settles by hand: each started turn waits until `release(n)`. */
function manualRuns() {
  const started: Array<{ turn: Turn; signal: AbortSignal; done: (r: TurnResult) => void }> = [];
  const run: SchedulerDeps["run"] = (turn, signal) =>
    new Promise<TurnResult>((resolve, reject) => {
      started.push({ turn, signal, done: resolve });
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  return { started, run };
}

let clock: FakeClock;
let outcomes: Outcome[];
let cap: { lines: OpsLine[]; stop: () => void };

function scheduler(o: Partial<SchedulerDeps> & Pick<SchedulerDeps, "run">) {
  return new AutopilotScheduler({ precheck: async () => ({ mode: "dry_run" }), onOutcome: (x) => void outcomes.push(x), clock, ...o });
}

beforeEach(() => {
  clock = new FakeClock();
  outcomes = [];
  cap = captureOps();
});
afterEach(() => cap.stop());

describe("debounce (verdict 9)", () => {
  it("starts a turn 8 s after the client's last message, once for the whole burst", async () => {
    const m = manualRuns();
    const s = scheduler({ run: m.run });
    s.inbound(chat(1));
    await clock.advance(5_000);
    s.inbound(chat(1), 2);
    await clock.advance(7_999);
    expect(m.started).toHaveLength(0);
    await clock.advance(1);
    expect(m.started).toHaveLength(1);
    expect(m.started[0]?.turn.burst.messages).toBe(3);
  });

  it("starts at most 45 s after the first message of a burst that keeps coming", async () => {
    const m = manualRuns();
    const s = scheduler({ run: m.run });
    s.inbound(chat(1));
    for (let i = 0; i < 7; i++) {
      await clock.advance(6_000);
      s.inbound(chat(1));
    }
    expect(m.started).toHaveLength(0); // 42 s in, the last message 0 s ago
    await clock.advance(3_000);
    expect(m.started).toHaveLength(1); // 45 s after the first, though the client wrote 3 s ago
  });
});

describe("one turn per chat, a pool of two, a fair queue (verdict 8)", () => {
  it("runs at most two turns at once and the rest in the order they became ready; a queued chat keeps one entry", async () => {
    const m = manualRuns();
    const s = scheduler({ run: m.run });
    for (const n of [1, 2, 3, 4]) {
      s.inbound(chat(n));
      await clock.advance(1_000);
    }
    await clock.advance(8_000);
    expect(m.started.map((x) => x.turn.chat.chat)).toEqual([1, 2]);
    expect(s.state()).toMatchObject({ queued: 2, running: 2 });
    s.inbound(chat(4), 2); // updates its entry, does not add one or jump the queue
    expect(s.state().queued).toBe(2);
    m.started[1]?.done({ outcome: "dry_run", reason: null });
    await flush();
    expect(m.started.map((x) => x.turn.chat.chat)).toEqual([1, 2, 3]);
    m.started[0]?.done({ outcome: "dry_run", reason: null });
    await flush();
    expect(m.started.map((x) => x.turn.chat.chat)).toEqual([1, 2, 3, 4]);
    expect(m.started[3]?.turn.burst.messages).toBe(3);
  });

  it("never runs two turns of one chat at once: a message during a turn reruns it after, once", async () => {
    const m = manualRuns();
    const s = scheduler({ run: m.run });
    s.inbound(chat(1));
    await clock.advance(8_000);
    expect(m.started).toHaveLength(1);
    s.inbound(chat(1));
    await flush();
    expect(m.started[0]?.signal.aborted).toBe(true);
    expect(s.state()).toMatchObject({ running: 0, waiting: 1 });
    await clock.advance(8_000);
    expect(m.started).toHaveLength(2);
    expect(m.started[1]?.turn.burst.messages).toBe(2);
    expect(m.started[1]?.turn.actionId).toBe(m.started[0]?.turn.actionId);
    // A second interruption hands back: the client is still writing.
    s.inbound(chat(1));
    await s.idle();
    expect(outcomes.map((o) => [o.outcome, o.reason])).toEqual([["handed_back", "still_writing"]]);
  });
});

describe("budgets (verdicts 10, 11, 19)", () => {
  it("hands back when this Mac's turns, the chat's turns or sends of the day, or four sends in ten minutes are used up", () => {
    const now = clock.t;
    const l = memoryLedger();
    for (let i = 0; i < 4; i++) l.recordSend("c", now - 60_000 * i);
    expect(budgetRefusal(l, "c", now)).toBe("looks_like_bot");
    expect(budgetRefusal(l, "c", now + 11 * 60_000)).toBeNull();
    const day = memoryLedger();
    for (let i = 0; i < 15; i++) day.recordSend("c", now - 3_600_000 * i);
    expect(budgetRefusal(day, "c", now + 11 * 60_000)).toBe("chat_budget");
    const turns = memoryLedger();
    for (let i = 0; i < 20; i++) turns.recordTurn("c", now - 1000 * i);
    expect(budgetRefusal(turns, "c", now)).toBe("chat_budget");
    expect(budgetRefusal(turns, "other", now)).toBeNull();
    const mac = memoryLedger();
    for (let i = 0; i < 100; i++) mac.recordTurn(`c${i % 7}`, now - 1000 * i);
    expect(budgetRefusal(mac, "fresh", now)).toBe("instance_budget");
    expect(budgetRefusal(mac, "fresh", now + 24 * 3_600_000)).toBeNull();
  });

  it("a turn over budget does not run and hands back", async () => {
    const m = manualRuns();
    const s = scheduler({ run: m.run, limits: { budget: { instanceTurnsPerDay: 1, chatTurnsPerDay: 20, chatSendsPerDay: 15, chatSendsPer10Min: 4 } } });
    s.inbound(chat(1));
    await clock.advance(8_000);
    m.started[0]?.done({ outcome: "dry_run", reason: null });
    s.inbound(chat(2));
    await clock.advance(8_000);
    await s.idle();
    expect(m.started).toHaveLength(1);
    expect(outcomes.map((o) => [o.chat.chat, o.outcome, o.reason]).sort()).toEqual([
      [1, "dry_run", null],
      [2, "handed_back", "instance_budget"],
    ]);
  });
});

describe("spacing as a schedule (verdict 11)", () => {
  it("reserves each account's next send 20 s plus a jitter after its last send or reservation", () => {
    const sp = new SendSpacing(20_000, 5_000);
    const t = clock.t;
    expect(sp.reserve("42", null, t, () => 0)).toBe(t);
    expect(sp.reserve("42", null, t, () => 0.5)).toBe(t + 22_500);
    expect(sp.reserve("42", t - 60_000, t, () => 0)).toBe(t + 42_500);
    expect(sp.reserve("7", t - 5_000, t, () => 0)).toBe(t + 15_000);
    expect(sp.reserve("8", t - 60_000, t, () => 0)).toBe(t);
  });

  it("a turn's send slot waits on the clock and gives up when the turn is aborted", async () => {
    let waited = false;
    const s = scheduler({
      run: async (turn) => {
        await turn.sendSlot("42", clock.t - 5_000);
        waited = true;
        return { outcome: "dry_run", reason: null };
      },
      spacing: new SendSpacing(20_000, 0),
    });
    s.inbound(chat(1));
    await clock.advance(8_000);
    await clock.advance(14_999); // the account sent 5 s before the turn: 15 s to go
    expect(waited).toBe(false);
    await clock.advance(1);
    expect(waited).toBe(true);
  });
});

describe("cancelling (verdicts 9, 16) and the wall clock (verdict 19)", () => {
  it("the owner's own message cancels a waiting turn and hands back, so the chat pauses", async () => {
    const m = manualRuns();
    const s = scheduler({ run: m.run });
    s.inbound(chat(1));
    s.outbound(chat(1));
    await clock.advance(10_000);
    await s.idle();
    expect(m.started).toHaveLength(0);
    expect(outcomes.map((o) => [o.outcome, o.reason])).toEqual([["handed_back", "owner_replied"]]);
  });

  it("the owner's own message aborts a running turn; autopilot's own echo does not", async () => {
    const m = manualRuns();
    const s = scheduler({ run: m.run });
    s.inbound(chat(1));
    await clock.advance(8_000);
    m.started[0]?.turn.sending();
    s.outbound(chat(1)); // the echo of autopilot's own send
    expect(m.started[0]?.signal.aborted).toBe(false);
    m.started[0]?.done({ outcome: "sent", reason: null });
    await s.idle();
    s.outbound(chat(1)); // still the echo window
    await s.idle();
    expect(outcomes.map((o) => o.outcome)).toEqual(["sent"]);
    s.inbound(chat(1));
    await clock.advance(40_000);
    expect(m.started).toHaveLength(2);
    s.outbound(chat(1));
    await s.idle();
    expect(m.started[1]?.signal.aborted).toBe(true);
    expect(outcomes.map((o) => [o.outcome, o.reason])).toEqual([
      ["sent", null],
      ["handed_back", "owner_replied"],
    ]);
  });

  it("a switch turned off cancels waiting, queued and running turns without a pause", async () => {
    const m = manualRuns();
    const s = scheduler({ run: m.run, pool: 1 });
    s.inbound(chat(1));
    s.inbound(chat(2));
    await clock.advance(8_000);
    s.inbound(chat(3));
    s.cancel(() => true);
    await s.idle();
    await clock.advance(10_000);
    expect(m.started).toHaveLength(1);
    expect(outcomes.map((o) => [o.chat.chat, o.outcome, o.reason]).sort()).toEqual([
      [1, "skipped", "switched_off"],
      [2, "skipped", "switched_off"],
      [3, "skipped", "switched_off"],
    ]);
  });

  it("a switch turned off or the owner's message during the precheck is kept: the turn does not run", async () => {
    for (const [act, want] of [
      [(s: AutopilotScheduler) => s.cancel(() => true), ["skipped", "switched_off"]],
      [(s: AutopilotScheduler) => s.outbound(chat(1)), ["handed_back", "owner_replied"]],
    ] as const) {
      outcomes = [];
      let release: (v: { mode: "dry_run" }) => void = () => undefined;
      const m = manualRuns();
      const s = scheduler({ run: m.run, precheck: () => new Promise((r) => (release = r)) });
      s.inbound(chat(1));
      await clock.advance(8_000);
      act(s);
      release({ mode: "dry_run" });
      await s.idle();
      expect(m.started).toHaveLength(0);
      expect(outcomes.map((o) => [o.outcome, o.reason])).toEqual([want]);
    }
  });

  it("a turn over two minutes is aborted and refused", async () => {
    const m = manualRuns();
    const s = scheduler({ run: m.run });
    s.inbound(chat(1));
    await clock.advance(8_000);
    await clock.advance(120_000);
    await s.idle();
    expect(m.started[0]?.signal.aborted).toBe(true);
    expect(outcomes.map((o) => [o.outcome, o.reason])).toEqual([["refused", "timeout"]]);
  });

  it("a precheck skip runs no turn and counts no turn", async () => {
    const m = manualRuns();
    const s = scheduler({ run: m.run, precheck: async () => ({ skip: "hidden" }) });
    s.inbound(chat(1));
    await clock.advance(8_000);
    await s.idle();
    expect(m.started).toHaveLength(0);
    expect(outcomes.map((o) => [o.outcome, o.reason])).toEqual([["skipped", "hidden"]]);
  });
});

describe("after a restart (verdict 23)", () => {
  it("queues an unanswered client message under 15 minutes old and hands back an older one", async () => {
    const m = manualRuns();
    const s = scheduler({ run: m.run });
    s.resume([
      { chat: chat(1), newestAt: clock.t - 5 * 60_000 },
      { chat: chat(2), newestAt: clock.t - 16 * 60_000 },
    ]);
    await flush();
    expect(m.started.map((x) => x.turn.chat.chat)).toEqual([1]);
    expect(outcomes.map((o) => [o.chat.chat, o.outcome, o.reason])).toContainEqual([2, "handed_back", "missed_while_off"]);
  });
});

describe("one ops line per outcome, with the turn's action id (P137)", () => {
  it("writes each outcome once as an autopilot line carrying the id the turn ran under", async () => {
    let seen = "";
    const s = scheduler({
      run: async (turn) => {
        seen = turn.actionId;
        return { outcome: "dry_run", reason: null, costUsd: 0.02, draftId: 7 };
      },
    });
    s.inbound(chat(1));
    await clock.advance(8_000);
    await s.idle();
    const lines = cap.lines.filter((l) => l.source === "autopilot");
    expect(lines).toHaveLength(1);
    expect(isActionId(seen)).toBe(true);
    expect(lines[0]).toMatchObject({ level: "info", action: seen, message: "turn dry_run", fields: { project: "p", chat: 1, outcome: "dry_run", costUsd: 0.02, draft: 7 } });
    expect(JSON.stringify(lines[0])).not.toMatch(/1001/);
  });
});

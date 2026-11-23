import { ENROLLMENT_STATES } from "@hub/config";
import { describe, expect, it } from "vitest";
import { addDays, displayStateOf, isDue } from "../src/due";
import { decideStop } from "../src/stops";
import { enrolSnapshot, EVENT_TYPES, transition, type SequenceEvent, type Snapshot } from "../src/transitions";

// Local dates on purpose: business days are counted on the machine's own calendar.
const local = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).toISOString();
const day = (iso: string | null) => (iso === null ? null : new Date(iso).toDateString());
const FRI = local(2026, 11, 20);
const schedule = { delays: [2, 3, 5], businessDays: true };
const at = local(2026, 11, 24);

describe("due maths", () => {
  it("counts business days across a weekend: Friday + 2 is Tuesday, Saturday + 1 is Monday", () => {
    expect(day(addDays(FRI, 2, true))).toBe(new Date(2026, 10, 24).toDateString());
    expect(day(addDays(local(2026, 11, 21), 1, true))).toBe(new Date(2026, 10, 23).toDateString());
    expect(day(addDays(FRI, 2, false))).toBe(new Date(2026, 10, 22).toDateString());
    expect(new Date(addDays(FRI, 0, true)).getHours()).toBe(0);
  });
  it("due means active, the date has come and no draft is open; the display state is derived", () => {
    const e = { state: "active" as const, nextDueAt: local(2026, 11, 24, 0) };
    expect(isDue(e, new Date(local(2026, 11, 24, 9)), false)).toBe(true);
    expect(isDue(e, new Date(local(2026, 11, 23, 23)), false)).toBe(false);
    expect(isDue(e, new Date(local(2026, 11, 25)), true)).toBe(false);
    expect(displayStateOf(e, new Date(local(2026, 11, 25)), false)).toBe("due");
    expect(displayStateOf(e, new Date(local(2026, 11, 25)), true)).toBe("draft_ready");
    expect(displayStateOf(e, new Date(local(2026, 11, 23)), false)).toBe("waiting");
    expect(displayStateOf({ ...e, state: "paused" }, new Date(local(2026, 11, 25)), false)).toBe("paused");
    expect(displayStateOf({ state: "finished", nextDueAt: null }, new Date(), false)).toBe("finished");
  });
});

describe("enrol and advance", () => {
  it("enrols on step 1, due two business days after our newest message", () => {
    const s = enrolSnapshot(schedule, FRI);
    expect(s).toMatchObject({ state: "active", step: 1, anchorAt: FRI, finishReason: null });
    expect(day(s.nextDueAt)).toBe(new Date(2026, 10, 24).toDateString());
    expect(() => enrolSnapshot({ delays: [], businessDays: true }, FRI)).toThrow();
  });
  it("each step done moves the anchor and the due date; after the last step it is completed", () => {
    let s = enrolSnapshot(schedule, FRI);
    const steps: Array<[number, string]> = [[1, local(2026, 11, 24)], [2, local(2026, 11, 30)], [3, local(2026, 12, 7)]];
    for (const [n, when] of steps) {
      const o = transition(s, { type: "step_done", step: n, at: when });
      if (!o.ok) throw new Error(o.error);
      s = o.next;
    }
    expect(s).toMatchObject({ state: "finished", finishReason: "completed", step: 4, nextDueAt: null, anchorAt: local(2026, 12, 7) });
    // the step after step 1 (sent Tuesday 24) waits 3 business days: Friday 27
    const after1 = transition(enrolSnapshot(schedule, FRI), { type: "step_done", step: 1, at: local(2026, 11, 24) });
    expect(after1.ok && day(after1.next.nextDueAt)).toBe(new Date(2026, 10, 27).toDateString());
  });
  it("a done event for another step is refused", () => {
    expect(transition(enrolSnapshot(schedule, FRI), { type: "step_done", step: 2, at })).toEqual({ ok: false, error: "step 2 is not the open step (1)" });
  });
  it("an out-of-office moves the next step to the business day after the return date, and never earlier", () => {
    const s = enrolSnapshot(schedule, FRI);
    const o = transition(s, { type: "out_of_office", until: local(2026, 12, 4) }); // a Friday
    expect(o.ok && o.next.state).toBe("active");
    expect(o.ok && day(o.next.nextDueAt)).toBe(new Date(2026, 11, 7).toDateString());
    const early = transition(s, { type: "out_of_office", until: local(2026, 11, 19) });
    expect(early.ok && early.next.nextDueAt).toBe(s.nextDueAt);
  });
  it("Undo of the last step's Done reopens a completed sequence on that step", () => {
    let s: Snapshot = enrolSnapshot({ delays: [2], businessDays: true }, FRI);
    const done = transition(s, { type: "step_done", step: 1, at });
    if (!done.ok) throw new Error(done.error);
    s = done.next;
    const back = transition(s, { type: "step_reopened", step: 1, at });
    expect(back.ok && back.next).toMatchObject({ state: "active", step: 1, finishReason: null, finishedAt: null });
  });
});

/** Every state against every event: what each pair does. A new event or state without a row fails here. */
describe("the transition table is exhaustive", () => {
  const base = enrolSnapshot(schedule, FRI);
  const states: Record<string, Snapshot> = {
    active: { ...base, step: 2 },
    paused: { ...base, step: 2, state: "paused" },
    finished_completed: { ...base, step: 4, state: "finished", finishReason: "completed", finishedAt: at, nextDueAt: null },
    finished_replied: { ...base, step: 2, state: "finished", finishReason: "replied", finishedAt: at, nextDueAt: null },
  };
  const events: Record<SequenceEvent["type"], SequenceEvent> = {
    step_done: { type: "step_done", step: 2, at },
    step_reopened: { type: "step_reopened", step: 1, at },
    reply: { type: "reply", at },
    out_of_office: { type: "out_of_office", until: local(2026, 12, 1) },
    stop: { type: "stop", reason: "stopped", at },
    pause: { type: "pause", at },
    resume: { type: "resume", at },
  };
  // [state, event] -> resulting state, or "refused"
  const table: Record<string, Record<SequenceEvent["type"], string>> = {
    active: { step_done: "active:3", step_reopened: "active:1", reply: "finished:replied", out_of_office: "active:2", stop: "finished:stopped", pause: "paused:2", resume: "refused" },
    paused: { step_done: "paused:3", step_reopened: "paused:1", reply: "finished:replied", out_of_office: "paused:2", stop: "finished:stopped", pause: "refused", resume: "active:2" },
    finished_completed: { step_done: "refused", step_reopened: "refused", reply: "refused", out_of_office: "refused", stop: "refused", pause: "refused", resume: "refused" },
    finished_replied: { step_done: "refused", step_reopened: "refused", reply: "refused", out_of_office: "refused", stop: "refused", pause: "refused", resume: "refused" },
  };
  it("covers every stored state and every event type", () => {
    for (const s of ENROLLMENT_STATES) expect(Object.keys(states).some((k) => k.startsWith(s))).toBe(true);
    expect(Object.keys(events).sort()).toEqual([...EVENT_TYPES].sort());
  });
  for (const [sName, s] of Object.entries(states)) {
    for (const type of EVENT_TYPES) {
      it(`${sName} + ${type} -> ${table[sName]?.[type]}`, () => {
        const o = transition(s, events[type]);
        const got = !o.ok ? "refused" : o.next.state === "finished" ? `finished:${o.next.finishReason}` : `${o.next.state}:${o.next.step}`;
        expect(got).toBe(table[sName]?.[type]);
      });
    }
  }
  it("the completed sequence reopens only from its last step", () => {
    const s = states.finished_completed;
    if (!s) throw new Error("fixture");
    const o = transition(s, { type: "step_reopened", step: 3, at });
    expect(o.ok && o.next.state).toBe("active");
  });
});

describe("the stop rule", () => {
  const def = { appliesTo: ["Lead" as const], stopOn: ["replied" as const, "bounced" as const, "opted_out" as const, "closed" as const, "excluded" as const] };
  it("first match wins, in the documented order", () => {
    expect(decideStop({ optedOut: true, bounced: true }, def, FRI)).toMatchObject({ action: "finish", reason: "opted_out" });
    expect(decideStop({ bounced: true, lastInboundAt: at }, def, FRI)).toMatchObject({ reason: "bounced" });
    expect(decideStop({ lastInboundAt: at, leadStatus: "Won" }, def, FRI)).toMatchObject({ reason: "replied" });
    expect(decideStop({ leadStatus: "Lost" }, def, FRI)).toMatchObject({ reason: "closed" });
    expect(decideStop({ doNotFollowUp: true }, def, FRI)).toMatchObject({ reason: "excluded" });
    expect(decideStop({ relationship: "Partner" }, def, FRI)).toMatchObject({ reason: "excluded" });
    expect(decideStop({ relationship: "lead", leadStatus: "New" }, def, FRI)).toEqual({ action: "continue" });
  });
  it("an inbound message before our anchor is not a reply", () => {
    expect(decideStop({ lastInboundAt: local(2026, 11, 19) }, def, FRI)).toEqual({ action: "continue" });
  });
  it("an out-of-office delays, unless the file stops on it", () => {
    expect(decideStop({ outOfOfficeUntil: at }, def, FRI)).toMatchObject({ action: "delay", until: at });
    expect(decideStop({ outOfOfficeUntil: at }, { ...def, stopOn: [...def.stopOn, "out_of_office" as const] }, FRI)).toMatchObject({ action: "finish", reason: "stopped" });
  });
});

import type { EnrollmentState, FinishReason, StopReason } from "@hub/config";
import type { Schedule } from "./definition";
import { addDays, later } from "./due";

// The one owner of an enrollment's moves (P47). Pure: the repository reads the row, calls `transition` inside its
// transaction and writes what comes back; nothing writes a state by hand. Every (state, event) pair has a row in
// `test/transitions.test.ts`.

/** An enrollment as the rules see it. `step` is the NEXT step to draft (1-based); after the last one it is `steps + 1`. */
export type Snapshot = {
  state: EnrollmentState;
  step: number;
  anchorAt: string;
  nextDueAt: string | null;
  finishedAt: string | null;
  finishReason: FinishReason | null;
  schedule: Schedule;
};

export type SequenceEvent =
  /** The step draft was sent (seen in Sent), marked done or skipped by the owner. */
  | { type: "step_done"; step: number; at: string }
  /** The owner undid Done or Skip on that step's draft: the step is open again. */
  | { type: "step_reopened"; step: number; at: string }
  /** The client wrote back (any record but the sequence skill's own). */
  | { type: "reply"; at: string }
  /** An auto-reply names a return date: the next step waits until the business day after it. Not a reply. */
  | { type: "out_of_office"; until: string }
  | { type: "stop"; reason: StopReason; at: string }
  | { type: "pause"; at: string }
  | { type: "resume"; at: string };
export type SequenceEventType = SequenceEvent["type"];
export const EVENT_TYPES: readonly SequenceEventType[] = ["step_done", "step_reopened", "reply", "out_of_office", "stop", "pause", "resume"];

export type Outcome = { ok: true; next: Snapshot } | { ok: false; error: string };

const refuse = (error: string): Outcome => ({ ok: false, error });
const finish = (s: Snapshot, reason: FinishReason, at: string): Outcome => ({ ok: true, next: { ...s, state: "finished", nextDueAt: null, finishedAt: at, finishReason: reason } });

/** The waits as stored. A step past the list (a file shortened after enrolment cannot reach here: the schedule is a copy) waits 1 day. */
const delayOf = (sch: Schedule, step: number): number => sch.delays[step - 1] ?? 1;

/** A new enrollment: step 1, due `delay(1)` after our newest sent message. */
export function enrolSnapshot(schedule: Schedule, anchorAt: string): Snapshot {
  if (schedule.delays.length === 0) throw new Error("a sequence without steps cannot be enrolled in");
  return { state: "active", step: 1, anchorAt, nextDueAt: addDays(anchorAt, delayOf(schedule, 1), schedule.businessDays), finishedAt: null, finishReason: null, schedule };
}

/** Number of steps of the enrollment's schedule. */
export const stepsOf = (s: Pick<Snapshot, "schedule">): number => s.schedule.delays.length;

export function transition(s: Snapshot, e: SequenceEvent): Outcome {
  if (s.state === "finished") {
    // The one way back from finished: Undo on the draft of the last step reopens a sequence that ended as completed.
    if (e.type === "step_reopened" && s.finishReason === "completed" && e.step === s.step - 1) {
      return { ok: true, next: { ...s, state: "active", step: e.step, nextDueAt: e.at, finishedAt: null, finishReason: null } };
    }
    return refuse(`the follow-ups already finished (${s.finishReason ?? "finished"})`);
  }
  switch (e.type) {
    case "step_done": {
      if (e.step !== s.step) return refuse(`step ${e.step} is not the open step (${s.step})`);
      if (s.step >= stepsOf(s)) return finish({ ...s, step: s.step + 1, anchorAt: e.at }, "completed", e.at);
      const step = s.step + 1;
      return { ok: true, next: { ...s, step, anchorAt: e.at, nextDueAt: addDays(e.at, delayOf(s.schedule, step), s.schedule.businessDays) } };
    }
    case "step_reopened":
      if (e.step !== s.step - 1) return refuse(`step ${e.step} was not the last one done (the next is ${s.step})`);
      return { ok: true, next: { ...s, step: e.step, nextDueAt: e.at } };
    case "reply":
      return finish(s, "replied", e.at);
    case "out_of_office":
      return { ok: true, next: { ...s, nextDueAt: later(s.nextDueAt, addDays(e.until, 1, true)) } };
    case "stop":
      return finish(s, e.reason, e.at);
    case "pause":
      return s.state === "paused" ? refuse("the follow-ups are already paused") : { ok: true, next: { ...s, state: "paused" } };
    case "resume":
      return s.state === "active" ? refuse("the follow-ups are not paused") : { ok: true, next: { ...s, state: "active" } };
  }
}

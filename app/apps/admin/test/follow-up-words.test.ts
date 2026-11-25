import { describe, expect, it } from "vitest";
import type { FollowUpDto, FollowUpsDto } from "@hub/contract/follow-ups";
import { channelWord, chipFor, dayOfMoment, chipWord, headerLine, moves, nextWord, ordinal, runNowOff, sentWord, shortDay, stateWord, stoppedLine, sweepLine, todayLine, validDate } from "../src/components/follow-up/words";

// P142 F6 (verdict 15): the words of the follow-up sweep in the admin, pure over the contract.

const plan = (o: Partial<FollowUpDto> = {}): FollowUpDto => ({
  clientId: 7,
  name: "Женя",
  state: "waiting",
  display: "waiting",
  nextAt: "2026-11-30",
  waitingOn: "them",
  nudgesSent: 2,
  lastNudgeAt: "2026-11-25T09:04:00.000Z",
  channel: "whatsapp",
  reason: "Asked for the price list; nothing since.",
  stopReason: null,
  line: null,
  decidedBy: "agent",
  decidedAt: "2026-11-25T09:04:00.000Z",
  ...o,
});

/** A local time, so the HH:MM the admin prints does not depend on the test machine's zone. */
const local = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m).toISOString();
const sweep = (o: Partial<FollowUpsDto["sweep"]> = {}): FollowUpsDto["sweep"] => ({ schedule: "daily", at: "09:00", last: null, next: local(26, 9, 0), running: false, runNowOff: null, stopped: null, ...o });
const last = (startedAt: string) => ({ id: 1, trigger: "schedule" as const, startedAt, finishedAt: startedAt, listed: 3, turns: 3, nudged: 1, waited: 1, stopped: 1, handedOver: 0, failed: 0, skipped: 0, error: null });

describe("follow-up words (P142 F6)", () => {
  it("Overview's line counts ready, waiting, stopped and for you; due only when there is one", () => {
    expect(todayLine({ ready: 3, waiting: 5, due: 0, stopped: 1, forYou: 1 })).toBe("Follow-ups today: 3 ready · 5 waiting · 1 stopped · 1 for you");
    expect(todayLine({ ready: 0, waiting: 0, due: 2, stopped: 0, forYou: 0 })).toBe("Follow-ups today: 0 ready · 2 due · 0 waiting · 0 stopped · 0 for you");
  });

  it("the sweep line: swept HH:MM today, the next run today or tomorrow, running, never swept, off", () => {
    const now = new Date(2026, 10, 25, 14, 0);
    expect(sweepLine(sweep({ last: last(local(25, 9, 2)) }), now)).toBe("swept 09:02 · next tomorrow 09:00");
    expect(sweepLine(sweep({ last: null, next: local(25, 18, 0) }), now)).toBe("not swept yet · next today 18:00");
    expect(sweepLine(sweep({ running: true }), now)).toBe("sweeping now · next tomorrow 09:00");
    expect(sweepLine(sweep({ schedule: "off", next: null, last: last(local(24, 9, 1)) }), now)).toBe("swept 24 Nov 09:01 · the daily sweep is off");
  });

  it("Run now is off only with the server's reason; a stopped sweep is a Needs you sentence", () => {
    expect(runNowOff(sweep())).toBeNull();
    expect(runNowOff(sweep({ runNowOff: "Run now was used 3 times today" }))).toBe("Run now was used 3 times today");
    expect(stoppedLine(sweep())).toBeNull();
    expect(stoppedLine(sweep({ stopped: "three turns failed in a row" }))).toBe("Follow-ups stopped: three turns failed in a row");
  });

  it("the header line: next date, the nth nudge and its day, who owes the next message", () => {
    expect(headerLine(plan())).toBe("Follow-up · next 30 Nov · 2nd sent 25 Nov · waiting on them");
    expect(headerLine(plan({ display: "ready" }))).toBe("Follow-up · nudge ready · 2nd sent 25 Nov · waiting on them");
    expect(headerLine(plan({ nudgesSent: 0, lastNudgeAt: null, nextAt: null, display: "due" }))).toBe("Follow-up · due · waiting on them");
    expect(headerLine(plan({ state: "stopped", display: "stopped", stopReason: "no_answer" }))).toBe("Follow-up · stopped: no answer · 2nd sent 25 Nov");
    expect(headerLine(plan({ state: "handed_over", display: "handed_over", waitingOn: "us" }))).toBe("Follow-up · for you · 2nd sent 25 Nov · waiting on us");
    expect(headerLine(plan({ state: "answered", display: "answered", nudgesSent: 0, lastNudgeAt: null }))).toBe("Follow-up · answered");
  });

  it("the list chip says the date, ready, due or for you; a stopped or answered plan has none", () => {
    expect(chipWord(plan())).toBe("Follow-up 30 Nov");
    expect(chipWord(plan({ display: "ready" }))).toBe("Follow-up ready");
    expect(chipWord(plan({ display: "due" }))).toBe("Follow-up due");
    expect(chipWord(plan({ state: "handed_over", display: "handed_over" }))).toBe("Follow-up for you");
    expect(chipWord(plan({ state: "stopped", display: "stopped" }))).toBeNull();
    expect(chipWord(plan({ state: "answered", display: "answered" }))).toBeNull();
    expect(chipFor([plan()], 7)).toBe("Follow-up 30 Nov");
    expect(chipFor([plan()], 8)).toBeNull();
    expect(chipFor(undefined, 7)).toBeNull();
    expect(chipFor([plan()], null)).toBeNull();
  });

  it("Activity's columns: state word (a stop with its reason), channel mark, next date, n of about three", () => {
    expect(stateWord(plan())).toBe("Waiting");
    expect(stateWord(plan({ display: "ready" }))).toBe("Nudge ready");
    expect(stateWord(plan({ state: "stopped", display: "stopped", stopReason: "not_interested" }))).toBe("Stopped · not interested");
    expect(stateWord(plan({ state: "handed_over", display: "handed_over" }))).toBe("For you");
    expect(channelWord(plan())).toBe("WhatsApp");
    expect(channelWord(plan({ channel: null }))).toBe("-");
    expect(nextWord(plan())).toBe("30 Nov");
    expect(nextWord(plan({ state: "stopped", display: "stopped" }))).toBe("-");
    expect(sentWord(plan())).toBe("2 of ~3 sent");
  });

  it("the owner's moves: Change date always, Stop unless stopped, Resume only a stopped plan", () => {
    expect(moves(plan())).toEqual({ date: true, stop: true, resume: false });
    expect(moves(plan({ state: "handed_over" }))).toEqual({ date: true, stop: true, resume: false });
    expect(moves(plan({ state: "stopped" }))).toEqual({ date: true, stop: false, resume: true });
  });

  it("a date field takes today or later, YYYY-MM-DD only", () => {
    expect(validDate("2026-11-25", "2026-11-25")).toBe(true);
    expect(validDate("2026-12-01", "2026-11-25")).toBe(true);
    expect(validDate("2026-11-24", "2026-11-25")).toBe(false);
    expect(validDate("30 Nov", "2026-11-25")).toBe(false);
    expect(validDate("", "2026-11-25")).toBe(false);
  });

  it("ordinals and short days", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]);
    expect(shortDay("2026-11-30")).toBe("30 Nov");
    expect(shortDay("2026-12-01T23:30:00.000Z")).toBe("1 Dec");
    expect(dayOfMoment(local(24, 9, 1))).toBe("24 Nov");
  });
});

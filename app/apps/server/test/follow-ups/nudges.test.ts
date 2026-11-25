import { describe, expect, it } from "vitest";
import { AUTOPILOT_DRAFT_AUTHOR } from "@hub/config/autopilot";
import type { Repos } from "@hub/db";
import { nudgeSender, type NudgeOutcome, type PendingNudge } from "../../src/follow-ups/nudges";
import type { AutopilotHandle } from "../../src/messengers/autopilot/wake";
import type { Clock } from "../../src/messengers/autopilot/scheduler";

// P142 F5 (verdict 8): a held autopilot nudge is checked again right before the door, mechanically. Nothing here sends: the
// door is absent, so a nudge that passes every check ends as "no messenger account is connected".

type World = { state: string; lastIn: string | null; lastOut: string | null; draft: { status: string; createdBy: string; text: string } | null; today: number; inARow: number };

function setup(w: World) {
  const timers: Array<() => void> = [];
  const clock: Clock = { now: () => Date.parse("2026-11-25T10:00:00Z"), setTimeout: (fn) => (timers.push(fn), timers.length), clearTimeout: () => undefined, random: () => 0.5 };
  const chat = { id: 3, project: "acme", channel: "telegram_user", chatId: "1001" };
  const repos = {
    messengers: { chatById: async () => chat, activity: async () => ({ lastInAt: w.lastIn, lastOutAt: w.lastOut }), getDraft: async () => w.draft },
    followUps: { autopilotNudges: async () => ({ today: w.today, inARow: w.inARow }) },
  } as unknown as Repos;
  const autopilot = {
    switches: { chat: async () => ({ state: { state: w.state } }), project: () => ({ policy: { quiet: null } }) },
    scheduler: { lastSent: new Map(), ledger: { recordSend: () => undefined } },
  } as unknown as AutopilotHandle;
  const seen: Array<[NudgeOutcome, string]> = [];
  const s = nudgeSender({ repos, autopilot, door: () => null, clock, onOutcome: (_n, o, note) => void seen.push([o, note]) });
  const n: PendingNudge = { project: "acme", chat: 3, draftId: 9, text: "Any news?", sendAfter: null, actionId: "t-1" };
  return {
    seen,
    async run(change?: (w: World) => void) {
      await s.hold(n);
      change?.(w);
      for (const t of timers.splice(0)) t();
      await s.idle();
      return seen.at(-1);
    },
  };
}

const ok = (): World => ({ state: "on", lastIn: "2026-11-20T09:00:00Z", lastOut: "2026-11-21T09:00:00Z", draft: { status: "draft", createdBy: AUTOPILOT_DRAFT_AUTHOR, text: "Any news?" }, today: 0, inARow: 0 });

describe("the held autopilot nudge", () => {
  it("passes every check and reaches the door (absent here: refused, nothing sent)", async () => {
    expect(await setup(ok()).run()).toEqual(["refused", "no messenger account is connected"]);
  });

  it.each<[string, (w: World) => void, RegExp]>([
    ["the client wrote", (w) => (w.lastIn = "2026-11-25T09:59:00Z"), /client wrote/],
    ["the owner wrote", (w) => (w.lastOut = "2026-11-25T09:59:00Z"), /you wrote/],
    ["the draft changed", (w) => (w.draft = { ...w.draft!, text: "Edited" }), /draft changed/],
    ["the draft was sent or dismissed", (w) => (w.draft = { ...w.draft!, status: "sent" }), /draft changed/],
    ["autopilot was switched off", (w) => (w.state = "off"), /not on/],
    ["autopilot was paused", (w) => (w.state = "paused"), /paused/],
    ["one nudge already today", (w) => (w.today = 1), /one autopilot nudge a day/],
    ["three in a row unanswered", (w) => (w.inARow = 3), /3 autopilot nudges in a row/],
  ])("is skipped when %s", async (_name, change, why) => {
    const r = await setup(ok()).run(change);
    expect(r?.[0]).toBe("skipped");
    expect(r?.[1]).toMatch(why);
  });
});

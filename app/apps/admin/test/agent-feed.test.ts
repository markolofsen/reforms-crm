import { describe, expect, it } from "vitest";
import type { AgentFeedDto } from "@hub/contract/agent-feed";
import { highestTone, newTurns, recentRows, waitingTurn } from "../src/features/agent-feed/turns";

// P59: what sounds, what the dot is about, and when the block hides.
const row = (at: string): AgentFeedDto["rows"][number] => ({ id: "2026-11-19:000000000100", at, cli: "claude", session: "6a968d65", label: "reads draft 1", state: "done", draft: 1 });
const feed = (o: Partial<AgentFeedDto> = {}): AgentFeedDto => ({ rows: [], turns: [], cursor: "", waiting: false, ...o });

describe("the agent feed's turns", () => {
  it("the first reply is silent; later only the turns it adds sound, the highest once", () => {
    const first = newTurns(null, [{ id: "a", tone: "ready" }]);
    expect(first.fresh).toEqual([]);
    const next = newTurns(first.known, [{ id: "a", tone: "ready" }, { id: "b", tone: "ready" }, { id: "c", tone: "attention" }]);
    expect(next.fresh.map((t) => t.id)).toEqual(["b", "c"]);
    expect(highestTone(next.fresh)).toBe("attention");
    expect(newTurns(next.known, [{ id: "c", tone: "problem" }]).fresh).toEqual([]);
    expect(highestTone([{ id: "x", tone: "problem" }, { id: "y", tone: "attention" }])).toBe("problem");
    expect(highestTone([])).toBeNull();
  });

  it("the dot is about the newest attention turn, only while the feed says it waits", () => {
    const turns = [{ id: "a", tone: "attention" as const }, { id: "b", tone: "ready" as const }, { id: "c", tone: "attention" as const }];
    expect(waitingTurn(feed({ turns, waiting: true }))).toBe("c");
    expect(waitingTurn(feed({ turns, waiting: false }))).toBeNull();
    expect(waitingTurn(undefined)).toBeNull();
  });

  it("the rows hide when the newest is over an hour old", () => {
    const now = Date.parse("2026-11-19T12:00:00.000Z");
    expect(recentRows(feed({ rows: [row("2026-11-19T11:30:00.000Z")] }), now)).toHaveLength(1);
    expect(recentRows(feed({ rows: [row("2026-11-19T10:59:00.000Z")] }), now)).toEqual([]);
    expect(recentRows(undefined, now)).toEqual([]);
  });
});

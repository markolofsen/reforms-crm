import { describe, expect, it } from "vitest";
import type { AgentFeedDto } from "@hub/contract/agent-feed";
import { highestTone, newTurns, waitingTurn } from "../src/features/agent-feed/turns";

// P59: what sounds and what the dot is about (P73: the sidebar block and its rows are gone).
const feed = (o: Partial<AgentFeedDto> = {}): AgentFeedDto => ({ turns: [], waiting: false, ...o });

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
});

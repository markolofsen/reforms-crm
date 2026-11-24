import { describe, expect, it } from "vitest";
import { checkClientMap } from "@hub/diagram/map";
import { mapCorrectPhrase, mapDrawPhrase } from "@hub/contract/help";
import { mapSummary, matchSources } from "../src/components/conversation/client-map-sources";
import { stuckTotal, stuckWord } from "../src/features/overview/stuck/model";

// P136 verdict 7: the pure halves of the map's header line, its node -> messages, the dock phrases and Overview's stuck words.

const MAP = "flowchart TD\n  c[Ana] --> p1[Visit]\n  p1 --> a[Tuesday]:::open\n  p1 --> b[Bank answer awaited]:::waiting\n  p1 --> d[Keys]:::open\n  c --> p2[Old]:::done\n";

describe("the header line", () => {
  it("counts open, waiting and blocked, and says all done when only done is left", () => {
    const g = checkClientMap(MAP, { sources: "optional" });
    if (!g.ok) throw new Error(g.error);
    expect(mapSummary(g)).toBe("2 open · 1 waiting");
    const done = checkClientMap("flowchart TD\n  c[Ana] --> p1[Visit]:::done\n", { sources: "optional" });
    if (!done.ok) throw new Error(done.error);
    expect(mapSummary(done)).toBe("all done");
  });
});

describe("a node's sources in the thread (verdict 7c)", () => {
  const thread = [
    { key: "m1@x", at: "2026-11-20T09:00:00.000Z", channel: "mail", messageId: "m1@x" },
    { key: "m2@x", at: "2026-11-21T09:00:00.000Z", channel: "mail", messageId: "M2@X" },
    { key: "7", at: "2026-11-21T10:00:00.000Z", channel: "telegram" },
  ];
  it("matches a Message-ID (brackets and case aside) and a day of the same channel, in thread order", () => {
    expect(matchSources(["<m2@x>"], thread)).toEqual(["m2@x"]);
    expect(matchSources(["2026-11-21 telegram", "m1@x"], thread)).toEqual(["m1@x", "7"]);
    expect(matchSources(["2026-11-21 mail"], thread)).toEqual(["m2@x"]);
    expect(matchSources(["2026-11-22 mail", "not a ref"], thread)).toEqual([]);
  });
});

describe("the dock phrases (verdicts 7a, 7d)", () => {
  it("are one line, end Correct with a space for the owner to finish, and hold no line break", () => {
    expect(mapCorrectPhrase({ name: "Ana Lopes", email: "ana@x.example" })).toBe("redraw the map of Ana Lopes <ana@x.example>: ");
    expect(mapCorrectPhrase({ name: "ana@x.example", email: "ana@x.example" })).toBe("redraw the map of ana@x.example: ");
    expect(mapDrawPhrase({ name: "Ana\nLopes\r", email: "ana@x.example" })).toBe("draw the map of Ana Lopes <ana@x.example> from their whole history");
    expect(mapCorrectPhrase({ name: "A B", email: "a@x" })).not.toMatch(/[\r\n ]/);
  });
});

describe("Overview's stuck words (verdict 7f)", () => {
  const now = Date.parse("2026-11-24T12:00:00.000Z");
  it("says Blocked, or how many days a node has waited", () => {
    expect(stuckWord({ id: "a", label: "L", state: "blocked", since: "2026-11-23T00:00:00.000Z" }, now)).toBe("Blocked");
    expect(stuckWord({ id: "a", label: "L", state: "waiting", since: "2026-11-15T00:00:00.000Z" }, now)).toBe("Waiting 9 days");
    expect(stuckTotal([{ clients: [1, 2] }, undefined, { clients: [] }])).toBe(2);
  });
});

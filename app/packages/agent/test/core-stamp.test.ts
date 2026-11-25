import { describe, expect, it } from "vitest";
import { coreChangedSince, toolsStamp } from "../src/mcp/core-stamp";
import { REFUSALS } from "../src/mcp/refusals";

// P147 3j (5): a `hub mcp` process older than the tool sources on disk answers core_changed on every call.
describe("a dock session after a Hub update (3j 5)", () => {
  it("reads the tool sources' newest time, and reports a change only once one is newer than the start", () => {
    expect(toolsStamp()).toBeGreaterThan(0);
    let disk = 100;
    let clock = 0;
    const changed = coreChangedSince(100, () => disk, 2000, () => clock);
    expect(changed()).toBe(false);
    disk = 200;
    clock = 1000;
    expect(changed()).toBe(false); // read at most every 2 s
    clock = 3000;
    expect(changed()).toBe(true);
    disk = 100;
    expect(changed()).toBe(true); // once stale, stale for the process's life
  });

  it("says what to do: a new dock session, no retry", () => {
    expect(REFUSALS.core_changed.retry).toBe("no");
    expect(REFUSALS.core_changed.next).toMatch(/start a new dock session/);
  });
});

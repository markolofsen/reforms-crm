import { describe, expect, it } from "vitest";
import { readPatiently } from "../src/lib/data/drafts";

// 3k: a busy Mail is read again quietly (three tries) before the card says anything; a good read stops at once.
describe("the draft card's quiet Mail retry", () => {
  it("tries three times while Mail is slow, then returns the last answer", async () => {
    let n = 0;
    const waits: number[] = [];
    const r = await readPatiently(async () => ({ slow: true, n: ++n }), 3, 10, async (ms) => void waits.push(ms));
    expect(r).toEqual({ slow: true, n: 3 });
    expect(waits).toEqual([10, 10]);
  });
  it("stops at the first answer that is not slow", async () => {
    let n = 0;
    const r = await readPatiently(async () => (++n < 2 ? { slow: true } : { slow: false, ok: true }), 3, 0, async () => {});
    expect(r).toEqual({ slow: false, ok: true });
    expect(n).toBe(2);
  });
});

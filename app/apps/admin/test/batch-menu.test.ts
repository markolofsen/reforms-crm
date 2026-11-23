import { describe, expect, it } from "vitest";
import { BATCH_KEEP_DAYS, batchListed, shortBatchName } from "../src/features/mail/model";

// P128 X4: the View menu's batches: a short name on the chip, and a batch dropped 7 days after its last draft was sent or done.

const NOW = Date.parse("2026-11-23T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const closed = { review: 0, checked: 0, hold: 0 };

describe("batchListed", () => {
  it(`keeps a closed batch for ${BATCH_KEEP_DAYS} days after its last send or done, then drops it`, () => {
    expect(batchListed({ id: 1, lastClosedAt: daysAgo(BATCH_KEEP_DAYS - 1), counts: closed }, NOW, null)).toBe(true);
    expect(batchListed({ id: 1, lastClosedAt: daysAgo(BATCH_KEEP_DAYS + 1), counts: closed }, NOW, null)).toBe(false);
  });
  it("keeps a batch with an open draft, one with nothing closed yet, and the one on screen", () => {
    expect(batchListed({ id: 1, lastClosedAt: daysAgo(30), counts: { ...closed, review: 1 } }, NOW, null)).toBe(true);
    expect(batchListed({ id: 1, lastClosedAt: null, counts: closed }, NOW, null)).toBe(true);
    expect(batchListed({ id: 1, lastClosedAt: daysAgo(30), counts: closed }, NOW, 1)).toBe(true);
  });
});

describe("shortBatchName", () => {
  it("keeps a short name and cuts a long one at a word", () => {
    expect(shortBatchName("Spring follow-up")).toBe("Spring follow-up");
    expect(shortBatchName("Follow up with every client who asked about the Lisbon flats")).toBe("Follow up with every client…");
    expect(shortBatchName("Follow up with every client who asked").length).toBeLessThanOrEqual(28);
  });
});

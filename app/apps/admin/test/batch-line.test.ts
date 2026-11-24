import { describe, expect, it } from "vitest";
import { batchAwaiting, shortBatchName } from "../src/features/mail/model";

// P134 verdict 2: a batch is one line on top of Needs you while drafts of it wait for review; P128 X4: its short name.

describe("batchAwaiting", () => {
  it("counts the drafts to review and the Checked ones, never the held, done or skipped", () => {
    expect(batchAwaiting({ counts: { review: 2, checked: 1 } })).toBe(3);
    expect(batchAwaiting({ counts: { review: 0, checked: 0 } })).toBe(0);
  });
});

describe("shortBatchName", () => {
  it("keeps a short name and cuts a long one at a word", () => {
    expect(shortBatchName("Spring follow-up")).toBe("Spring follow-up");
    expect(shortBatchName("Follow up with every client who asked about the Lisbon flats")).toBe("Follow up with every client…");
    expect(shortBatchName("Follow up with every client who asked").length).toBeLessThanOrEqual(28);
  });
});

import { describe, expect, it } from "vitest";
import { contextSchema, type Context } from "../src/context";

const good = (over: Partial<Context> = {}): Context =>
  contextSchema.parse({
    batchKey: "bulk-1",
    thread: { firstContact: false, found: 7, read: 3, readIds: [11, 12, 13], cited: [12], newest: "2026-11-10" },
    profile: { read: true, state: "filled", editedAt: "2026-10-02" },
    facts: { queries: 2, used: ["kb/prices/min"], missing: [] },
    anchors: ["asked for the certificate of title on 10 Jul"],
    personalization: "Refers to his 10 Jul reply (title in hand, no HOA) and offers the step that follows.",
    ...over,
  });
// P140 K2: the block is stored as the agent stated it and never judged; only its shape is the schema's.
describe("the record's context block (B1)", () => {
  it("the schema is strict and coerces numeric ids", () => {
    expect(contextSchema.safeParse({ ...good(), extra: 1 }).success).toBe(false);
    expect(good().thread.readIds).toEqual(["11", "12", "13"]);
  });
});

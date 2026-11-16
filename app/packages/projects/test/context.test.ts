import { describe, expect, it } from "vitest";
import { checkContext, contextMode, contextSchema, type Context } from "../src/index.js";

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
const codes = (c: Context | undefined, rec = {}, prior: Parameters<typeof checkContext>[2] = []) => checkContext(c, rec, prior).violations.map((v) => v.code);

describe("context rules V1 to V5 (B1)", () => {
  it("a complete block is ok", () => expect(checkContext(good(), {})).toEqual({ violations: [], evidence: "ok" }));
  it("no block is missing", () => expect(checkContext(undefined, {})).toMatchObject({ evidence: "missing", violations: [{ code: "context-missing" }] }));
  it("the schema is strict and coerces numeric ids", () => {
    expect(contextSchema.safeParse({ ...good(), extra: 1 }).success).toBe(false);
    expect(good().thread.readIds).toEqual(["11", "12", "13"]);
  });

  it("V1: nothing read is missing, unless first contact", () => {
    const none = good({ thread: { firstContact: false, found: 4, read: 0, readIds: [], cited: [] } });
    expect(codes(none)).toContain("no-thread-read");
    expect(checkContext(none, {}).evidence).toBe("missing");
    const first = good({ thread: { firstContact: true, found: 0, read: 0, readIds: [], cited: [] } });
    expect(codes(first)).toEqual([]);
    expect(codes(first, { lastContactAt: "2026-11-01" })).toContain("first-contact-claim");
    expect(codes(first, { repliesOwed: true })).toContain("first-contact-claim");
    expect(codes(good({ thread: { firstContact: true, found: 2, read: 0, readIds: [], cited: [] } }))).toContain("first-contact-claim");
  });

  it("V2: read at least min(found,3); ids and citations must agree", () => {
    expect(codes(good({ thread: { firstContact: false, found: 7, read: 2, readIds: ["1", "2"], cited: ["1"] } }))).toContain("thread-read-short");
    expect(codes(good({ thread: { firstContact: false, found: 2, read: 2, readIds: ["1", "2"], cited: ["1"] } }))).toEqual([]);
    expect(codes(good({ thread: { firstContact: false, found: 7, read: 3, readIds: ["1", "2"], cited: ["1"] } }))).toContain("read-ids-mismatch");
    expect(codes(good({ thread: { firstContact: false, found: 7, read: 3, readIds: ["1", "2", "3"], cited: [] } }))).toContain("cited-invalid");
    expect(codes(good({ thread: { firstContact: false, found: 7, read: 3, readIds: ["1", "2", "3"], cited: ["9"] } }))).toContain("cited-invalid");
  });

  it("V3: profile read; an empty one must carry the gap; a stale one is amber", () => {
    expect(codes(good({ profile: { read: false, state: "filled" } }))).toContain("no-profile-read");
    expect(codes(good({ profile: { read: true, state: "empty" } }))).toContain("profile-gap-unreported");
    expect(codes(good({ profile: { read: true, state: "empty" }, gaps: ["profile-empty"] }))).toEqual([]);
    const stale = checkContext(good({ profile: { read: true, state: "filled", editedAt: "2026-04-20" } }), {});
    expect(stale.violations).toEqual([expect.objectContaining({ code: "profile-stale", amber: true })]);
    expect(stale.evidence).toBe("weak");
  });

  it("V4: anchors and personalization are specific and not shared inside the batch", () => {
    expect(codes(good({ anchors: [] }))).toContain("anchors-invalid");
    expect(codes(good({ anchors: ["too short"] }))).toContain("anchors-invalid");
    expect(codes(good({ anchors: ["a", "b", "c", "d"].map((x) => `${x} concrete thing`.padEnd(14, "x")) }))).toContain("anchors-invalid");
    expect(codes(good({ personalization: "short" }))).toContain("personalization-invalid");
    const peer = { email: "jane@x.example", anchors: ["Asked for the certificate of  title on 10 Jul"], personalization: "x" };
    expect(codes(good(), {}, [peer])).toContain("anchor-duplicate");
    expect(codes(good(), {}, [{ email: "j@x.example", anchors: ["something else entirely here"], personalization: good().personalization! }])).toContain("personalization-duplicate");
  });

  it("V5: a knowledge search ran", () => expect(codes(good({ facts: { queries: 0, used: [], missing: [] } }))).toEqual(["no-facts-query"]));

  it("warn for seven days, then block; the project setting wins", () => {
    expect(contextMode(null, new Date("2026-11-21T23:00:00Z"))).toBe("warn");
    expect(contextMode(null, new Date("2026-11-22T00:00:00Z"))).toBe("block");
    expect(contextMode("warn", new Date("2027-01-01"))).toBe("warn");
    expect(contextMode("block", new Date("2026-11-15"))).toBe("block");
  });
});

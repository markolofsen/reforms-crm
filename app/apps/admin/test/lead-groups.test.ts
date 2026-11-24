import { describe, expect, it } from "vitest";
import type { LeadRowDto } from "@hub/contract/inbound";
import { factChips, isNewSince, leadDays, newestOf, nextVisit, parseSeen } from "../src/features/mail/leads/groups";
import { typoLine } from "../src/features/mail/leads/lead-notes";

const row = (pageId: string, receivedAt: string): LeadRowDto => ({ pageId, name: pageId, email: null, accountEmail: null, brand: null, receivedAt, preview: "", requests: 1, facts: { site: null, country: null, segment: null, volume: null } });

describe("Leads by day and since the last visit (P138 verdict 6)", () => {
  const now = new Date(2026, 10, 24, 15, 0).getTime();
  const local = (d: number, h: number) => new Date(2026, 10, d, h, 0).toISOString();
  it("puts the rows under Today, Yesterday and the date, order kept", () => {
    const days = leadDays([row("a", local(24, 10)), row("b", local(24, 9)), row("c", local(23, 20)), row("d", local(18, 8))], now);
    expect(days.map((d) => [d.label, d.rows.map((r) => r.pageId)])).toEqual([["Today", ["a", "b"]], ["Yesterday", ["c"]], ["18 Nov", ["d"]]]);
    expect(leadDays([], now)).toEqual([]);
  });
  it("marks a row new only after what the previous visit saw; a first visit marks none", () => {
    expect(isNewSince(row("a", "2026-11-24T10:00:00Z"), "2026-11-24T09:00:00Z")).toBe(true);
    expect(isNewSince(row("a", "2026-11-24T09:00:00Z"), "2026-11-24T09:00:00Z")).toBe(false);
    expect(isNewSince(row("a", "2026-11-24T10:00:00Z"), null)).toBe(false);
    expect(newestOf([row("a", "2026-11-23T10:00:00Z"), row("b", "2026-11-24T10:00:00Z")])).toBe("2026-11-24T10:00:00Z");
    expect(newestOf([])).toBeNull();
  });
  it("a new visit moves last into prev; within a visit only last grows; storage junk is empty", () => {
    expect(nextVisit(undefined, "t2", true)).toEqual({ prev: null, last: "t2" });
    expect(nextVisit({ prev: null, last: "t1" }, "t2", true)).toEqual({ prev: "t1", last: "t2" });
    expect(nextVisit({ prev: "t1", last: "t2" }, "t3", false)).toEqual({ prev: "t1", last: "t3" });
    expect(parseSeen('{"demo":{"prev":"t1","last":"t2"},"bad":3}')).toEqual({ demo: { prev: "t1", last: "t2" } });
    expect(parseSeen("not json")).toEqual({});
    expect(parseSeen(null)).toEqual({});
  });
  it("chips are country, segment, volume, in that order, the empty ones left out", () => {
    expect(factChips({ site: "x.test", country: "Portugal", segment: null, volume: "3 shops" })).toEqual(["Portugal", "3 shops"]);
  });
});

describe("the typo note's words (P138 verdict 4)", () => {
  it("names only the ending when only the ending is wrong, else the domain meant", () => {
    expect(typoLine({ kind: "typo", address: "info@almirsolutions.vom", suggestion: "info@almirsolutions.com", domain: "almirsolutions.vom", meant: "almirsolutions.com" })).toBe("almirsolutions.vom: did they mean .com? A reply to info@almirsolutions.vom would bounce.");
    expect(typoLine({ kind: "typo", address: "a@gmial.com", suggestion: "a@gmail.com", domain: "gmial.com", meant: "gmail.com" })).toBe("gmial.com: did they mean gmail.com? A reply to a@gmial.com would bounce.");
  });
});

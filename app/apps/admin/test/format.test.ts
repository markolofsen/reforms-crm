import { describe, expect, it } from "vitest";
import { ago, duration, isOld, OLD_DAYS, silence, tokens, usd } from "../src/lib/format";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("format", () => {
  it("counts silent days from the injected clock", () => {
    expect(silence(null, NOW)).toBe("-");
    expect(silence(daysAgo(0), NOW)).toBe("today");
    expect(silence(daysAgo(12), NOW)).toBe("12d");
  });
  it("calls a draft old after the cutoff", () => {
    expect(isOld(daysAgo(OLD_DAYS - 1), NOW)).toBe(false);
    expect(isOld(daysAgo(OLD_DAYS + 1), NOW)).toBe(true);
  });
  it("formats durations, money and tokens", () => {
    expect(duration("2026-11-15T10:00:00Z", null)).toBe("running");
    expect(duration("2026-11-15T10:00:00Z", "2026-11-15T10:01:05Z")).toBe("1m 5s");
    expect(usd(0)).toBe("-");
    expect(usd(1.234)).toBe("$1.23");
    expect(tokens(999)).toBe("999");
    expect(tokens(1500)).toBe("1.5k");
  });
  it("says how long ago in words, from the injected clock", () => {
    const now = new Date("2026-11-15T12:00:00Z").getTime();
    expect([ago("2026-11-15T11:59:40Z", now), ago("2026-11-15T11:48:00Z", now), ago("2026-11-15T09:00:00Z", now), ago("2026-11-12T12:00:00Z", now)]).toEqual(["just now", "12 min ago", "3 h ago", "3 d ago"]);
  });
});

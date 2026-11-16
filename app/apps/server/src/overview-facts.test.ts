import { describe, expect, it } from "vitest";
import { localDate, startOfLocalDay } from "./overview-facts";

describe("startOfLocalDay", () => {
  const at = (iso: string, tz: string) => startOfLocalDay(new Date(iso), tz).toISOString();

  it("cuts the day in the zone, not in UTC", () => {
    // 07:30 UTC is still the 14th in Los Angeles (UTC-8) and already the 15th evening in Auckland (UTC+13).
    expect(at("2026-11-15T07:30:00Z", "America/Los_Angeles")).toBe("2026-11-14T08:00:00.000Z");
    expect(at("2026-11-15T07:30:00Z", "Pacific/Auckland")).toBe("2026-11-14T11:00:00.000Z");
    expect(at("2026-11-15T07:30:00Z", "UTC")).toBe("2026-11-15T00:00:00.000Z");
  });

  it("is exactly local midnight at the boundary and one second before it", () => {
    expect(at("2026-11-15T08:00:00Z", "America/Los_Angeles")).toBe("2026-11-15T08:00:00.000Z");
    expect(at("2026-11-15T07:59:59Z", "America/Los_Angeles")).toBe("2026-11-14T08:00:00.000Z");
  });

  it("follows a daylight-saving change: the day of the change is 25 hours long in Los Angeles", () => {
    // Clocks went back on 2026-11-01 at 02:00 PDT: midnight is still PDT (UTC-7), the next midnight is PST (UTC-8).
    expect(at("2026-11-01T20:00:00Z", "America/Los_Angeles")).toBe("2026-11-01T07:00:00.000Z");
    expect(at("2026-11-02T09:00:00Z", "America/Los_Angeles")).toBe("2026-11-02T08:00:00.000Z");
  });

  it("names the local date", () => {
    expect(localDate(new Date("2026-11-15T07:30:00Z"), "America/Los_Angeles")).toBe("2026-11-14");
    expect(localDate(new Date("2026-11-15T07:30:00Z"), "Pacific/Auckland")).toBe("2026-11-15");
  });
});

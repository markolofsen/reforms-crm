import { describe, expect, it } from "vitest";
import { NO_SHELL_PREFS, atLeast, breakpointOf, formatShellPrefs, parseShellPrefs } from "../src/lib/shell-prefs";

// P128 X8: the shell cookie the server lays the first paint out by. A value it cannot read is the old default (sidebar by
// width, terminal closed), never a broken page.
describe("shell cookie (P128 X8)", () => {
  it("round-trips every preference", () => {
    const p = { rail: "closed", dock: true, width: 520, bp: "xl" } as const;
    expect(formatShellPrefs(p)).toBe("rail-closed.dock-open.w-520.bp-xl");
    expect(parseShellPrefs(formatShellPrefs(p))).toEqual(p);
  });
  it("writes only what is set, and nothing is the defaults", () => {
    expect(formatShellPrefs(NO_SHELL_PREFS)).toBe("");
    expect(parseShellPrefs("")).toEqual(NO_SHELL_PREFS);
    expect(parseShellPrefs(undefined)).toEqual(NO_SHELL_PREFS);
    expect(formatShellPrefs({ ...NO_SHELL_PREFS, bp: "lg" })).toBe("bp-lg");
  });
  it("ignores what it cannot read", () => {
    expect(parseShellPrefs("rail-sideways.dock-maybe.w-abc.bp-toString.x-1")).toEqual(NO_SHELL_PREFS);
    expect(parseShellPrefs("w-0")).toEqual(NO_SHELL_PREFS);
    expect(parseShellPrefs("garbage;;")).toEqual(NO_SHELL_PREFS);
  });
  it("buckets a viewport by the shell's breakpoints", () => {
    expect([360, 639, 640, 1023, 1024, 1279, 1280, 1599, 1600, 2400].map(breakpointOf)).toEqual(["phone", "phone", "md", "md", "lg", "lg", "xl", "xl", "3xl", "3xl"]);
  });
  it("answers a media query on the server from the remembered breakpoint; unknown is false", () => {
    expect(atLeast("xl", "lg")).toBe(true);
    expect(atLeast("xl", "xl")).toBe(true);
    expect(atLeast("xl", "3xl")).toBe(false);
    expect(atLeast("md", "lg")).toBe(false);
    expect(atLeast(null, "md")).toBe(false);
  });
});

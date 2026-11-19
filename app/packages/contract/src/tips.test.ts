import { describe, expect, it } from "vitest";
import { sayFor, SAY } from "./help";
import { TIPS, tipDto, tipsFor, tipsVerifiedOn, versionNewer } from "./tips";

describe("tips (P63 O3)", () => {
  it("every row parses strictly, ids are unique per CLI, and every CLI row names the version it was checked on", () => {
    for (const t of TIPS) expect(tipDto.safeParse(t).success).toBe(true);
    const keys = TIPS.map((t) => `${t.cli}:${t.id}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of TIPS) expect(t.cli === "hub" ? t.verifiedOn === null : /^\d+\.\d+\.\d+$/.test(t.verifiedOn ?? "")).toBe(true);
  });

  it("a tab shows its CLI's rows and the Hub's; Shell only the Hub's", () => {
    expect(new Set(tipsFor("claude").map((t) => t.cli))).toEqual(new Set(["claude", "hub"]));
    expect(new Set(tipsFor("codex").map((t) => t.cli))).toEqual(new Set(["codex", "hub"]));
    expect(new Set(tipsFor("shell").map((t) => t.cli))).toEqual(new Set(["hub"]));
  });

  it("versions compare numerically, part by part", () => {
    expect(versionNewer("2.1.285", "2.1.220")).toBe(true);
    expect(versionNewer("2.1.220", "2.1.220")).toBe(false);
    expect(versionNewer("0.153.0", "0.99.9")).toBe(true);
    expect(versionNewer("2.1", "2.1.1")).toBe(false);
    expect(tipsVerifiedOn("claude")).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("help phrases: X is the project, <X> (a client) stays", () => {
    expect(sayFor("разбери почту проекта X", "alpha")).toBe("разбери почту проекта alpha");
    expect(sayFor("привяжи эту папку Drive к клиенту <X>", "alpha")).toBe("привяжи эту папку Drive к клиенту <X>");
    expect(SAY.length).toBeGreaterThan(10);
  });
});

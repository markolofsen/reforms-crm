import { describe, expect, it } from "vitest";
import { phrase, sayFor, SAY } from "./help";
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
    expect(sayFor("triage mail for X", "alpha")).toBe("triage mail for alpha");
    expect(sayFor("link this Drive folder to client <X>", "alpha")).toBe("link this Drive folder to client <X>");
    expect(SAY.length).toBeGreaterThan(10);
  });

  it("P81: every phrase is English, and phrase() is the first row of a skill, with or without the project", () => {
    for (const s of SAY) expect(s.example, s.skill).not.toMatch(/[\u0400-\u04FF]/);
    expect(SAY[0]?.example).toBe("triage mail for X");
    expect(phrase("project-setup", "alpha")).toBe("set up project alpha");
    expect(phrase("project-setup")).toBe("set up project");
    expect(phrase("mail-filters")).toBe("set up the mail filters");
    expect(phrase("knowledge-import")).toBe("load the knowledge");
    expect(phrase("triage-mail", "alpha")).toBe("triage mail for alpha");
    expect(phrase("sequence-drafts", "alpha")).toBe("prepare the follow-ups of alpha");
  });
});

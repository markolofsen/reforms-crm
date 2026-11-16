import { describe, expect, it } from "vitest";
import { checkValue, doctorProject, FIELDS, KINDS, loadProject, parseProjectMd, projectJson } from "../src/index.js";
import path from "node:path";

const ID = "00000000-0000-4000-8000-000000000001";
const ID2 = ID.replace(/1$/, "2");
const doc = (rows: string[], kind?: string) =>
  [
    "# T", "", "## Settings", "",
    "| Field | Value | Answered | By |", "|---|---|---|---|",
    "| schema | 1 | 2026-11-14 | agent |",
    "| status | active | 2026-11-14 | agent |",
    ...(kind ? [`| kind | ${kind} | 2026-11-14 | agent |`] : []),
    "| mail.accounts | a@t.example | 2026-11-14 | agent |",
    "| tone | brief | 2026-11-14 | agent |",
    ...rows.map((r) => `| ${r} | 2026-11-14 | owner |`),
    "", "## Notion databases", "", `- clients: ${ID}`, `- reports: ${ID2}`, "",
  ].join("\n");
const cfg = (rows: string[], kind?: string) => parseProjectMd(doc(rows, kind), "t");
const errors = (rows: string[], kind?: string) => cfg(rows, kind).issues.filter((i) => i.severity === "error");

describe("send settings (decision 0011)", () => {
  it("default to draft mode with the kind's cap and window", () => {
    expect(cfg([]).config.send).toEqual({ mode: "draft", classes: [], dailyCap: 5, delayMinutes: 10 });
    expect(errors([])).toEqual([]);
  });
  it("read the four rows", () => {
    expect(cfg(["send.mode | auto", "send.classes | client, partner", "send.daily_cap | 3", "send.delay_minutes | 20"]).config.send).toEqual({ mode: "auto", classes: ["client", "partner"], dailyCap: 3, delayMinutes: 20 });
  });
  it("refuse bad values", () => {
    expect(checkValue("send.mode", "always")).toMatch(/expected one of draft, auto/);
    expect(checkValue("send.daily_cap", "0")).toMatch(/positive integer/);
    expect(checkValue("send.delay_minutes", "0")).toMatch(/1 to 1440/);
    expect(checkValue("send.delay_minutes", "1441")).toMatch(/1 to 1440/);
    expect(checkValue("send.delay_minutes", "10")).toBeNull();
  });
  it("refuse a class the kind does not allow for autosend (security, spam, an unknown one)", () => {
    for (const bad of ["security", "spam", "marketing", "nonsense"]) {
      expect(errors(["send.mode | auto", `send.classes | ${bad}`]).map((i) => i.message).join(), bad).toMatch(/not a class a generic project may autosend/);
    }
  });
  it("auto without classes is an error in an active project and a warning in a draft one", () => {
    expect(errors(["send.mode | auto"]).map((i) => i.field)).toContain("send.classes");
    const draftProject = doc(["send.mode | auto"]).replace("| status | active |", "| status | draft |");
    const issues = parseProjectMd(draftProject, "t").issues.filter((i) => i.field === "send.classes");
    expect(issues.map((i) => i.severity)).toEqual(["warning"]);
  });
  it("every kind's autosend classes are classes of that kind, client-facing only, and every field has a doc row", () => {
    for (const k of Object.values(KINDS)) {
      const ids = k.mailClasses.map((c) => c.id);
      for (const c of k.send.classes) expect(ids, `${k.id}: ${c}`).toContain(c);
      for (const never of ["security", "spam", "marketing", "cold-outreach", "calendar", "service"]) expect(k.send.classes, k.id).not.toContain(never);
    }
    expect(Object.keys(FIELDS)).toEqual(expect.arrayContaining(["send.mode", "send.classes", "send.daily_cap", "send.delay_minutes"]));
    expect(KINDS["software-support"]?.send.classes).toContain("billing");
  });
  it("a kind's own classes are accepted", () => {
    expect(errors(["send.mode | auto", "send.classes | billing"], "software-support")).toEqual([]);
    expect(errors(["send.mode | auto", "send.classes | billing"], "shop").map((i) => i.message).join()).toMatch(/billing/);
  });
  it("PROJECT.json carries the send block", () => {
    const loaded = loadProject(path.resolve(import.meta.dirname, "fixtures/projects"), "acme-travel");
    expect((projectJson(loaded).config as { send: unknown }).send).toMatchObject({ mode: "draft" });
    expect(projectJson(loaded).send).toMatchObject({ mode: "draft", classes: [] });
  });
});

describe("doctor: send settings", () => {
  const run = async (rows: string[]) => {
    const p = { slug: "t", folder: "/x", file: "/x/project.md", parsed: parseProjectMd(doc(rows), "t") } as never;
    return (await doctorProject({ project: p, all: [p] })).find((c) => c.name === "send settings")!;
  };
  it("draft mode passes", async () => expect(await run([])).toMatchObject({ outcome: "pass" }));
  it("auto with a listed class passes and says what it will do", async () => {
    const c = await run(["send.mode | auto", "send.classes | client", "mail.sender | a@t.example", "mail.addresses | a@t.example"]);
    expect(c).toMatchObject({ outcome: "pass" });
    expect(c.detail).toMatch(/client; at most 5 per 24 h; 10 min to cancel/);
  });
  it("auto with no classes fails", async () => expect(await run(["send.mode | auto"])).toMatchObject({ outcome: "fail" }));
});

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applySetting, checkValue, doctorProject, FIELDS, KINDS, projectStore, migrateSendPolicy, parseProjectMd, policyFile, projectJson, readSendPolicy, setSendPolicy, writeSendPolicy, defaultPolicy, POLICY_FIELDS } from "../src/index";

const ID = "00000000-0000-4000-8000-000000000001";
const ID2 = ID.replace(/1$/, "2");
const doc = (rows: string[], kind?: string, extra: string[] = []) =>
  [
    "# T", "", "## Settings", "",
    "| Field | Value | Answered | By |", "|---|---|---|---|",
    "| schema | 1 | 2026-11-14 | agent |",
    "| status | active | 2026-11-14 | agent |",
    ...(kind ? [`| kind | ${kind} | 2026-11-14 | agent |`] : []),
    "| mail.accounts | a@t.example | 2026-11-14 | agent |",
    "| tone | brief | 2026-11-14 | agent |",
    ...extra,
    ...rows.map((r) => `| ${r} | 2026-11-14 | owner |`),
    "", "## Notion databases", "", `- clients: ${ID}`, `- reports: ${ID2}`, "",
  ].join("\n");
const cfg = (rows: string[], kind?: string) => parseProjectMd(doc(rows, kind), "t");
const errors = (rows: string[], kind?: string) => cfg(rows, kind).issues.filter((i) => i.severity === "error");

/** An instance-like folder: projects/t/project.md and the policy folder. */
function instance(rows: string[] = [], kind?: string) {
  const d = mkdtempSync(path.join(tmpdir(), "hub-policy-"));
  const projects = path.join(d, "projects");
  const policyDir = path.join(d, "state", "projects");
  mkdirSync(path.join(projects, "t"), { recursive: true });
  writeFileSync(path.join(projects, "t", "project.md"), doc(rows, kind));
  return { projects, policyDir, load: () => projectStore({ projects: projects, stateProjects: policyDir }).file("t") };
}

describe("send settings (decision 0011, P49 S11: a server-owned policy file)", () => {
  it("default to drafts only, the test list, the kind's cap and window", () => {
    expect(cfg([]).config.send).toEqual({ mode: "draft", classes: [], dailyCap: 5, delayMinutes: 10 });
    expect(cfg([]).config.draft.recipients).toBe("test");
    expect(errors([])).toEqual([]);
  });
  it("a send row in project.md is ignored and reported, never applied (an agent may edit project.md)", () => {
    const p = cfg(["send.mode | auto", "send.classes | client", "send.daily_cap | 50", "draft.recipients | any"]);
    expect(p.config.send).toEqual({ mode: "draft", classes: [], dailyCap: 5, delayMinutes: 10 });
    expect(p.config.draft.recipients).toBe("test");
    expect(Object.keys(p.policyRows).sort()).toEqual(["draft.recipients", "send.classes", "send.daily_cap", "send.mode"]);
    expect(p.issues.filter((i) => i.code === "send_policy_in_project_md").map((i) => i.severity)).toEqual(["warning", "warning", "warning", "warning"]);
    expect(errors(["send.mode | auto"])).toEqual([]);
  });
  it("the policy file is what a load with policyDir applies", () => {
    const i = instance();
    expect(i.load().policy).toMatchObject({ source: "default" });
    setSendPolicy(i.policyDir, "t", "generic", { "send.mode": "auto", "send.classes": "client, partner", "send.daily_cap": "3", "send.delay_minutes": "20", "draft.recipients": "a@x.example" }, "owner");
    const l = i.load();
    expect(l.parsed.config.send).toEqual({ mode: "auto", classes: ["client", "partner"], dailyCap: 3, delayMinutes: 20 });
    expect(l.parsed.config.draft.recipients).toEqual(["a@x.example"]);
    expect(l.policy).toMatchObject({ source: "file", policy: { by: "owner" } });
    // without policyDir: the safe defaults, never project.md
    expect(projectStore({ projects: i.projects }).config("t").send.mode).toBe("draft");
  });
  it("an unreadable policy file falls back to the defaults and says why", () => {
    const i = instance();
    mkdirSync(path.dirname(policyFile(i.policyDir, "t")), { recursive: true });
    writeFileSync(policyFile(i.policyDir, "t"), JSON.stringify({ schema: 1, mode: "auto", sneaky: true }));
    const st = readSendPolicy(i.policyDir, "t", "generic");
    expect(st).toMatchObject({ source: "default", policy: { mode: "draft", recipients: "test" } });
    expect(st.error).toBeTruthy();
  });
  it("refuse bad values and classes the kind does not allow (security, spam, an unknown one)", () => {
    expect(checkValue("send.mode", "always")).toMatch(/expected one of draft, auto/);
    expect(checkValue("send.daily_cap", "0")).toMatch(/positive integer/);
    expect(checkValue("send.delay_minutes", "1441")).toMatch(/1 to 1440/);
    const i = instance();
    expect(() => setSendPolicy(i.policyDir, "t", "generic", { "send.mode": "always" }, "owner")).toThrow(/send.mode/);
    for (const bad of ["security", "spam", "marketing", "nonsense"]) {
      expect(() => setSendPolicy(i.policyDir, "t", "generic", { "send.mode": "auto", "send.classes": bad }, "owner"), bad).toThrow(/not a class a generic project may autosend/);
    }
    expect(() => setSendPolicy(i.policyDir, "t", "generic", { "send.mode": "auto" }, "owner")).toThrow(/send.classes is empty/);
    expect(setSendPolicy(i.policyDir, "t", "software-support", { "send.mode": "auto", "send.classes": "billing" }, "owner").classes).toEqual(["billing"]);
  });
  it("`hub project set` refuses a policy field: only `hub send policy` writes it", () => {
    expect(() => applySetting(doc([]), "send.mode", "auto", "agent", "2026-11-18")).toThrow(/hub send policy set/);
    expect(() => applySetting(doc([]), "draft.recipients", "any", "owner", "2026-11-18")).toThrow(/send policy/);
  });
  it("every kind's autosend classes are classes of that kind, client-facing only, and every field has a doc row", () => {
    for (const k of Object.values(KINDS)) {
      const ids = k.mailClasses.map((c) => c.id);
      for (const c of k.send.classes) expect(ids, `${k.id}: ${c}`).toContain(c);
      for (const never of ["security", "spam", "marketing", "cold-outreach", "calendar", "service"]) expect(k.send.classes, k.id).not.toContain(never);
    }
    expect(Object.keys(FIELDS)).toEqual(expect.arrayContaining([...POLICY_FIELDS]));
  });
  it("PROJECT.json carries the send block", () => {
    const loaded = projectStore({ projects: path.resolve(import.meta.dirname, "fixtures/projects") }).file("acme-travel");
    expect((projectJson(loaded).config as { send: unknown }).send).toMatchObject({ mode: "draft" });
    expect(projectJson(loaded).send).toMatchObject({ mode: "draft", classes: [] });
  });
});

describe("hub send policy migrate", () => {
  it("moves the owner's rows into the file with their values, then removes them from project.md", () => {
    const i = instance(["draft.recipients | any", "send.daily_cap | 7"]);
    const dry = migrateSendPolicy(i.load(), i.policyDir, { apply: false });
    expect(dry).toMatchObject({ outcome: "moved", policy: { recipients: "any", dailyCap: 7 } });
    expect(i.load().policy?.source).toBe("default");
    expect(migrateSendPolicy(i.load(), i.policyDir, { apply: true })).toMatchObject({ outcome: "moved", removed: ["draft.recipients", "send.daily_cap"] });
    const l = i.load();
    expect(l.policy).toMatchObject({ source: "file", policy: { recipients: "any", dailyCap: 7, mode: "draft", by: "migrate" } });
    expect(Object.keys(l.parsed.policyRows)).toEqual([]);
    expect(readFileSync(l.file, "utf8")).not.toMatch(/draft\.recipients \||send\.daily_cap/);
    expect(readFileSync(l.file, "utf8")).toContain("| tone | brief |");
    expect(migrateSendPolicy(l, i.policyDir, { apply: true }).outcome).toBe("none");
  });
  it("a policy file that exists wins: rows that reappear are removed, not applied", () => {
    const i = instance();
    writeSendPolicy(i.policyDir, "t", { ...defaultPolicy("generic"), updatedAt: "2026-11-18T00:00:00Z", by: "owner" });
    writeFileSync(i.load().file, doc(["send.mode | auto", "send.classes | client"]));
    expect(migrateSendPolicy(i.load(), i.policyDir, { apply: true })).toMatchObject({ outcome: "kept", policy: { mode: "draft" } });
    expect(i.load().parsed.config.send.mode).toBe("draft");
    expect(Object.keys(i.load().parsed.policyRows)).toEqual([]);
  });
  it("no rows and no file: the defaults are written", () => {
    const i = instance();
    expect(migrateSendPolicy(i.load(), i.policyDir, { apply: true }).outcome).toBe("created");
    expect(i.load().policy).toMatchObject({ source: "file", policy: { mode: "draft", recipients: "test" } });
  });
});

describe("doctor: send policy and send settings", () => {
  const run = async (i: ReturnType<typeof instance>, name: string) => (await doctorProject({ project: i.load(), all: [i.load()] })).find((c) => c.name === name)!;
  it("a send row left in project.md fails, naming the fix", async () => {
    const c = await run(instance(["send.mode | auto"]), "send policy");
    expect(c).toMatchObject({ outcome: "fail" });
    expect(c.detail).toMatch(/hub send policy migrate t/);
  });
  it("no file passes with the defaults; a file passes and says who set it", async () => {
    const i = instance();
    expect(await run(i, "send policy")).toMatchObject({ outcome: "pass" });
    setSendPolicy(i.policyDir, "t", "generic", { "draft.recipients": "any" }, "owner");
    expect((await run(i, "send policy")).detail).toMatch(/set by owner/);
  });
  it("draft mode passes; auto with a listed class passes and says what it will do", async () => {
    const i = instance();
    expect(await run(i, "send settings")).toMatchObject({ outcome: "pass" });
    writeFileSync(i.load().file, doc([], undefined, ["| mail.sender | a@t.example | 2026-11-14 | owner |", "| mail.addresses | a@t.example | 2026-11-14 | owner |"]));
    setSendPolicy(i.policyDir, "t", "generic", { "send.mode": "auto", "send.classes": "client" }, "owner");
    const c = await run(i, "send settings");
    expect(c).toMatchObject({ outcome: "pass" });
    expect(c.detail).toMatch(/client; at most 5 per 24 h; 10 min to cancel/);
  });
});

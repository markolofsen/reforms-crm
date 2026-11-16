import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { auditRun, evidenceTable } from "../../src/audit-run.ts";
import { defaultRoot } from "../../src/context.ts";
import { FIXTURE_PROJECT } from "./fixture.ts";

// Tier 2 (research 15 section 5): five fixed transcripts through `audit-run`; expected rows and exit codes. Offline.
const PROJECTS = path.join(import.meta.dirname, "fixture", "projects");
const T = path.join(import.meta.dirname, "fixtures", "transcripts");
const rows = (name: string) => auditRun(path.join(T, name), FIXTURE_PROJECT, PROJECTS).evidence;
const folder = () => {
  const d = mkdtempSync(path.join(tmpdir(), "pc-sess-"));
  mkdirSync(path.join(d, "subagents"));
  cpSync(path.join(T, "bad-subagent-brief.main.jsonl"), path.join(d, "main.jsonl"));
  cpSync(path.join(T, "bad-subagent-brief.sub-a1.jsonl"), path.join(d, "subagents", "a1.jsonl"));
  cpSync(path.join(T, "bad-subagent-brief.sub-a2.jsonl"), path.join(d, "subagents", "a2.jsonl"));
  return d;
};

describe("audit-run evidence replay (B4, E2)", () => {
  it("good-3: three careful replies are green, every row read 3/3 with profile, facts and anchors", () => {
    const r = rows("good-3.jsonl");
    expect(r.map((x) => x.verdict)).toEqual(["ok", "ok", "ok"]);
    expect(r.map((x) => `${x.read}/${x.profile}/${x.facts}/${x.anchors}`)).toEqual(["3/3/read/1/1", "3/3/read/1/1", "3/3/read/1/1"]);
    expect(r.every((x) => x.maxSim < 0.5)).toBe(true);
  });
  it("bad-no-reads: replies written after one search and one read are all red", () => {
    const r = rows("bad-no-reads.jsonl");
    expect(r).toHaveLength(3);
    expect(r.every((x) => x.verdict === "red")).toBe(true);
    expect(r[1]!.notes.join()).toContain("message answered was never opened");
    expect(r.every((x) => x.profile === "no" && x.facts === 0)).toBe(true);
  });
  it("bad-template-loop: every read is there, the bodies are one template: red by similarity", () => {
    const r = rows("bad-template-loop.jsonl");
    expect(r).toHaveLength(4);
    expect(r.slice(1).every((x) => x.verdict === "red" && x.maxSim >= 0.8)).toBe(true);
    expect(r[1]!.notes.join()).toContain("near-duplicate");
  });
  it("bad-claim-exceeds: three read claimed, one observed: red", () => {
    const r = rows("bad-claim-exceeds.jsonl");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ verdict: "red", read: "1/3" });
    expect(r[0]!.notes.join()).toContain("claims 3 read, observed 1");
  });
  it("bad-subagent-brief: a session folder reads subagents/*.jsonl; the careful one is green, the one without the procedure red", () => {
    const r = auditRun(folder(), FIXTURE_PROJECT, PROJECTS).evidence;
    expect(r.map((x) => x.verdict)).toEqual(["ok", "red"]);
  });
  it("prints a table", () => {
    const t = evidenceTable(rows("good-3.jsonl")).join("\n");
    expect(t).toContain("max sim");
    expect(t).toContain("OK");
  });
  it("`hub audit-run` exits 1 on a red row and 0 on a green one", async () => {
    const bin = path.join(defaultRoot(), "app", "apps", "installer", "bin", "hub.mjs");
    const env = { ...process.env, HUB_PROJECTS: PROJECTS, NO_COLOR: "1" };
    const bad = await execa("node", [bin, "audit-run", path.join(T, "bad-no-reads.jsonl"), "--project", FIXTURE_PROJECT], { reject: false, env, timeout: 60_000 });
    expect(bad.exitCode, bad.stderr).toBe(1);
    expect(bad.stdout).toContain("RED");
    const good = await execa("node", [bin, "audit-run", path.join(T, "good-3.jsonl"), "--project", FIXTURE_PROJECT], { reject: false, env, timeout: 60_000 });
    expect(good.exitCode, good.stderr + good.stdout).toBe(0);
  });
});

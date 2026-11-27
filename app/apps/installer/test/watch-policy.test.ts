import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readWatchPolicy, watchPolicyFile, type WatchPolicy } from "@hub/watch/policy";
import { setWatchPolicy } from "../src/commands/watch-policy";

let dir: string;
let paths: { stateProjects: string; projects: string };
const STRATEGY = "# Acme response strategy\nAnswer the technical question; disclose affiliation when relevant.\n";
const hash = createHash("sha256").update(STRATEGY).digest("hex");
const candidate = (revision = 1): WatchPolicy => ({ version: 1, revision, enabled: true, account: "123456",
  approval: { requestRef: "owner-session:explicit-scoped-request", approvedAt: "2026-11-27T10:00:00.000Z" },
  directions: { support: { groups: ["acme_chat"], join: true, reply: true, strategy: { path: "strategy.md", sha256: hash } } },
  limits: { joinsPerDay: 3, repliesPerDay: 3 } });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hub-watch-policy-"));
  paths = { stateProjects: join(dir, "state", "projects"), projects: join(dir, "projects") };
  mkdirSync(join(paths.projects, "acme"), { recursive: true });
  writeFileSync(join(paths.projects, "acme", "project.md"), "# Acme\n");
  writeFileSync(join(paths.projects, "acme", "strategy.md"), STRATEGY);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("supported protected Watch policy writer", () => {
  it("writes only the protected path with monotonic revision and reviewable intent/applied audit", () => {
    const result = setWatchPolicy(paths, "acme", candidate(), {});
    expect(result).toMatchObject({ ok: true, revision: 1, enabled: true });
    const file = watchPolicyFile(paths.stateProjects, "acme");
    expect(readWatchPolicy(join(paths.projects, "acme"), file)).toMatchObject({ state: "ok", generation: result.generation });
    expect(existsSync(join(paths.projects, "acme", "watch-policy.json"))).toBe(false);
    const audit = readFileSync(join(paths.stateProjects, "acme", "watch-policy.audit.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(audit).toEqual([expect.objectContaining({ phase: "prepared", generation: result.generation }), expect.objectContaining({ phase: "applied", generation: result.generation })]);
    expect(() => setWatchPolicy(paths, "acme", candidate(), {})).toThrow(/revision 2/);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ revision: 1 });
  });

  it("enforces the real session boundary without clearing environment flags or writing a grant", () => {
    for (const env of [{ CLAUDECODE: "1" }, { HUB_PROJECT: "acme" }]) expect(() => setWatchPolicy(paths, "acme", candidate(), env)).toThrow(/owner CLI/);
    expect(existsSync(watchPolicyFile(paths.stateProjects, "acme"))).toBe(false);
  });

  it("refuses a changed strategy, and permits revocation even after strategy drift", () => {
    setWatchPolicy(paths, "acme", candidate(), {});
    writeFileSync(join(paths.projects, "acme", "strategy.md"), "Changed after approval.");
    expect(() => setWatchPolicy(paths, "acme", candidate(2), {})).toThrow(/Strategy changed/);
    expect(JSON.parse(readFileSync(watchPolicyFile(paths.stateProjects, "acme"), "utf8"))).toMatchObject({ revision: 1 });
    expect(setWatchPolicy(paths, "acme", { ...candidate(2), enabled: false }, {})).toMatchObject({ revision: 2, enabled: false });
    expect(readWatchPolicy(join(paths.projects, "acme"), watchPolicyFile(paths.stateProjects, "acme"))).toMatchObject({ state: "ok", policy: { enabled: false } });
  });
});

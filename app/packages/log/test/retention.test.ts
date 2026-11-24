import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureOps, readOps, resetOps } from "../src/ops";
import { readEvents } from "../src/store";
import { LOG_KEEP_DAYS, retainLogs } from "../src/retention";

// P137 L4: one retention rule for the ops log and the session log: plain for 2 days, gzipped until 30, then deleted.

afterEach(() => resetOps());

const NOW = new Date("2026-11-24T12:00:00Z");
const opsLine = (day: string) => JSON.stringify({ time: `${day}T10:00:00.000Z`, level: "error", source: "mail", message: `on ${day}` }) + "\n";
const event = (day: string) => JSON.stringify({ v: 1, ts: `${day}T10:00:00.000Z`, project: "demo", session: "s1", cli: "claude", kind: "prompt", data: {} }) + "\n";

function instance(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "hub-retention-"));
  for (const d of ["2026-11-24", "2026-11-23", "2026-11-21", "2026-10-26", "2026-10-20"]) writeFileSync(path.join(dir, `ops-${d}.jsonl`), opsLine(d), { mode: 0o600 });
  writeFileSync(path.join(dir, "2026-10-01.jsonl"), "not a day file of either log\n");
  mkdirSync(path.join(dir, "demo"));
  for (const d of ["2026-11-24", "2026-11-20", "2026-10-01"]) writeFileSync(path.join(dir, "demo", `${d}.jsonl`), event(d), { mode: 0o600 });
  return dir;
}

describe("log retention (P137 L4)", () => {
  it("keeps two days plain, gzips the rest, deletes past 30 days; one line says so", () => {
    const dir = instance();
    const cap = captureOps();
    const r = retainLogs(dir, { now: NOW });
    cap.stop();
    expect(LOG_KEEP_DAYS).toBe(30);
    expect(readdirSync(dir).filter((f) => f.startsWith("ops-")).sort()).toEqual(["ops-2026-10-26.jsonl.gz", "ops-2026-11-21.jsonl.gz", "ops-2026-11-23.jsonl", "ops-2026-11-24.jsonl"]);
    expect(existsSync(path.join(dir, "2026-10-01.jsonl"))).toBe(true);
    expect(readdirSync(path.join(dir, "demo")).sort()).toEqual(["2026-11-20.jsonl.gz", "2026-11-24.jsonl"]);
    expect(statSync(path.join(dir, "ops-2026-11-21.jsonl.gz")).mode & 0o777).toBe(0o600);
    expect(r).toEqual({ gzipped: 3, deleted: 2 });
    expect(cap.lines.map((l) => l.message)).toEqual(["logs: retention gzipped and deleted old day files"]);
  });

  it("the readers read a gzipped day as a plain one", () => {
    const dir = instance();
    retainLogs(dir, { now: NOW });
    expect(readOps({ dir }, { since: "2026-10-01T00:00:00Z" }).map((l) => l.message)).toEqual(["on 2026-10-26", "on 2026-11-21", "on 2026-11-23", "on 2026-11-24"]);
    expect(readEvents({ dir, secrets: dir, retentionDays: 30 }, { project: "demo" }).map((e) => e.ts.slice(0, 10))).toEqual(["2026-11-20", "2026-11-24"]);
  });

  it("a second run changes nothing and writes no line", () => {
    const dir = instance();
    retainLogs(dir, { now: NOW });
    const cap = captureOps();
    expect(retainLogs(dir, { now: NOW })).toEqual({ gzipped: 0, deleted: 0 });
    cap.stop();
    expect(cap.lines).toEqual([]);
  });
});

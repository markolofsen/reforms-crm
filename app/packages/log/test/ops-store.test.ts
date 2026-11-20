import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendOps, configureOps, humanLine, ops, opsFileOf, readOps, resetOps, type OpsLine, type OpsStore } from "../src/ops";

// P86: where the ops log lives, how it rotates and how it is read.

afterEach(() => resetOps());

const storeAt = (o: Partial<OpsStore> = {}): OpsStore => ({ dir: mkdtempSync(path.join(tmpdir(), "ops-log-")), secrets: path.join(tmpdir(), "no-secrets-here"), keepDays: 7, softCap: 20 * 1024 * 1024, hardCap: 25 * 1024 * 1024, ...o });
const line = (time: string, level: OpsLine["level"], source: OpsLine["source"], message: string): OpsLine => ({ time, level, source, message });

describe("ops store", () => {
  it("writes one JSON line per event to ops-<UTC day>.jsonl, file 600, beside the agent log's folders", () => {
    const s = storeAt();
    expect(appendOps(s, line("2026-11-20T18:07:00.000Z", "error", "whatsapp", "socket closed"), new Date("2026-11-20T18:07:00Z"))).toBe(true);
    const file = opsFileOf(s, "2026-11-20");
    expect(path.basename(file)).toBe("ops-2026-11-20.jsonl");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8").trim())).toEqual({ time: "2026-11-20T18:07:00.000Z", level: "error", source: "whatsapp", message: "socket closed" });
  });

  it("the first write of a day deletes the files older than 7 days", () => {
    const s = storeAt();
    writeFileSync(path.join(s.dir, "ops-2026-11-10.jsonl"), "");
    writeFileSync(path.join(s.dir, "ops-2026-11-14.jsonl"), "");
    writeFileSync(path.join(s.dir, "2026-11-01.jsonl"), ""); // not ours
    appendOps(s, line("2026-11-20T00:00:01.000Z", "info", "server", "start"), new Date("2026-11-20T00:00:01Z"));
    expect(readdirSync(s.dir).sort()).toEqual(["2026-11-01.jsonl", "ops-2026-11-14.jsonl", "ops-2026-11-20.jsonl"]);
  });

  it("past the soft cap only errors are kept (after one warn saying so); past the hard cap nothing", () => {
    const s = storeAt({ softCap: 300, hardCap: 600 });
    const t = "2026-11-21T10:00:00.000Z";
    for (let i = 0; i < 4; i++) appendOps(s, line(t, "info", "server", `filler line number ${i} with some words`));
    appendOps(s, line(t, "info", "server", "dropped info"));
    appendOps(s, line(t, "error", "send", "kept error"));
    for (let i = 0; i < 10; i++) appendOps(s, line(t, "error", "send", `error ${i} that fills the file up to its hard cap`));
    const text = readFileSync(opsFileOf(s, "2026-11-21"), "utf8");
    expect(text).not.toContain("dropped info");
    expect(text).toContain("only error lines are kept");
    expect(text).toContain("kept error");
    expect(statSync(opsFileOf(s, "2026-11-21")).size).toBeLessThan(600 + 200);
  });

  it("reads with a lowest level, sources and a since, oldest first, the newest n", () => {
    const s = storeAt();
    const at = new Date("2026-11-20T12:00:00Z");
    appendOps(s, line("2026-11-19T10:00:00.000Z", "error", "mail", "old"), at);
    appendOps(s, line("2026-11-20T10:00:00.000Z", "warn", "whatsapp", "a"), at);
    appendOps(s, line("2026-11-20T11:00:00.000Z", "info", "server", "b"), at);
    appendOps(s, line("2026-11-20T12:00:00.000Z", "error", "whatsapp", "c"), at);
    writeFileSync(opsFileOf(s, "2026-11-20"), readFileSync(opsFileOf(s, "2026-11-20"), "utf8") + "torn {\n" + JSON.stringify({ level: "nope" }) + "\n");
    expect(readOps(s, { since: "2026-11-20T00:00:00.000Z" }).map((l) => l.message)).toEqual(["a", "b", "c"]);
    expect(readOps(s, { level: "warn" }).map((l) => l.message)).toEqual(["old", "a", "c"]);
    expect(readOps(s, { sources: ["whatsapp"], limit: 1 }).map((l) => l.message)).toEqual(["c"]);
  });

  it("the logger writes to its store and a human copy to stderr; with no file it never throws", () => {
    const s = storeAt();
    const lines: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => (lines.push(String(chunk)), true)) as typeof process.stderr.write;
    try {
      configureOps({ store: s, stderr: true, now: () => new Date("2026-11-20T18:07:12Z") });
      ops("whatsapp").error("socket closed", { status: 401 });
      ops("server").debug("not kept");
    } finally {
      process.stderr.write = orig;
    }
    expect(readOps(s).map((l) => [l.level, l.source, l.message, l.fields])).toEqual([["error", "whatsapp", "socket closed", { status: 401 }]]);
    expect(lines.join("")).toMatch(/^\d\d:\d\d:12 error whatsapp: socket closed status=401\n$/);
    configureOps({ store: { ...s, dir: "/nonexistent/forbidden/dir" }, stderr: false });
    expect(() => ops("server").error("nowhere to write")).not.toThrow();
    expect(existsSync("/nonexistent/forbidden/dir")).toBe(false);
  });

  it("the human line drops the stack and quotes a value with spaces", () => {
    expect(humanLine({ time: "2026-11-20T18:07:12.000Z", level: "warn", source: "mail", message: "m", fields: { reason: "a b", stack: "x" } })).toMatch(/ warn mail: m reason="a b"$/);
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { readCoreUpdateCache, type CommandRun, type CoreUpdate } from "@hub/config/core-version";
import { hubPaths, type HubPaths } from "@hub/config/paths";
import { coreUpdateDto, type CoreUpdateDto } from "@hub/contract/instance";
import type { Repos } from "@hub/db";
import { testApp } from "../test-support/runtime";
import { createCoreUpdates, offlineRun } from "./core-updates";

// `/api/instance/core` (P68): GET reads the cache and never runs git; POST checks once, and again only after a minute.

const API = "http://127.0.0.1:4381";
const HOST = { host: "127.0.0.1:4381" };
const repos = {} as unknown as Repos;
const PIN = "6b42f24aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

let base: string;
let paths: HubPaths;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "hub-core-route-"));
  mkdirSync(join(base, "saas"));
  writeFileSync(join(base, "saas", "core.version"), `# tag: v0.12.11\n${PIN}\n`);
  paths = hubPaths({ home: join(base, "saas"), core: join(base, "core"), env: {} });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

/** A git that answers like a core one patch behind its origin. */
const git = (online = true): CommandRun =>
  vi.fn<CommandRun>(async (_cmd, args) => {
    const a = args.slice(2);
    const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
    switch (a[0]) {
      case "rev-parse":
        return ok(a.some((x) => x.startsWith("v0.12.12")) ? "fff\n" : `${PIN}\n`);
      case "describe":
        return ok("v0.12.11\n");
      case "ls-remote":
        return online ? ok(`${PIN}\trefs/tags/v0.12.11\nfff\trefs/tags/v0.12.12\n`) : { code: 128, stdout: "", stderr: "fatal: Could not resolve host: github.com" };
      case "tag":
        return ok(a[1] === "--points-at" ? "v0.12.11\n" : "v0.12.11\nv0.12.12\n");
      case "for-each-ref":
        return ok("v0.12.11\t2026-11-01T10:00:00+00:00\tcore: v0.12.11\nv0.12.12\t2026-11-03T10:00:00+00:00\tcore: v0.12.12 (P64)\n");
      case "diff":
        return a.includes("--quiet") ? { code: 0, stdout: "", stderr: "" } : ok("");
      default:
        return ok();
    }
  });

function setup(run: CommandRun, clock = { t: Date.parse("2026-11-19T12:00:00Z") }) {
  const lines: string[] = [];
  const service = createCoreUpdates({ paths, run, auto: false, now: () => new Date(clock.t), log: (l) => lines.push(l) });
  const app = testApp(repos, { coreUpdates: service });
  const get = async () => app.request(`${API}/api/instance/core`, { headers: HOST });
  const post = async () => app.request(`${API}/api/instance/core/check`, { method: "POST", headers: HOST });
  return { service, get, post, lines, clock };
}

describe("the wire form", () => {
  it("is the judge's answer of @hub/config/core-version, field for field (tsc checks it; the contract has no Node types)", () => {
    expectTypeOf<CoreUpdate>().toEqualTypeOf<CoreUpdateDto>();
  });
});

describe("GET /api/instance/core", () => {
  it("answers 'not checked yet' with no cache and never calls git", async () => {
    const run = git();
    const s = setup(run);
    const r = await s.get();
    expect(r.status).toBe(200);
    expect(coreUpdateDto.parse(await r.json())).toMatchObject({ pin: "v0.12.11", level: "unknown", reason: "not checked yet" });
    expect(run).not.toHaveBeenCalled();
  });
  it("reads the cache a check wrote, still with no git call of its own", async () => {
    const run = git();
    const s = setup(run);
    await s.post();
    const calls = vi.mocked(run).mock.calls.length;
    const body = coreUpdateDto.parse(await (await s.get()).json());
    expect(body).toMatchObject({ level: "available", newest: "v0.12.12", command: [`cd ${paths.home} && ./run.sh core update v0.12.12 --apply`, 'git add core core.version && git commit -m "core: v0.12.12"', "./run.sh restart"] });
    expect(vi.mocked(run).mock.calls.length).toBe(calls);
    expect(readCoreUpdateCache(paths.coreUpdate)).toEqual(body);
  });
  it("a cache that the strict wire form refuses reads as not checked", async () => {
    mkdirSync(paths.state, { recursive: true });
    writeFileSync(paths.coreUpdate, JSON.stringify({ pin: "v0.12.11", inUse: null, level: "current", reason: "x", tags: [{ name: "backup-1", date: null, subject: "" }], facts: {}, command: [] }));
    expect(coreUpdateDto.parse(await (await setup(git()).get()).json()).level).toBe("unknown");
  });
});

describe("POST /api/instance/core/check", () => {
  it("is 429 within a minute of the last check, and runs again after it", async () => {
    const s = setup(git());
    expect((await s.post()).status).toBe(200);
    const again = await s.post();
    expect(again.status).toBe(429);
    expect(again.headers.get("retry-after")).toBe("60");
    expect(await again.json()).toMatchObject({ code: "wrong_state" });
    s.clock.t += 61_000;
    expect((await s.post()).status).toBe(200);
  });
  it("offline: keeps the last good answer, adds the reason, logs one line", async () => {
    const s = setup(git());
    await s.post();
    const off = setup(git(false), { t: Date.parse("2026-11-19T15:00:00Z") });
    const body = coreUpdateDto.parse(await (await off.post()).json());
    expect(body).toMatchObject({ level: "available", checkedAt: "2026-11-19T12:00:00.000Z", error: { at: "2026-11-19T15:00:00.000Z", message: "origin unreachable: fatal: Could not resolve host: github.com" } });
    expect(off.lines).toEqual(["core update check: origin unreachable: fatal: Could not resolve host: github.com"]);
  });
  it("the test server's runner refuses only the calls that reach the origin", async () => {
    const inner = git();
    const run = offlineRun(inner);
    expect((await run("git", ["-C", "/c", "ls-remote", "--refs", "origin"])).code).toBe(1);
    expect((await run("git", ["-C", "/c", "fetch", "--tags", "origin"])).code).toBe(1);
    expect((await run("git", ["-C", "/c", "rev-parse", "HEAD"])).code).toBe(0);
    expect(inner).toHaveBeenCalledTimes(1);
  });
  it("without the service both routes are 404", async () => {
    const app = testApp(repos, {});
    expect((await app.request(`${API}/api/instance/core`, { headers: HOST })).status).toBe(404);
    expect((await app.request(`${API}/api/instance/core/check`, { method: "POST", headers: HOST })).status).toBe(404);
  });
});

describe("the timer and the live signature", () => {
  it("does nothing until started, first runs after 2 minutes, then every 6 hours; the signature moves on each check", async () => {
    vi.useFakeTimers();
    try {
      const run = git();
      const service = createCoreUpdates({ paths, run, auto: true, log: () => {} });
      const sig = service.signature();
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      expect(run).not.toHaveBeenCalled();
      service.start();
      await vi.advanceTimersByTimeAsync(119_000);
      expect(run).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(service.signature()).not.toBe(sig);
      const first = vi.mocked(run).mock.calls.filter((c) => c[1].includes("ls-remote")).length;
      expect(first).toBe(1);
      await vi.advanceTimersByTimeAsync(6 * 60 * 60_000);
      expect(vi.mocked(run).mock.calls.filter((c) => c[1].includes("ls-remote")).length).toBe(2);
      service.stop();
      await vi.advanceTimersByTimeAsync(6 * 60 * 60_000);
      expect(vi.mocked(run).mock.calls.filter((c) => c[1].includes("ls-remote")).length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it("auto off (the fake Mailer): start() starts nothing", async () => {
    vi.useFakeTimers();
    try {
      const run = git();
      const service = createCoreUpdates({ paths, run, auto: false, log: () => {} });
      service.start();
      await vi.advanceTimersByTimeAsync(7 * 60 * 60_000);
      expect(run).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

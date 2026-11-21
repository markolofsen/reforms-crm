import { spawn } from "node:child_process";
import { execa } from "execa";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRepos, openDb } from "@hub/db";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultRoot } from "../src/context";
import { anyRecipients } from "./instance-fixture";
import { recordDraft } from "../src/record-draft";

let db: string;
beforeEach(() => {
  db = path.join(mkdtempSync(path.join(tmpdir(), "hub-rec-")), "app.db");
});

const payload = (over: Record<string, unknown> = {}) => JSON.stringify({ email: "Client@Example.com", name: "Cli Ent", subject: "Re: hello", mailRef: "<m1@example.com>", ...over });
const run = (over: Record<string, unknown> = {}, o: { project?: string; raw?: string; attempts?: number } = {}) =>
  recordDraft({ project: o.project ?? "acme", payload: o.raw ?? payload(over), dbPath: db, attempts: o.attempts ?? 1, retryMs: 5 });
const rowsOf = () => {
  const h = openDb(db);
  const out = createRepos(h.db).clients.list("acme");
  return out.finally(() => h.close());
};

describe("hub record-draft", () => {
  it("writes one client and one draft and prints one ok line", async () => {
    const r = await run({ reason: "They asked.", lastContactAt: "2026-11-10", repliesOwed: true, marks: ["follow_up"] });
    expect(r.code).toBe(0);
    expect(r.line.includes("\n")).toBe(false);
    expect(JSON.parse(r.line)).toMatchObject({ ok: true, action: "created" });
    const rows = await rowsOf();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "client@example.com", name: "Cli Ent", repliesOwed: true, lastContactAt: "2026-11-10T00:00:00.000Z", marks: ["follow_up"] });
    expect(rows[0]?.draft).toMatchObject({ status: "ready", subject: "Re: hello", reason: "They asked.", batchId: null });
  });

  it("the same mailRef twice leaves one row", async () => {
    await run();
    const again = await run({ subject: "Re: hello (edited)" });
    expect(JSON.parse(again.line)).toMatchObject({ ok: true, action: "updated" });
    const rows = await rowsOf();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.draft?.subject).toBe("Re: hello (edited)");
  });

  it("P99 S0 (b): the same mailRef on a finished draft says plainly that nothing was recorded", async () => {
    const first = JSON.parse((await run()).line) as { draftId: number; recorded: boolean };
    expect(first.recorded).toBe(true);
    const h = openDb(db);
    await createRepos(h.db).drafts.setStatus(first.draftId, "done");
    h.close();
    const again = await run({ excerpt: "A poem." });
    expect(again.code).toBe(0);
    expect(again.line.startsWith('{"ok":true,"recorded":false,"message":"Not recorded:')).toBe(true);
    expect(JSON.parse(again.line)).toMatchObject({ recorded: false, action: "unchanged", draftId: first.draftId });
    expect(JSON.parse(again.line).message).toMatch(/is done .*nothing was recorded.*ownerRequest/);
  });

  it("refuses a bad payload with code 2 and writes nothing", async () => {
    for (const bad of [{ subject: "" }, { email: "nope" }, { mailRef: "x".repeat(501) }, { subject: "s".repeat(301) }, { reason: "r".repeat(1501) }, { marks: ["boss"] }, { status: "sent" }, { lastContactAt: "yesterday" }]) {
      const r = await run(bad);
      expect(r.code, JSON.stringify(bad)).toBe(2);
      expect(JSON.parse(r.line)).toMatchObject({ ok: false });
    }
    expect((await run({}, { raw: "{not json" })).code).toBe(2);
    expect((await run({}, { project: "Bad Slug!" })).code).toBe(2);
    expect(await rowsOf()).toEqual([]);
  });

  it("reports a busy database after the attempts, and works once the lock is released", async () => {
    openDb(db).close(); // migrate first, so the lock below is the only thing in the way
    // The lock must come from another process: connections inside one process share the lock state and never block each other.
    const blocker = spawn("node", ["-e", `const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(${JSON.stringify(db)});d.exec("pragma busy_timeout=0; begin immediate");console.log("locked");setTimeout(()=>{},60000)`], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise((r) => blocker.stdout.once("data", r));
    const t0 = Date.now();
    const busy = await recordDraft({ project: "acme", payload: payload(), dbPath: db, attempts: 2, retryMs: 5 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(5000); // the 5 s busy timeout of openDb, at least once
    expect(busy.code).toBe(1);
    expect(JSON.parse(busy.line)).toMatchObject({ ok: false, code: "busy" });
    blocker.kill();
    await new Promise((r) => blocker.once("exit", r));
    expect((await run()).code).toBe(0);
  }, 30_000);

  it("is a real `hub` command that reads stdin and honours HUB_DB", async () => {
    const bin = path.join(defaultRoot(), "app", "apps", "installer", "bin", "hub.mjs");
    // the CLI now loads the project (draft.recipients): a copy of the fixture with recipients = any
    const projects = mkdtempSync(path.join(tmpdir(), "hub-rec-proj-"));
    cpSync(path.join(defaultRoot(), "app", "packages", "projects", "test", "fixtures", "projects", "acme-travel"), path.join(projects, "acme"), { recursive: true });
    const hubHome = mkdtempSync(path.join(tmpdir(), "hub-rec-home-"));
    anyRecipients(path.join(hubHome, "state", "projects"), "acme"); // the CLI reads the instance's send policy (P49 S11)
    const r = await execa("node", [bin, "record-draft", "--project", "acme"], { input: payload(), reject: false, env: { ...process.env, HUB_HOME: hubHome, HUB_DB: db, HUB_PROJECTS: projects, HUB_LEDGER_ROOT: mkdtempSync(path.join(tmpdir(), "hub-led-")), NO_COLOR: "1" }, timeout: 60_000 });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true });
    const bad = await execa("node", [bin, "record-draft", "--project", "acme"], { input: "{}", reject: false, env: { ...process.env, HUB_HOME: mkdtempSync(path.join(tmpdir(), "hub-rec-home-")), HUB_DB: db, HUB_PROJECTS: projects, HUB_LEDGER_ROOT: mkdtempSync(path.join(tmpdir(), "hub-led-")) }, timeout: 60_000 });
    expect(bad.exitCode).toBe(2);
  });
});

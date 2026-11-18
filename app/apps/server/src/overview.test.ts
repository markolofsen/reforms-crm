import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { overviewDto, type OverviewDto } from "@hub/contract/overview";
import type { SenderOptions } from "./routes/sends";
import { createApp } from "./app";

// GET /api/overview (contract v5): one row per project from local facts. No Mail, no Notion, no network.
const T0 = new Date("2026-11-15T12:00:00Z");
const BASE = "http://127.0.0.1:4317";
let handle: DbHandle;
let repos: Repos;
let now = T0;
let root: string;

const settings = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ schema: 1, slug: "x", kind: "generic", name: "x", mail: { accounts: ["Google"], addresses: ["me@example.test"] }, draft: { recipients: ["a@example.com"] }, context: { required: "warn" }, ...over });
const register = (...p: { slug: string; status?: string; archived?: boolean; settingsJson?: string }[]) =>
  repos.projects.replaceRegistry({ projects: p.map((x) => ({ slug: x.slug, name: x.slug.toUpperCase(), status: x.status ?? "active", archived: x.archived ?? false, settingsJson: x.settingsJson ?? settings(), hash: "h" })), addresses: [] });
const triaged = (project: string, action: "skipped" | "escalated" = "skipped") => repos.inbox.record({ project, email: "seen@example.com", name: "Seen", action }, now);

beforeEach(() => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  now = T0;
  root = mkdtempSync(join(tmpdir(), "hub-ov-projects-"));
});
afterEach(() => handle.close());

const app = (o: { fake?: boolean } = {}) =>
  createApp(repos, { now: () => now, overview: { projectsDir: root, timeZone: "UTC" }, ...(o.fake ? { sender: { kind: "fake", projectsDir: root, allowList: [], mailer: {} as SenderOptions["mailer"] } } : {}) });
const get = async (a = app()) => {
  const r = await a.request(`${BASE}/api/overview`);
  return { status: r.status, text: await r.clone().text(), body: overviewDto.parse(await r.json()) };
};
const rowOf = (o: OverviewDto, slug: string) => o.projects.find((p) => p.slug === slug)!;

describe("GET /api/overview", () => {
  it("one row per project with its status, numbers and the counting sentence", async () => {
    await register({ slug: "alpha" }, { slug: "beta" }, { slug: "_scratch" });
    await triaged("beta", "escalated");
    await repos.drafts.record({ project: "alpha", email: "c@example.com", name: "C", subject: "S", mailRef: "<m@x>", injectionSuspected: true });
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.projects.map((p) => p.slug)).toEqual(["alpha", "beta"]);
    expect(rowOf(body, "alpha")).toMatchObject({ name: "ALPHA", projectStatus: "active", toReview: 1, sentToday: 0, status: { level: "attention", kind: "injection-flagged", next: null, numbers: { owed: 0 } } });
    // A reply owed is a number of the line, not a status: beta is still clear.
    expect(rowOf(body, "beta").status).toMatchObject({ level: "clear", kind: "clear", sentence: "All clear", next: null, numbers: { owed: 1 } });
    expect(rowOf(body, "beta").status.numbers.lastTriageAt).not.toBeNull();
    expect(body.sentence).toBe("1 project needs you");
    expect(body.timeZone).toBe("UTC");
  });

  it("says All clear, then counts projects (not items) as they need the owner", async () => {
    await register({ slug: "alpha" }, { slug: "beta" });
    await triaged("alpha");
    await triaged("beta");
    expect((await get()).body.sentence).toBe("All clear");
    await repos.sends.stop("alpha");
    await repos.sends.stop("beta");
    const { body } = await get();
    expect(body.sentence).toBe("2 projects need you");
    expect(rowOf(body, "alpha").status).toMatchObject({ level: "blocked", kind: "send-stopped", sentence: "Sending is stopped", next: "project" });
  });

  it("names the demo Mailer once per project: HUB_MAILER=fake is attention", async () => {
    await register({ slug: "alpha" });
    await triaged("alpha");
    const { body } = await get(app({ fake: true }));
    expect(rowOf(body, "alpha").status).toMatchObject({ level: "attention", kind: "fake-mailer", sentence: "Demo mode: nothing is really sent", next: null });
  });

  it("counts sends today from local midnight in the project's own zone", async () => {
    await register({ slug: "alpha", settingsJson: settings({ timezone: "America/Los_Angeles" }) });
    const d1 = await repos.drafts.record({ project: "alpha", email: "a@example.com", name: "A", subject: "S1", mailRef: "<a@x>" });
    const d2 = await repos.drafts.record({ project: "alpha", email: "b@example.com", name: "B", subject: "S2", mailRef: "<b@x>" });
    const mk = async (draftId: number, at: string) => repos.sends.markSent((await repos.sends.begin({ project: "alpha", draftId, mode: "manual", status: "sending", actor: "t", to: "a@example.com", subject: "S", body: "x", at })).id, "id@x");
    // Now is 2026-11-15 04:00 in Los Angeles; local midnight is 08:00Z.
    await mk(d1.draftId, "2026-11-15T07:59:00.000Z");
    await mk(d2.draftId, "2026-11-15T08:00:00.000Z");
    expect(rowOf((await get()).body, "alpha").sentToday).toBe(1);
  });

  it("carries no client name, address or subject, and no live block", async () => {
    await register({ slug: "alpha" });
    await repos.drafts.record({ project: "alpha", email: "secret.client@example.com", name: "Secret Client", subject: "Private subject", mailRef: "<p@x>" });
    const { text } = await get();
    for (const s of ["secret.client", "Secret Client", "Private subject"]) expect(text).not.toContain(s);
    for (const k of ["verdict", "attention", "mailboxes", "notion"]) expect(text).not.toContain(`"${k}"`);
  });

  it("answers in under 100 ms for ten projects", async () => {
    await register(...Array.from({ length: 10 }, (_, i) => ({ slug: `p${i}` })));
    for (let i = 0; i < 10; i++) for (let j = 0; j < 20; j++) await repos.drafts.record({ project: `p${i}`, email: `c${j}@example.com`, name: `C${j}`, subject: `S${j}`, mailRef: `<m${i}-${j}@x>` });
    const a = app();
    await get(a);
    // The best of five: the budget is about the work, and a busy machine only ever adds to a single run.
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      await get(a);
      runs.push(performance.now() - t);
    }
    expect(Math.min(...runs)).toBeLessThan(100);
  });

  it("has no refresh route and refuses a foreign host", async () => {
    expect((await app().request(`${BASE}/api/overview/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(404);
    expect((await app().request("http://evil.example/api/overview")).status).toBe(403);
  });
});

describe("the Overview writes nothing", () => {
  it("leaves every table as it was after a GET", async () => {
    await register({ slug: "alpha" });
    await repos.drafts.record({ project: "alpha", email: "c@example.com", name: "C", subject: "S", mailRef: "<m@x>" });
    const snap = async () => JSON.stringify({ d: await repos.drafts.countsByStatus("alpha"), s: await repos.sends.list("alpha"), p: await repos.projects.registry() });
    const before = await snap();
    await get();
    await get();
    expect(await snap()).toBe(before);
  });

  it("no overview source file calls a repo write", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = [...readdirSync(dir).filter((f) => /^overview.*\.ts$/.test(f) && !f.endsWith(".test.ts")), "routes/overview.ts"];
    expect(files.length).toBeGreaterThanOrEqual(4);
    const write = /\brepos\.\w+\.(create|record|begin|markSent|markFailed|setStatus|stop|resume|cancel|insert|update|delete|replaceRegistry|openQuestion|answer|upsert|replace\w*)\(/;
    for (const f of files) expect(readFileSync(join(dir, f), "utf8").match(write), f).toBeNull();
  });
});

import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { buildEml, FakeImapServer } from "@hub/mail/imap";
import { FRESH_MINUTES, MIN_REFRESH_SECONDS, overviewDto, refreshResponse, type OverviewDto } from "@hub/contract/overview";
import { createApp } from "./app";
import { createMailService } from "./mail";

const ME = "me@example.test";
const ANNA = "anna@example.test";
const SECRET = "pw-secret-123";
const NOTION_SECRET = "ntn\u005fsecret_token_value";
const T0 = new Date("2026-11-15T12:00:00Z");

let handle: DbHandle;
let repos: Repos;
let now = T0;
let imap: FakeImapServer;
let dir: string;
let root: string;
let fetched: string[];
let rows: number;
const BASE = "http://127.0.0.1:4317";
const advance = (ms: number) => (now = new Date(now.getTime() + ms));

const settings = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ schema: 1, slug: "x", kind: "generic", name: "x", mail: { accounts: ["Google"], addresses: [ME] }, draft: { recipients: ["a@example.com"] }, ...over });
const register = (...p: { slug: string; status?: string; archived?: boolean; settingsJson?: string }[]) =>
  repos.projects.replaceRegistry({ projects: p.map((x) => ({ slug: x.slug, name: x.slug.toUpperCase(), status: x.status ?? "active", archived: x.archived ?? false, settingsJson: x.settingsJson ?? settings(), hash: "h" })), addresses: [] });

/** A stub Notion: a data source served 100 rows per request, counting every request. */
const notionFetch = (total: number) =>
  (async (input: unknown, init?: { method?: string; body?: string }) => {
    fetched.push(`${init?.method ?? "GET"} ${new URL(String(input)).pathname}`);
    const body = JSON.parse(init?.body ?? "{}") as { start_cursor?: string };
    const from = body.start_cursor ? Number(body.start_cursor) : 0;
    const to = Math.min(total, from + 100);
    return new Response(JSON.stringify({ object: "list", results: Array.from({ length: to - from }, (_, i) => ({ object: "page", id: `p${from + i}`, last_edited_time: "t", properties: {} })), has_more: to < total, next_cursor: to < total ? String(to) : null }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;

beforeEach(() => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  now = T0;
  fetched = [];
  dir = mkdtempSync(join(tmpdir(), "hub-ov-secrets-"));
  root = mkdtempSync(join(tmpdir(), "hub-ov-projects-"));
  imap = new FakeImapServer({
    Google: {
      INBOX: { messages: [buildEml({ from: ANNA, to: ME, subject: "Viewing", messageId: "<in1@x>", date: "2026-11-10T09:00:00Z" }), buildEml({ from: "bob@example.test", to: ME, subject: "Offer", messageId: "<in2@x>", date: "2026-11-11T09:00:00Z" })] },
      Sent: { specialUse: "\\Sent", messages: [buildEml({ from: ME, to: ANNA, subject: "Re: Viewing", messageId: "<out1@x>", date: "2026-11-10T12:00:00Z", inReplyTo: "<in1@x>" })] },
    },
  });
  const f = join(dir, "mail-google.json");
  writeFileSync(f, JSON.stringify({ account: "Google", host: "imap.example.test", user: ME, pass: SECRET }));
  chmodSync(f, 0o600);
});
afterEach(() => handle.close());

const app = (over: { notion?: number; minIntervalMs?: number; connect?: FakeImapServer["connect"]; mailTimeoutMs?: number; token?: boolean } = {}) => {
  if (over.token !== false) writeFileSync(join(dir, "notion-token"), NOTION_SECRET);
  const mail = createMailService({ repos, env: {}, configDir: dir, connect: over.connect ?? imap.connect });
  return createApp(repos, {
    now: () => now,
    mail,
    overview: { projectsDir: root, timeZone: "UTC", env: { HUB_CONFIG_DIR: dir }, notionReader: { fetch: notionFetch(over.notion ?? 250), sleep: async () => {} }, ...(over.minIntervalMs !== undefined ? { minIntervalMs: over.minIntervalMs } : {}), ...(over.mailTimeoutMs ? { mailTimeoutMs: over.mailTimeoutMs } : {}) },
  });
};
type App = ReturnType<typeof app>;
const get = async (a: App) => {
  const r = await a.request(`${BASE}/api/overview`);
  return { status: r.status, text: await r.clone().text(), body: (await r.json()) as OverviewDto };
};
const refresh = async (a: App, project: string, sources: ("mail" | "notion")[] = ["mail"]) => {
  const r = await a.request(`${BASE}/api/overview/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project, sources }) });
  return { status: r.status, body: (await r.json()) as any, text: "" };
};
const mailOf = (o: OverviewDto, slug = "alpha") => o.projects.find((p) => p.slug === slug)?.mailboxes[0]?.newSinceTriage;
const notionOf = (o: OverviewDto, slug = "alpha") => o.projects.find((p) => p.slug === slug)?.notion.clients?.count;
const withNotion = () => settings({ notion: { tokenFile: "notion-token", databases: [{ slug: "clients", dataSourceId: "ds-clients" }] } });

describe("GET /api/overview", () => {
  it("serves a parsed overview and reaches no network (no IMAP call, no fetch)", async () => {
    await register({ slug: "alpha", settingsJson: withNotion() });
    const { status, body } = await get(app());
    expect(status).toBe(200);
    expect(overviewDto.safeParse(body).success).toBe(true);
    expect(imap.connects).toEqual([]);
    expect(imap.ops).toEqual([]);
    expect(fetched).toEqual([]);
    expect(body.projects.map((p) => p.slug)).toEqual(["alpha"]);
    expect(mailOf(body)).toEqual({ state: "never" });
    expect(notionOf(body)).toEqual({ state: "never" });
    expect(body.oldestAsOf).toBeNull();
    expect(body.timeZone).toBe("UTC");
  });

  it("a mailbox without a login is off, never a zero; a Notion source without a token is an error with a fix line, never off", async () => {
    await register({ slug: "alpha", settingsJson: settings({ mail: { accounts: ["Nowhere"], addresses: [ME] }, notion: { tokenFile: "notion-token", databases: [{ slug: "clients", dataSourceId: "ds" }] } }) });
    const { body } = await get(app({ token: false }));
    expect(mailOf(body)).toEqual({ state: "off", message: "No login for this account." });
    const n = notionOf(body);
    expect(n).toMatchObject({ state: "error", code: "token-missing" });
    expect(n?.state === "error" && n.fix).toContain("state/secrets/notion-token");
    expect(body.attention.map((a) => a.kind)).toEqual(expect.arrayContaining(["mail-off", "notion-token"]));
    expect(body.verdict.level).toBe("blocked");
    expect(fetched).toEqual([]);
  });

  it("a project with its own token file never falls back to the shared token", async () => {
    await register({ slug: "alpha", settingsJson: settings({ notion: { tokenFile: "alpha-token", databases: [{ slug: "clients", dataSourceId: "ds" }] } }) });
    const a = app();
    expect(notionOf((await get(a)).body)).toMatchObject({ state: "error", code: "token-missing" });
    const r = await refresh(a, "alpha", ["notion"]);
    expect(r.status).toBe(200);
    expect(fetched).toEqual([]);
  });

  it("skips scratch projects (_ prefix), lists local facts, and marks a shared account", async () => {
    await register({ slug: "alpha" }, { slug: "beta" }, { slug: "_scratch" });
    await repos.drafts.record({ project: "alpha", email: "c@example.com", name: "C", subject: "S", mailRef: "<m@x>", injectionSuspected: true });
    const { body } = await get(app());
    expect(body.projects.map((p) => p.slug)).toEqual(["alpha", "beta"]);
    const alpha = body.projects[0];
    expect(alpha?.drafts.ready).toBe(1);
    expect(alpha?.injectionHeld).toBe(1);
    expect(alpha?.mailboxes[0]?.shared).toBe(true);
    expect(alpha?.recipients).toBe("listed");
    expect(body.attention.some((a) => a.kind === "injection-flagged" && a.project === "alpha")).toBe(true);
  });

  it("counts sends today from local midnight in the project's own zone", async () => {
    await register({ slug: "alpha", settingsJson: settings({ timezone: "America/Los_Angeles" }) });
    const d1 = await repos.drafts.record({ project: "alpha", email: "a@example.com", name: "A", subject: "S1", mailRef: "<a@x>" });
    const d2 = await repos.drafts.record({ project: "alpha", email: "b@example.com", name: "B", subject: "S2", mailRef: "<b@x>" });
    const mk = async (draftId: number, at: string) => repos.sends.markSent((await repos.sends.begin({ project: "alpha", draftId, mode: "manual", status: "sending", actor: "t", to: "a@example.com", subject: "S", body: "x", at })).id, "id@x");
    // Now is 2026-11-15 04:00 in Los Angeles; local midnight is 08:00Z.
    now = new Date("2026-11-15T12:00:00Z");
    await mk(d1.draftId, "2026-11-15T07:59:00.000Z"); // 23:59 yesterday there
    await mk(d2.draftId, "2026-11-15T08:00:00.000Z"); // 00:00 today there
    const { body } = await get(app());
    expect(body.projects[0]?.sends).toMatchObject({ today: 1, since: "2026-11-15T08:00:00.000Z" });
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
    const ms = Math.min(...runs);
    console.info(`GET /api/overview, 10 projects, 200 drafts: best ${ms.toFixed(1)} ms of ${runs.map((r) => r.toFixed(0)).join("/")}`);
    expect(ms).toBeLessThan(100);
  });
});

describe("POST /api/overview/refresh", () => {
  it("reads headers only, fills the mailbox with its read time, and the GET then shows it fresh", async () => {
    await register({ slug: "alpha" });
    const a = app();
    const r = await refresh(a, "alpha");
    expect(r.status).toBe(200);
    expect(refreshResponse.safeParse(r.body).success).toBe(true);
    expect(r.body.outcomes).toEqual({ mail: "read" });
    // Anna's thread is answered in Sent; only Bob's Offer waits.
    expect(r.body.project.mailboxes[0].newSinceTriage).toMatchObject({ state: "fresh", asOf: T0.toISOString(), value: { count: 1, mayOverstate: true } });
    expect(imap.ops.filter((o) => /:source:/.test(o))).toEqual([]);
    expect(r.body.oldestAsOf).toBe(T0.toISOString());
    expect(mailOf((await get(a)).body)).toMatchObject({ state: "fresh" });
  });

  it("a number turns stale after its TTL and is still shown with its stamp", async () => {
    await register({ slug: "alpha" });
    const a = app();
    await refresh(a, "alpha");
    advance(FRESH_MINUTES.mail * 60_000 - 1000);
    expect(mailOf((await get(a)).body)?.state).toBe("fresh");
    advance(2000);
    const b = mailOf((await get(a)).body);
    expect(b).toMatchObject({ state: "stale", asOf: T0.toISOString(), value: { count: 1 } });
    expect((await get(a)).body.attention.some((i) => i.kind === "stale-read")).toBe(true);
  });

  it("single flight: two refreshes at once read the mailbox once", async () => {
    await register({ slug: "alpha" });
    const a = app();
    const [x, y] = await Promise.all([refresh(a, "alpha"), refresh(a, "alpha")]);
    expect([x.body.outcomes.mail, y.body.outcomes.mail].sort()).toEqual(["joined", "read"]);
    expect(imap.connects).toEqual(["Google"]);
  });

  it(`a second refresh within ${MIN_REFRESH_SECONDS} s reads nothing and says so; after it reads again`, async () => {
    await register({ slug: "alpha" });
    const a = app();
    await refresh(a, "alpha");
    advance(10_000);
    const again = await refresh(a, "alpha");
    expect(again.body.outcomes).toEqual({ mail: "too-soon" });
    expect(imap.connects.length).toBe(1);
    expect(again.body.project.mailboxes[0].newSinceTriage.state).toBe("fresh");
    advance(MIN_REFRESH_SECONDS * 1000);
    expect((await refresh(a, "alpha")).body.outcomes).toEqual({ mail: "read" });
    expect(imap.connects.length).toBe(2);
  });

  it("a failed read keeps the last good number beside an error with a fix, and never carries the login", async () => {
    await register({ slug: "alpha" });
    let fail = false;
    const a = app({ connect: async (acc) => { if (fail) throw new Error(`AUTHENTICATIONFAILED for ${acc.user} password ${SECRET}`); return imap.connect(acc); } });
    await refresh(a, "alpha");
    fail = true;
    advance(MIN_REFRESH_SECONDS * 1000);
    const r = await refresh(a, "alpha");
    const b = r.body.project.mailboxes[0].newSinceTriage;
    expect(b).toMatchObject({ state: "error", code: "login-refused", asOf: T0.toISOString(), value: { count: 1 } });
    expect(b.fix).toMatch(/login file/);
    const all = (await get(a)).text + JSON.stringify(r.body);
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain("AUTHENTICATIONFAILED");
    expect((await get(a)).body.attention.some((i) => i.kind === "mail-error")).toBe(true);
  });

  it("a mailbox that does not answer times out with a fix line", async () => {
    await register({ slug: "alpha" });
    const a = app({ connect: () => new Promise(() => {}), mailTimeoutMs: 20 });
    const r = await refresh(a, "alpha");
    expect(r.body.project.mailboxes[0].newSinceTriage).toMatchObject({ state: "error", code: "timeout" });
  });

  it("counts a Notion data source up to the cap and says it is capped (20 requests, 2 000 rows)", async () => {
    await register({ slug: "alpha", settingsJson: withNotion() });
    const a = app({ notion: 2500 });
    const r = await refresh(a, "alpha", ["notion"]);
    expect(r.body.outcomes).toEqual({ notion: "read" });
    expect(r.body.project.notion.clients.count).toMatchObject({ state: "fresh", value: { count: 2000, capped: true } });
    expect(fetched.length).toBe(20);
    expect(fetched.every((f) => f === "POST /v1/data_sources/ds-clients/query")).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(NOTION_SECRET);
  });

  it("a rejected Notion token is one error with a fix line, asked once for both data sources", async () => {
    await register({ slug: "alpha", settingsJson: settings({ notion: { tokenFile: "notion-token", databases: [{ slug: "clients", dataSourceId: "d1" }, { slug: "leads", dataSourceId: "d2" }] } }) });
    writeFileSync(join(dir, "notion-token"), NOTION_SECRET);
    const calls: string[] = [];
    const rejecting = (async (input: unknown) => (calls.push(String(input)), new Response(JSON.stringify({ object: "error", status: 401, code: "unauthorized", message: `bad ${NOTION_SECRET}` }), { status: 401, headers: { "content-type": "application/json" } }))) as unknown as typeof fetch;
    const a = createApp(repos, { now: () => now, mail: createMailService({ repos, env: {}, configDir: dir, connect: imap.connect }), overview: { projectsDir: root, timeZone: "UTC", env: { HUB_CONFIG_DIR: dir }, notionReader: { fetch: rejecting, sleep: async () => {} } } });
    const r = await refresh(a, "alpha", ["notion"]);
    expect(calls.length).toBe(1);
    for (const s of ["clients", "leads"]) expect(r.body.project.notion[s].count).toMatchObject({ state: "error", code: "token-rejected" });
    expect(r.body.project.notion.clients.count.fix).toContain("hub doctor alpha");
    expect(JSON.stringify(r.body)).not.toContain(NOTION_SECRET);
    expect(r.body.attention.map((i: { kind: string }) => i.kind)).toContain("notion-token");
  });

  it("is 404 for an unknown or an archived project, and 400 for a bad body", async () => {
    await register({ slug: "alpha" }, { slug: "old", status: "archived", archived: true });
    const a = app();
    expect((await refresh(a, "nobody")).status).toBe(404);
    expect((await refresh(a, "old")).status).toBe(404);
    const bad = await a.request(`${BASE}/api/overview/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: "alpha", sources: [] }) });
    expect(bad.status).toBe(400);
    expect(imap.connects).toEqual([]);
  });

  it("refuses a foreign host like every route", async () => {
    const r = await app().request("http://evil.example/api/overview");
    expect(r.status).toBe(403);
  });
});

describe("the Overview writes nothing", () => {
  it("leaves every table as it was after a GET and a refresh of both sources", async () => {
    await register({ slug: "alpha", settingsJson: withNotion() });
    await repos.drafts.record({ project: "alpha", email: "c@example.com", name: "C", subject: "S", mailRef: "<m@x>" });
    const snap = async () => JSON.stringify({ d: await repos.drafts.countsByStatus("alpha"), s: await repos.sends.list("alpha"), p: await repos.projects.registry() });
    const before = await snap();
    const a = app();
    await get(a);
    await refresh(a, "alpha", ["mail", "notion"]);
    await get(a);
    expect(await snap()).toBe(before);
    // Notion was only queried: a POST to a data source query, never a page or database write.
    expect(new Set(fetched)).toEqual(new Set(["POST /v1/data_sources/ds-clients/query"]));
  });

  it("no overview source file calls a repo write", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = [...readdirSync(dir).filter((f) => /^overview.*\.ts$/.test(f) && !f.endsWith(".test.ts")), "routes/overview.ts"];
    expect(files.length).toBeGreaterThanOrEqual(5);
    const write = /\brepos\.\w+\.(create|record|begin|markSent|markFailed|setStatus|stop|resume|cancel|insert|update|delete|replaceRegistry|openQuestion|answer|upsert|setStatus|replace\w*)\(/;
    for (const f of files) expect(readFileSync(join(dir, f), "utf8").match(write), f).toBeNull();
  });
});

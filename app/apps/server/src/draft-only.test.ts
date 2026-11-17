import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, createRepos, type DbHandle, type Repos } from "@hub/db";
import { API_VERSION } from "@hub/contract/health";
import { createApp } from "./app";

// The draft-only invariant (`@rules/README.md` rule 3, amended by decision 0011): the agent makes drafts and has no send
// tool; a person sends, from the admin's confirmed Send. This file is the test that the one send route is the only
// one, no status says sent, and nothing in the API can set one.

let handle: DbHandle;
let repos: Repos;
let app: ReturnType<typeof createApp>;
const H = { "content-type": "application/json" };
const post = (path: string, body: unknown) => app.request(`http://127.0.0.1:4317${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
const get = (path: string) => app.request(`http://127.0.0.1:4317${path}`);
const NOW = Date.now();
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

beforeEach(() => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  app = createApp(repos);
});
afterEach(() => handle.close());

async function seedClients() {
  const ana = await repos.clients.create({ project: "p", email: "ana@x.example", name: "Ana Silva", repliesOwed: true, lastContactAt: daysAgo(30) });
  const bo = await repos.clients.create({ project: "p", email: "bo@x.example", name: "Bo Li", repliesOwed: false, lastContactAt: daysAgo(20) });
  return { ana, bo };
}

describe("no route sends", () => {
  it("has exactly one route that sends, and it is a POST that names its project and draft", () => {
    const paths = [...new Set(app.routes.map((r) => `${r.method} ${r.path}`))];
    expect(paths.length).toBeGreaterThan(15);
    expect(paths.filter((p) => /deliver|dispatch|smtp|outbox/i.test(p))).toEqual([]);
    // `.../sends` (history) and `.../sends/stop|resume|cancel` only read or remove work; the one that sends is below.
    expect(paths.filter((p) => /send/i.test(p) && !/\/sends(\/|$)/.test(p))).toEqual(["POST /api/projects/:slug/drafts/:id/send"]);
  });

  it("only the confirmed send route imports the sender, and only send/mailer.ts names the real Mailer", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]));
    const src = files(dir).filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"));
    const rel = (f: string) => f.slice(dir.length + 1);
    expect(src.filter((f) => /mailAppMailer/.test(readFileSync(f, "utf8"))).map(rel)).toEqual(["send/mailer.ts"]);
    expect(src.filter((f) => /\b(sendDraft|runDue)\b/.test(readFileSync(f, "utf8"))).map(rel)).toEqual(["routes/sends.ts"]);
  });

  it("imports no mail transport anywhere in the server source", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]));
    const offenders = files(dir)
      .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"))
      .filter((f) => /nodemailer|smtp|sendmail|createTransport|messages\/send|users\.messages|mail_send|send_message/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("no status says sent", () => {
  it("refuses `sent` on the status route and leaves the draft as it was", async () => {
    const { ana } = await seedClients();
    const id = await repos.drafts.create({ project: "p", clientId: ana, subject: "s", toAddr: "ana@x.example", body: "b" });
    expect((await post(`/api/drafts/${id}/status`, { project: "p", status: "sent" })).status).toBe(400);
    expect((await repos.drafts.get(id))!.status).toBe("ready");
    expect((await post(`/api/drafts/${id}/status`, { project: "p", status: "done" })).status).toBe(200);
  });

  it("a batch only ever yields ready drafts, whatever the body says", async () => {
    const { bo } = await seedClients();
    const agent = await post("/api/batches", { project: "p", name: "A", intent: "notice", audience: "all", clientIds: [bo], brief: "Say hello.", status: "sent" });
    const { batchId } = (await agent.json()) as { batchId: number };
    const add = await post(`/api/batches/${batchId}/drafts`, { project: "p", clientId: bo, subject: "Hello", body: "Hi Bo.", reason: "Silent.", status: "sent", checked: true });
    expect(add.status).toBe(200);
    const { drafts } = (await (await get(`/api/batches/${batchId}?project=p`)).json()) as { drafts: { status: string; checked: boolean }[] };
    expect(drafts.map((d) => [d.status, d.checked])).toEqual([["ready", false]]);
  });

  it("a batch needs a brief: the old template fields are not part of the API", async () => {
    const { ana } = await seedClients();
    expect((await post("/api/batches", { project: "p", name: "T", intent: "follow_up", audience: "silent", silentDays: 14, clientIds: [ana] })).status).toBe(400);
    const made = await post("/api/batches", { project: "p", name: "T", intent: "follow_up", mode: "template", audience: "silent", silentDays: 14, clientIds: [ana], subjectTemplate: "Hi {first_name}", bodyTemplate: "Hi {first_name}, checking in.", brief: "Check in." });
    expect(made.status).toBe(200);
    // the one text was never rendered into a body: the batch waits for the agent
    expect(await (await get("/api/batches/1?project=p")).json()).toMatchObject({ batch: { status: "queued", brief: "Check in." }, drafts: [] });
  });
});

describe("a draft recorded by a session", () => {
  it("is ready, never sent by record or by the API, and shows on the Drafts list", async () => {
    const r = await repos.drafts.record({ project: "p", email: "Cy@x.example", name: "Cy Roe", subject: "Re: terms", mailRef: "<m1@x.example>" });
    expect((await repos.drafts.get(r.draftId))).toMatchObject({ status: "ready", batchId: null, sentAt: null, body: "" });
    expect((await post(`/api/drafts/${r.draftId}/status`, { project: "p", status: "sent" })).status).toBe(400);
    const list = (await (await get("/api/drafts?project=p")).json()) as { drafts: { client: { name: string }; subject: string }[]; counts: Record<string, number>; total: number; nextOffset: number | null };
    expect(list.drafts.map((d) => [d.client.name, d.subject])).toEqual([["Cy Roe", "Re: terms"]]);
    expect(list.counts).toEqual({ all: 1, ready: 1, hold: 0, owed: 0, done: 0, sent: 0, skipped: 0, evidence: 0 });
    expect(list).toMatchObject({ total: 1, nextOffset: null });
  });

  it("the evidence filter and basedOn reach the API; the sketch and the raw context columns do not", async () => {
    await repos.drafts.record({ project: "p", email: "w@x.example", name: "Wo", subject: "Re", mailRef: "<w@x>", evidence: { level: "missing", source: "claimed", findings: [{ code: "no-thread-read", text: "no message was opened", amber: false }], context: { thread: { found: 2, read: 0 } }, fingerprint: [4, 5], batchKey: "k" } });
    await repos.drafts.record({ project: "p", email: "g@x.example", name: "Gi", subject: "Re", mailRef: "<g@x>" });
    const list = (await (await get("/api/drafts?project=p&filter=evidence")).json()) as { drafts: Array<Record<string, unknown>>; counts: Record<string, number> };
    expect(list.drafts).toHaveLength(1);
    expect(list.drafts[0]).toMatchObject({ basedOn: { level: "missing", source: "claimed", findings: [{ code: "no-thread-read" }] }, blocked: true });
    expect(Object.keys(list.drafts[0] ?? {})).not.toEqual(expect.arrayContaining(["fingerprint"]));
    expect(list.drafts[0]).not.toHaveProperty("context");
    expect(list.counts.evidence).toBe(1);
  });

  it("the Drafts list hides a client who has no draft", async () => {
    await seedClients();
    const list = (await (await get("/api/drafts?project=p")).json()) as { drafts: unknown[]; counts: { all: number } };
    expect(list.drafts).toEqual([]);
    expect(list.counts.all).toBe(0);
  });
});

describe("the bulk flow over HTTP", () => {
  it("audience, brief batch, agent drafts, review, acknowledge, check, done, undo, log", async () => {
    const { ana, bo } = await seedClients();
    const aud = (await (await get("/api/bulk/audience?project=p&audience=silent&silentDays=14")).json()) as { counts: Record<string, number>; eligible: number };
    expect(aud.counts).toEqual({ all: 2, owed: 1, silent: 2, follow_up: 0, vip: 0 });

    const made = await post("/api/batches", { project: "p", name: "Nov follow-up", intent: "follow_up", audience: "silent", silentDays: 14, clientIds: [ana, bo], brief: "Check in about the commission." });
    expect(await made.json()).toMatchObject({ batchId: 1 });
    // the agent writes one draft per client (each its own text) and closes the batch
    for (const [id, first] of [[ana, "Ana"], [bo, "Bo"]] as const) {
      expect((await post("/api/batches/1/drafts", { project: "p", clientId: id, subject: "Checking in", body: `Hi ${first}, about the commission.`, reason: "Silent." })).status).toBe(200);
    }
    expect((await post("/api/batches/1/close", { project: "p", status: "ready" })).status).toBe(200);
    expect((await post("/api/batches", { project: "p", name: "x", intent: "notice", audience: "all", clientIds: [ana, bo], brief: "b" })).status).toBe(409); // both have open drafts now

    const list = (await (await get("/api/batches?project=p")).json()) as { batches: { id: number; counts: Record<string, number> }[] };
    expect(list.batches).toHaveLength(1);
    expect(list.batches[0]!.counts).toMatchObject({ all: 2, review: 2 });

    const review = (await (await get("/api/batches/1?project=p&filter=review")).json()) as { drafts: { id: number; client: { name: string }; safetyResults: { kind: string; acked: boolean }[] }[] };
    const first = review.drafts[0]!;
    expect(first.client.name).toBe("Ana Silva");
    expect(first.safetyResults.map((s) => s.kind)).toContain("risky_word");

    // gate: refused until acknowledged, with the reason in the body
    const refused = await post(`/api/drafts/${first.id}/checked`, { project: "p", checked: true });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toMatch(/Acknowledge/);
    for (const s of first.safetyResults) expect((await post(`/api/drafts/${first.id}/ack`, { project: "p", kind: s.kind, acked: true })).status).toBe(200);
    expect((await post(`/api/drafts/${first.id}/checked`, { project: "p", checked: true })).status).toBe(200);
    expect((await post(`/api/drafts/${first.id}/status`, { project: "p", status: "done" })).status).toBe(200);
    expect((await post("/api/batches/1/undo?project=p", {})).status).toBe(200);
    expect((await repos.drafts.get(first.id))).toMatchObject({ status: "ready", checked: true });

    const log = await repos.runs.events("p", 1);
    expect(log.map((e) => e.summary)).toEqual(
      expect.arrayContaining(["Checked: Ana Silva", "Marked done: Ana Silva", "Undid the last action: Ana Silva"]),
    );
    expect((await get("/api/batches/99?project=p")).status).toBe(404);
  });

  it("scopes by project and validates input", async () => {
    const { ana } = await seedClients();
    expect((await post("/api/batches", { project: "other", name: "x", intent: "notice", audience: "all", clientIds: [ana], brief: "b" })).status).toBe(409);
    expect((await post("/api/batches", { project: "p", name: "x", intent: "bogus", audience: "all", clientIds: [ana], brief: "b" })).status).toBe(400);
    expect(await (await get("/api/batches?project=other")).json()).toEqual({ batches: [] });
  });

  it("keeps the loopback guard on the bulk routes", async () => {
    expect((await app.request("http://evil.test/api/batches?project=p")).status).toBe(403);
    expect((await app.request("http://127.0.0.1:4317/api/batches?project=p", { headers: { origin: "http://evil.test" } })).status).toBe(403);
  });

  it("edits a safety rule", async () => {
    const res = await app.request("http://127.0.0.1:4317/api/safety-rules/risky_word", { method: "PUT", headers: H, body: JSON.stringify({ project: "p", params: { words: ["moon"] } }) });
    expect(res.status).toBe(200);
    const { rules } = (await (await get("/api/safety-rules?project=p")).json()) as { rules: { kind: string; params: { words?: string[] } }[] };
    expect(rules.find((r) => r.kind === "risky_word")!.params.words).toEqual(["moon"]);
  });
});

describe("the contract at the edge", () => {
  it("answers every refusal as { error, code }: 400 invalid, 404 not_found, 409 wrong_state", async () => {
    const { ana } = await seedClients();
    const id = await repos.drafts.create({ project: "p", clientId: ana, subject: "s", toAddr: "ana@x.example", body: "b" });
    const bad = await post(`/api/drafts/${id}/status`, { project: "p", status: "sent" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "invalid", error: expect.stringContaining("status") });
    const other = await post(`/api/drafts/${id}/status`, { project: "other", status: "done" });
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({ error: "draft not found", code: "not_found" });
    await repos.drafts.setStatus(id, "skipped");
    const clash = await repos.drafts.create({ project: "p", clientId: ana, subject: "t", toAddr: "ana@x.example", body: "b" });
    const refused = await post(`/api/drafts/${id}/status`, { project: "p", status: "ready" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "wrong_state" });
    expect(clash).toBeGreaterThan(id);
  });

  it("keeps a skip reason, and does not leak storage columns", async () => {
    const r = await repos.drafts.record({ project: "p", email: "cy@x.example", name: "Cy", subject: "Re: x", mailRef: "<m@x.example>" });
    expect((await post(`/api/drafts/${r.draftId}/status`, { project: "p", status: "skipped", reason: "wrong person" })).status).toBe(200);
    const list = (await (await get("/api/drafts?project=p&filter=skipped")).json()) as { drafts: Record<string, unknown>[] };
    expect(list.drafts[0]).toMatchObject({ skipReason: "wrong person", canUndo: true });
    expect(list.drafts[0]).not.toHaveProperty("prevStatus");
    expect(list.drafts[0]).not.toHaveProperty("sentMessageId");
  });

  it("pages the Drafts list", async () => {
    for (const n of ["a", "b", "c"]) await repos.drafts.record({ project: "p", email: `${n}@x.example`, name: n, subject: "s", mailRef: `<${n}@x>` });
    const one = (await (await get("/api/drafts?project=p&limit=2")).json()) as { drafts: unknown[]; total: number; nextOffset: number | null };
    expect(one).toMatchObject({ total: 3, nextOffset: 2 });
    const two = (await (await get("/api/drafts?project=p&limit=2&offset=2")).json()) as { drafts: unknown[]; nextOffset: number | null };
    expect(two.drafts).toHaveLength(1);
    expect(two.nextOffset).toBeNull();
  });

  it("serves a pulse with the data version, and the health carries the api version", async () => {
    const pulse = (await (await get("/api/pulse")).json()) as { dataVersion: number; serverTime: string; health: { apiVersion: number; ok: boolean } };
    expect(pulse).toMatchObject({ dataVersion: 0, health: { ok: true, apiVersion: API_VERSION } });
    expect(Number.isNaN(Date.parse(pulse.serverTime))).toBe(false);
  });

  it("maps a locked database to 503 busy and anything else to 500 server", async () => {
    const boom = (error: unknown) => {
      const r = createApp({ ...repos, projects: { ...repos.projects, list: async () => Promise.reject(error) } } as Repos);
      return r.request("http://127.0.0.1:4317/api/projects");
    };
    const busy = await boom(Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" }));
    expect(busy.status).toBe(503);
    expect(await busy.json()).toMatchObject({ code: "busy" });
    const generic = await boom(new Error("nope"));
    expect(generic.status).toBe(500);
    expect(await generic.json()).toEqual({ error: "server error", code: "server" });
  });

  it("a timeline of one client needs no mail login, and another project's client is 404", async () => {
    const r = await repos.drafts.record({ project: "p", email: "cy@x.example", name: "Cy", subject: "s", mailRef: "<m@x.example>" });
    const t = (await (await get(`/api/clients/${r.clientId}/timeline?project=p`)).json()) as { events: { summary: string }[] };
    expect(t.events.map((e) => e.summary)).toEqual(["Draft recorded: Cy"]);
    expect((await get(`/api/clients/${r.clientId}/timeline?project=other`)).status).toBe(404);
  });
});

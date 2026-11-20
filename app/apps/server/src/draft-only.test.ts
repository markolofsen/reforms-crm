import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/** A batch as a session leaves it (the HTTP builder is gone, P48): a run, the batch row and one ready draft per client. */
async function seedBatch(clientIds: number[]) {
  const at = new Date(NOW).toISOString();
  const runId = await repos.runs.start({ project: "p", startedAt: at, finishedAt: at, trigger: "owner", skill: "bulk-agent-drafts", status: "ok" });
  const batchId = Number(handle.db.$client.prepare("insert into batches (project, name, intent, status, audience, silent_days, client_ids, total, brief, run_id, created_at, closed_at) values ('p', 'Nov follow-up', 'follow_up', 'ready', 'silent', 14, ?, ?, 'Check in about the commission.', ?, ?, ?)").run(JSON.stringify(clientIds), clientIds.length, runId, at, at).lastInsertRowid);
  for (const id of clientIds) {
    const c = (await repos.clients.get("p", id))!;
    const first = c.name.split(" ")[0]!;
    await repos.drafts.create({ project: "p", clientId: id, runId, batchId, subject: "Checking in", toAddr: c.email, body: `Hi ${first}, about the commission.`, reason: "Silent.", status: "ready" });
  }
  return batchId;
}

describe("no route sends", () => {
  it("has exactly one route that sends per kind of draft (Mail's, and a messenger's since P71 M4), each a POST that names its project and draft", () => {
    const paths = [...new Set(app.routes.map((r) => `${r.method} ${r.path}`))];
    expect(paths.length).toBeGreaterThan(15);
    expect(paths.filter((p) => /deliver|dispatch|smtp|outbox/i.test(p))).toEqual([]);
    // `.../sends` (history) and `.../sends/stop|resume|cancel` only read or remove work; the one that sends is below.
    expect(paths.filter((p) => /send/i.test(p) && !/\/sends(\/|$)/.test(p)).sort()).toEqual(["POST /api/projects/:slug/drafts/:id/send", "POST /api/projects/:slug/messengers/drafts/:id/send"]);
  });

  it("only the confirmed send route imports the sender, and only send/mailer.ts names the real Mailer", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]));
    const src = files(dir).filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"));
    const rel = (f: string) => f.slice(dir.length + 1);
    expect(src.filter((f) => /mailAppMailer/.test(readFileSync(f, "utf8"))).map(rel)).toEqual(["send/mailer.ts"]);
    expect(src.filter((f) => /\b(sendDraft|runDue)\b/.test(readFileSync(f, "utf8"))).map(rel)).toEqual(["routes/sends.ts"]);
    // A messenger send: only the door mints the human actor's send, only the send routes call the door, only app.ts hands the
    // account's send (`TelegramUserHandle.sender`, `WhatsAppHandle.sender` since P71 M5) to them.
    expect(src.filter((f) => /\bsendConfirmed\b/.test(readFileSync(f, "utf8"))).map(rel)).toEqual(["send/messenger-door.ts"]);
    expect(src.filter((f) => /\bapplyMessenger\(/.test(readFileSync(f, "utf8"))).map(rel).sort()).toEqual(["routes/sends.ts", "send/messenger-door.ts"]);
    expect(src.filter((f) => /\.sender\(account\)/.test(readFileSync(f, "utf8"))).map(rel)).toEqual(["app.ts"]);
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

  it("the batch builder routes are gone: no route makes a batch or adds a draft to one", async () => {
    const { ana } = await seedClients();
    expect((await post("/api/batches", { project: "p", name: "A", intent: "notice", audience: "all", clientIds: [ana], brief: "b", status: "sent" })).status).toBe(404);
    expect((await post("/api/batches/1/drafts", { project: "p", clientId: ana, subject: "s", body: "b", status: "sent" })).status).toBe(404);
    expect((await post("/api/batches/1/close", { project: "p", status: "ready" })).status).toBe(404);
    expect((await get("/api/bulk/audience?project=p&audience=all")).status).toBe(404);
  });
});

describe("a draft recorded by a session", () => {
  it("is ready, never sent by record or by the API, and shows on the Drafts list", async () => {
    const r = await repos.drafts.record({ project: "p", email: "Cy@x.example", name: "Cy Roe", subject: "Re: terms", mailRef: "<m1@x.example>" });
    expect((await repos.drafts.get(r.draftId))).toMatchObject({ status: "ready", batchId: null, sentAt: null, body: "" });
    expect((await post(`/api/drafts/${r.draftId}/status`, { project: "p", status: "sent" })).status).toBe(400);
    const list = (await (await get("/api/drafts?project=p")).json()) as { drafts: { client: { name: string }; subject: string }[]; counts: Record<string, number>; total: number; nextOffset: number | null };
    expect(list.drafts.map((d) => [d.client.name, d.subject])).toEqual([["Cy Roe", "Re: terms"]]);
    expect(list.counts).toEqual({ all: 1, ready: 1, hold: 0, owed: 0, done: 0, sent: 0, skipped: 0, thin_basis: 0, sequences: 0 });
    expect(list).toMatchObject({ total: 1, nextOffset: null });
  });

  it("the thin-basis filter and basedOn reach the API; the sketch and the raw context columns do not", async () => {
    await repos.drafts.record({ project: "p", email: "w@x.example", name: "Wo", subject: "Re", mailRef: "<w@x>", evidence: { level: "missing", source: "claimed", findings: [{ code: "no-thread-read", text: "no message was opened", amber: false }], context: { thread: { found: 2, read: 0 } }, fingerprint: [4, 5], batchKey: "k" } });
    await repos.drafts.record({ project: "p", email: "g@x.example", name: "Gi", subject: "Re", mailRef: "<g@x>" });
    const list = (await (await get("/api/drafts?project=p&filter=thin_basis")).json()) as { drafts: Array<Record<string, unknown>>; counts: Record<string, number> };
    expect(list.drafts).toHaveLength(1);
    expect(list.drafts[0]).toMatchObject({ basedOn: { level: "missing", source: "claimed", findings: [{ code: "no-thread-read" }] }, blocked: true });
    expect(Object.keys(list.drafts[0] ?? {})).not.toEqual(expect.arrayContaining(["fingerprint"]));
    expect(list.drafts[0]).not.toHaveProperty("context");
    expect(list.counts.thin_basis).toBe(1);
  });

  it("the Drafts list hides a client who has no draft", async () => {
    await seedClients();
    const list = (await (await get("/api/drafts?project=p")).json()) as { drafts: unknown[]; counts: { all: number } };
    expect(list.drafts).toEqual([]);
    expect(list.counts.all).toBe(0);
  });
});

describe("the bulk flow over HTTP", () => {
  it("a session's batch: review, acknowledge, check, done, undo, log", async () => {
    const { ana, bo } = await seedClients();
    const batchId = await seedBatch([ana, bo]);
    expect(batchId).toBe(1);

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
    await seedBatch([ana]);
    expect(await (await get("/api/batches?project=other")).json()).toEqual({ batches: [] });
    expect((await get("/api/batches/1?project=other")).status).toBe(404);
    expect((await get("/api/batches/x?project=p")).status).toBe(400);
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

  it("P55: reads and edits the agent's model and advisor, and refuses a model it does not know", async () => {
    expect(await (await get("/api/agent-settings?project=p")).json()).toEqual({ agent: { model: "sonnet", advisor: false, advisorModel: "fable" } });
    const put = (body: unknown) => app.request("http://127.0.0.1:4317/api/agent-settings", { method: "PUT", headers: H, body: JSON.stringify(body) });
    expect(await (await put({ project: "p", advisor: true, advisorModel: "opus" })).json()).toEqual({ agent: { model: "sonnet", advisor: true, advisorModel: "opus" } });
    expect((await put({ project: "p", model: "haiku" })).status).toBe(400);
    expect(await (await get("/api/agent-settings?project=other")).json()).toEqual({ agent: { model: "sonnet", advisor: false, advisorModel: "fable" } });
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
    const logged: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { logged.push(a); });
    const generic = await Promise.resolve(boom(new Error("nope"))).finally(() => spy.mockRestore());
    expect(logged[0]![0]).toBe("500 GET /api/projects"); // the log line names the request, not just the error
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

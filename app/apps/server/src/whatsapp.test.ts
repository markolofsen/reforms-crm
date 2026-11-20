import { existsSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { FakeWaSocket, type WaAuthFiles } from "@hub/messengers";
import { createApp } from "./app";
import { composeScheme } from "./scheme";
import { startWhatsApp, type WhatsAppHandle } from "./whatsapp";

// P71 M5, the M1 checks on a FAKE Baileys socket: no WebSocket is opened, no QR is scanned by a phone, nothing reaches WhatsApp.
// A connect flow ends with the auth files at 0600 in a 0700 folder; a linked chat's message is stored; an unlinked chat's leaves
// no row anywhere; logged out parks the number, and a restarted supervisor neither reconnects nor builds a socket.

const ADMIN = 5173;
const HEADERS = { origin: `http://127.0.0.1:${ADMIN}`, "sec-fetch-site": "same-origin", "content-type": "application/json" };
const BASE = "http://127.0.0.1:4317";
const ACCOUNT = "4915100000001";
const ANNA = "+491510000002";
const STRANGER = "+491519999999";

let handle: DbHandle;
let repos: Repos;
let dir: string;
let clientId: number;
let socks: FakeWaSocket[];
let wa: WhatsAppHandle | null;

const last = () => socks[socks.length - 1]!;
const start = () =>
  startWhatsApp({
    repos,
    env: {},
    dir,
    historyMs: 100,
    sockets: (auth: WaAuthFiles) => {
      const s = new FakeWaSocket(auth);
      socks.push(s);
      return s;
    },
  });
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown, headers: Record<string, string> = HEADERS) =>
  app.request(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;
const count = (table: string) => handle.db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number };

beforeEach(async () => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  await repos.projects.replaceRegistry({ projects: [{ slug: "p", name: "P", status: "active", settingsJson: "{}", hash: "p" }], addresses: [] });
  clientId = await repos.clients.create({ project: "p", email: "anna@example.test", name: "Anna" });
  dir = mkdtempSync(join(tmpdir(), "hub-wa-"));
  socks = [];
  wa = null;
});
afterEach(async () => {
  await wa?.stop();
  handle.close();
});

/** The owner presses Connect, the admin reads the QR code, the (fake) phone scans it; the number connects from its files. */
async function connect(): Promise<ReturnType<typeof createApp>> {
  wa = await start();
  const app = createApp(repos, { whatsapp: wa, adminPort: ADMIN });
  const started = await json(await post(app, "/api/messengers/whatsapp/connect", {}));
  const flow = started.flow as string;
  expect(await json(await post(app, "/api/messengers/whatsapp/connect/state", { flow }))).toEqual({ step: "waiting" });
  const pairing = last();
  pairing.qr();
  const qr = await json(await post(app, "/api/messengers/whatsapp/connect/state", { flow }));
  expect(qr).toMatchObject({ step: "qr", size: expect.any(Number), rows: expect.any(Array) });
  expect(JSON.stringify(qr)).not.toMatch(/fake-qr-reference|fake-noise-key/);
  expect(readdirSync(dir)).toEqual([]);
  pairing.scan();
  await vi.waitFor(async () => expect(await json(await post(app, "/api/messengers/whatsapp/connect/state", { flow }))).toEqual({ step: "done", account: ACCOUNT, name: "Owner" }));
  // The number's own socket, from its files, is open and listening (it reads "running" after its first poll, up to 30 s later).
  await vi.waitFor(() => expect(socks.length === 2 && last().listening && wa?.adapter(ACCOUNT) !== undefined).toBe(true));
  expect(wa?.status().accounts[0]).toMatchObject({ account: ACCOUNT, parked: null });
  return app;
}

describe("WhatsApp linked device in the server (P71 M5)", () => {
  it("connects by QR code through the gated doors, keeps only the auth files at 0600 in a 0700 folder, and reports the number", async () => {
    const app = await connect();
    const folder = join(dir, `whatsapp-${ACCOUNT}`);
    expect(statSync(folder).mode & 0o777).toBe(0o700);
    for (const f of readdirSync(folder)) expect(statSync(join(folder, f)).mode & 0o777).toBe(0o600);
    expect(socks).toHaveLength(2); // the pairing socket, then the account's own from its files
    expect(socks[0]!.closed).toBe(1);
    const health = (await json(await app.request(`${BASE}/api/health`))) as { whatsapp: { state: string; accounts: { account: string; state: string }[] } };
    expect(health.whatsapp.state).toBe("on");
    expect(health.whatsapp.accounts.map((a) => a.account)).toEqual([ACCOUNT]);
    expect(JSON.stringify(health)).not.toMatch(/fake-noise-key|fake-private|fake-qr/);
  });

  it("refuses every door without the admin's exact origin, and starts no pairing then", async () => {
    wa = await start();
    const app = createApp(repos, { whatsapp: wa, adminPort: ADMIN });
    for (const headers of [{ "content-type": "application/json" }, { ...HEADERS, origin: "http://127.0.0.1:9999" }, { ...HEADERS, "sec-fetch-site": "same-site" }]) {
      expect((await post(app, "/api/messengers/whatsapp/connect", {}, headers)).status).toBe(403);
      expect((await post(app, "/api/messengers/whatsapp/connect/state", { flow: "x".repeat(24) }, headers)).status).toBe(403);
    }
    expect((await post(app, `/api/projects/p/messengers/whatsapp/${ACCOUNT}/link`, { clientId, chatId: ANNA }, { "content-type": "application/json" })).status).toBe(403);
    expect(socks).toEqual([]);
  });

  it("stores a linked chat's message and leaves no row of an unlinked one", async () => {
    const app = await connect();
    const sock = last();
    sock.message(ANNA, "seen before the link", { id: "N1" });
    const linked = await json(await post(app, `/api/projects/p/messengers/whatsapp/${ACCOUNT}/link`, { clientId, chatId: ANNA, title: "Anna" }));
    expect(linked).toMatchObject({ ok: true, chatId: ANNA, importError: null });
    sock.message(ANNA, "hello");
    sock.message(STRANGER, "not for the hub");
    sock.chat(STRANGER, "Stranger");
    await vi.waitFor(async () => expect((await repos.messengers.messagesOf("p", [{ channel: "whatsapp", chatId: ANNA }], { limit: 5 })).map((m) => m.text)).toEqual(["hello"]));
    expect(await repos.messengers.messagesOf("p", [{ channel: "whatsapp", chatId: STRANGER }], { limit: 5 })).toEqual([]);
    expect(count("messenger_messages").n).toBe(1);
    expect((await repos.messengers.allowedChats("p")).map((c) => c.chatId)).toEqual([ANNA]);
    expect(await repos.messengers.identifiersOf("p", clientId)).toEqual([expect.objectContaining({ kind: "whatsapp", value: ANNA })]);
    expect(JSON.stringify(wa?.status())).not.toMatch(/9999999|Stranger/);
    expect(JSON.stringify(await repos.messengers.account("p", "whatsapp", ACCOUNT))).not.toMatch(/9999999|Stranger/);
  });

  it("the picker marks a suggestion by number and a linked chat; nothing of it is stored", async () => {
    const app = await connect();
    const sock = last();
    await repos.messengers.addIdentifier("p", clientId, "phone", ANNA);
    sock.chat(ANNA, "Anna");
    sock.message(STRANGER, "x", { at: new Date("2026-11-20T11:00:00.000Z") });
    const r = (await json(await post(app, `/api/projects/p/messengers/whatsapp/${ACCOUNT}/dialogs`, { clientId }))) as { dialogs: { chatId: string; suggested: boolean; linked: boolean }[] };
    expect(r.dialogs.map((d) => [d.chatId, d.suggested, d.linked])).toEqual([
      [STRANGER, false, false],
      [ANNA, true, false],
    ]);
    expect(await repos.messengers.allowedChats("p")).toEqual([]);
    expect(count("messenger_messages").n).toBe(0);
    expect((await post(app, `/api/projects/other/messengers/whatsapp/${ACCOUNT}/dialogs`, { clientId })).status).toBe(409);
  });

  it("logged out parks the number, health shows the fix, the scheme makes it a Needs you item, and a restart does not reconnect", async () => {
    await connect();
    last().closeWith(401);
    await vi.waitFor(() => expect(wa?.status().accounts[0]).toMatchObject({ state: "parked", parked: "logged_out" }));
    expect(wa?.status().accounts[0]?.fix).toMatch(/connect again with a new QR code/);
    const app = createApp(repos, { whatsapp: wa ?? undefined, adminPort: ADMIN });
    const health = (await json(await app.request(`${BASE}/api/health`))) as never;
    const scheme = await composeScheme({ projects: async () => [], doctor: async () => ({}) as never, files: async () => ({}) as never, agentTools: () => null, connections: async () => ({ instance: "i", connections: [], mail: [], mailRead: { state: "answered", fix: null } }), health: () => health, stopped: async () => false, clis: () => null, core: () => null });
    expect(scheme.nodes.find((n) => n.id === `whatsapp:${ACCOUNT}`)).toMatchObject({ kind: "whatsapp", state: "fail", fix: expect.stringMatching(/new QR code/), place: "messengers" });
    await wa?.stop();
    const before = socks.length;
    wa = await start();
    expect(wa.status().accounts[0]).toMatchObject({ account: ACCOUNT, state: "parked", parked: "logged_out" });
    expect(socks.length).toBe(before);
  });

  it("a new scan clears a park; Disconnect logs the device out and removes the folder", async () => {
    await connect();
    last().closeWith(401);
    await vi.waitFor(() => expect(wa?.status().accounts[0]?.state).toBe("parked"));
    const app = createApp(repos, { whatsapp: wa ?? undefined, adminPort: ADMIN });
    const flow = (await json(await post(app, "/api/messengers/whatsapp/connect", {}))).flow as string;
    last().qr();
    last().scan();
    await vi.waitFor(async () => expect((await json(await post(app, "/api/messengers/whatsapp/connect/state", { flow }))).step).toBe("done"));
    await vi.waitFor(() => expect(socks.length === 4 && last().listening && wa?.adapter(ACCOUNT) !== undefined).toBe(true));
    expect(wa?.status().accounts[0]?.parked).toBeNull();
    const sock = last();
    const r = await json(await post(app, `/api/messengers/whatsapp/${ACCOUNT}/disconnect`, {}));
    expect(r).toEqual({ ok: true, account: ACCOUNT, removed: true });
    expect(sock.loggedOut).toBe(1);
    expect(existsSync(join(dir, `whatsapp-${ACCOUNT}`))).toBe(false);
    expect(wa?.status().accounts).toEqual([]);
  });

  it("an expired QR code is said in words; cancel ends the pairing", async () => {
    wa = await start();
    const app = createApp(repos, { whatsapp: wa, adminPort: ADMIN });
    const flow = (await json(await post(app, "/api/messengers/whatsapp/connect", {}))).flow as string;
    last().closeWith(408);
    expect(await json(await post(app, "/api/messengers/whatsapp/connect/state", { flow }))).toEqual({ step: "failed", reason: expect.stringMatching(/expired/) });
    const again = (await json(await post(app, "/api/messengers/whatsapp/connect", {}))).flow as string;
    expect((await post(app, "/api/messengers/whatsapp/connect/cancel", { flow: again })).status).toBe(200);
    expect(last().closed).toBe(1);
    expect((await post(app, "/api/messengers/whatsapp/connect/state", { flow: again })).status).toBe(409);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("is off with several projects and refuses a Connect then", async () => {
    await repos.projects.replaceRegistry({ projects: ["a", "b"].map((slug) => ({ slug, name: slug, status: "active", settingsJson: "{}", hash: slug })), addresses: [] });
    wa = await start();
    expect(wa.status()).toMatchObject({ state: "off", reason: expect.stringMatching(/HUB_MESSENGERS_PROJECT/) });
    const app = createApp(repos, { whatsapp: wa, adminPort: ADMIN });
    expect((await post(app, "/api/messengers/whatsapp/connect", {})).status).toBe(409);
    expect(socks).toEqual([]);
  });
});

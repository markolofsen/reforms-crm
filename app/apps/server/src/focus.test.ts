import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Repos } from "@hub/db";
import { createApp } from "./app";
import { createFocusStore } from "./focus";

// The shared focus door (P51 F1): as strict as the send and terminal tickets, last visible tab wins, ids only in the file.

const ADMIN_PORT = 5173;
const API = "http://127.0.0.1:4317";
const ADMIN = { "content-type": "application/json", host: "127.0.0.1:4317", origin: `http://127.0.0.1:${ADMIN_PORT}`, "sec-fetch-site": "same-origin" };
const repos = {} as unknown as Repos;

let dir: string;
let file: string;
let t = Date.parse("2026-11-18T10:00:00Z");
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hub-focus-"));
  file = join(dir, "state", "focus.json");
  t = Date.parse("2026-11-18T10:00:00Z");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup() {
  const focus = createFocusStore({ file, now: () => new Date(t) });
  const app = createApp(repos, { focus, adminPort: ADMIN_PORT });
  const post = (body: unknown, headers: Record<string, string> = ADMIN) => app.request(`${API}/api/focus`, { method: "POST", headers, body: JSON.stringify(body) });
  return { focus, post };
}
const draft = (tab: string, draftId: number, visible = true) => ({ tab, project: "acme", route: "drafts.item", title: `Draft ${draftId}`, subject: `draft:${draftId}`, selected: [], view: { filter: "hold" }, visible });
const onDisk = () => JSON.parse(readFileSync(file, "utf8")) as { schema: number; at: string; focus: { tab: string; subject?: string } };

describe("POST /api/focus", () => {
  it("refuses a wrong Origin, a missing Sec-Fetch-Site and a non-loopback Host with 403", async () => {
    const { post } = setup();
    for (const headers of [{ ...ADMIN, origin: "http://127.0.0.1:3000" }, { ...ADMIN, origin: "http://localhost:5174" }, { "content-type": "application/json", host: ADMIN.host, origin: ADMIN.origin }, { ...ADMIN, "sec-fetch-site": "same-site" }, { ...ADMIN, host: "evil.example:4317" }]) {
      expect((await post(draft("a", 1), headers)).status).toBe(403);
    }
    expect(existsSync(file)).toBe(false);
  });

  it("refuses an unknown field, a v1 screen, a malformed ref, a title in a ref's place and too many selected refs with 400", async () => {
    const { post } = setup();
    expect((await post({ ...draft("a", 1), body: "mail text" })).status).toBe(400);
    expect((await post({ ...draft("a", 1), screen: "draft" })).status).toBe(400);
    expect((await post({ ...draft("a", 1), subject: "draft:abc" })).status).toBe(400);
    expect((await post({ ...draft("a", 1), pointed: "Can I download everything as CSV?" })).status).toBe(400);
    expect((await post({ ...draft("a", 1), window: { refs: Array.from({ length: 31 }, (_, i) => `draft:${i + 1}`), total: 31 } })).status).toBe(400);
    expect((await post({ ...draft("a", 1), selected: Array.from({ length: 201 }, (_, i) => `draft:${i + 1}`) })).status).toBe(400);
    expect(existsSync(file)).toBe(false);
  });

  it("stamps the server's time, writes ids only, and the second tab's post wins", async () => {
    const { post } = setup();
    expect((await post(draft("a", 1))).status).toBe(200);
    expect(onDisk()).toMatchObject({ schema: 2, at: "2026-11-18T10:00:00.000Z", focus: { tab: "a", subject: "draft:1" } });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    t += 1000;
    await post(draft("b", 2));
    expect(onDisk().focus).toMatchObject({ tab: "b", subject: "draft:2" });
  });

  it("a hidden post does not replace another tab's visible focus; it does replace its own", async () => {
    const { post } = setup();
    await post(draft("a", 1));
    await post(draft("b", 2, false));
    expect(onDisk().focus).toMatchObject({ tab: "a", subject: "draft:1" });
    await post(draft("a", 1, false));
    expect(onDisk().focus).toMatchObject({ tab: "a", subject: "draft:1" });
    expect(JSON.parse(readFileSync(file, "utf8")).focus.visible).toBe(false);
  });

  it("an unchanged post writes nothing; a heartbeat after 50 s moves the time", async () => {
    const { post } = setup();
    await post(draft("a", 1));
    const first = statSync(file).mtimeMs;
    t += 10_000;
    await post(draft("a", 1));
    expect(onDisk().at).toBe("2026-11-18T10:00:00.000Z");
    expect(statSync(file).mtimeMs).toBe(first);
    t += 50_000;
    await post(draft("a", 1));
    expect(onDisk().at).toBe("2026-11-18T10:01:00.000Z");
  });

  it("a clear removes only its own tab's focus", async () => {
    const { post } = setup();
    await post(draft("a", 1));
    await post({ tab: "b", clear: true });
    expect(existsSync(file)).toBe(true);
    await post({ tab: "a", clear: true });
    expect(existsSync(file)).toBe(false);
  });

  it("is 404 without a store", async () => {
    const app = createApp(repos, { adminPort: ADMIN_PORT });
    expect((await app.request(`${API}/api/focus`, { method: "POST", headers: ADMIN, body: JSON.stringify(draft("a", 1)) })).status).toBe(404);
  });
});

describe("GET /api/pointer (P72)", () => {
  const pointerFile = () => join(dir, "state", "pointer.json");
  const write = (rec: Record<string, unknown>) => {
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(pointerFile(), JSON.stringify({ schema: 1, id: "abcdef0123456789", project: "acme", refs: ["draft:1"], note: "this one", at: "2026-11-18T10:00:00.000Z", ...rec }));
  };
  const fakeRepos = { drafts: { get: async (id: number) => (id === 1 ? { id: 1, project: "acme", clientId: 5, subject: "Re: Hello", status: "ready" } : null) }, clients: { get: async (p: string, id: number) => (p === "acme" && id === 5 ? { id: 5, name: "Fiona", email: "f@example.com" } : null) } } as unknown as Repos;
  const get = async (at: string) => {
    const app = createApp(fakeRepos, { pointerFile: pointerFile(), adminPort: ADMIN_PORT, now: () => new Date(at) });
    return (await (await app.request(`${API}/api/pointer`, { headers: { host: ADMIN.host } })).json()) as { pointer: { targets: Array<{ ref: string; title: string | null }>; note: string | null; expiresAt: string } | null };
  };

  it("no file, a clear and an expired pointer are null", async () => {
    expect((await get("2026-11-18T10:00:05Z")).pointer).toBeNull();
    write({ refs: [] });
    expect((await get("2026-11-18T10:00:05Z")).pointer).toBeNull();
    write({});
    expect((await get("2026-11-18T10:00:31Z")).pointer).toBeNull();
  });

  it("a live pointer names each ref's title inside its project; a ref that names nothing has none", async () => {
    write({ refs: ["draft:1", "draft:2"] });
    const p = (await get("2026-11-18T10:00:05Z")).pointer;
    expect(p).toMatchObject({ note: "this one", expiresAt: "2026-11-18T10:00:30.000Z" });
    // P99: a draft lives in its client's conversation, so Show opens `client:5`.
    expect(p?.targets).toEqual([{ ref: "draft:1", title: "Fiona <f@example.com> · Re: Hello", where: "client:5" }, { ref: "draft:2", title: null, where: null }]);
  });
});

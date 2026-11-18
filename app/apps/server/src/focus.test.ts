import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
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
const draft = (tab: string, draftId: number, visible = true) => ({ tab, project: "acme", screen: "draft", draftId, selected: [], view: "ready", visible });
const onDisk = () => JSON.parse(readFileSync(file, "utf8")) as { at: string; focus: { tab: string; draftId?: number } };

describe("POST /api/focus", () => {
  it("refuses a wrong Origin, a missing Sec-Fetch-Site and a non-loopback Host with 403", async () => {
    const { post } = setup();
    for (const headers of [{ ...ADMIN, origin: "http://127.0.0.1:3000" }, { ...ADMIN, origin: "http://localhost:5174" }, { "content-type": "application/json", host: ADMIN.host, origin: ADMIN.origin }, { ...ADMIN, "sec-fetch-site": "same-site" }, { ...ADMIN, host: "evil.example:4317" }]) {
      expect((await post(draft("a", 1), headers)).status).toBe(403);
    }
    expect(existsSync(file)).toBe(false);
  });

  it("refuses an unknown field, a bad screen and too many selected ids with 400", async () => {
    const { post } = setup();
    expect((await post({ ...draft("a", 1), body: "mail text" })).status).toBe(400);
    expect((await post({ ...draft("a", 1), screen: "inbox" })).status).toBe(400);
    expect((await post({ ...draft("a", 1), selected: Array.from({ length: 201 }, (_, i) => i + 1) })).status).toBe(400);
    expect(existsSync(file)).toBe(false);
  });

  it("stamps the server's time, writes ids only, and the second tab's post wins", async () => {
    const { post } = setup();
    expect((await post(draft("a", 1))).status).toBe(200);
    expect(onDisk()).toMatchObject({ at: "2026-11-18T10:00:00.000Z", focus: { tab: "a", draftId: 1 } });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    t += 1000;
    await post(draft("b", 2));
    expect(onDisk().focus).toMatchObject({ tab: "b", draftId: 2 });
  });

  it("a hidden post does not replace another tab's visible focus; it does replace its own", async () => {
    const { post } = setup();
    await post(draft("a", 1));
    await post(draft("b", 2, false));
    expect(onDisk().focus).toMatchObject({ tab: "a", draftId: 1 });
    await post(draft("a", 1, false));
    expect(onDisk().focus).toMatchObject({ tab: "a", draftId: 1 });
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

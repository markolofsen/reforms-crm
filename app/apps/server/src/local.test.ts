import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Repos } from "@hub/db";
import { entryKey } from "@hub/contract/local";
import type { ResolveDeps } from "@hub/projects/local-open";
import { createApp } from "./app";

// POST /api/local/:action (P61): the focus door's guards, server actions only, keys never paths, nothing on the wire holds a path.

const ADMIN_PORT = 5173;
const API = "http://127.0.0.1:4317";
const ADMIN = { "content-type": "application/json", host: "127.0.0.1:4317", origin: `http://127.0.0.1:${ADMIN_PORT}`, "sec-fetch-site": "same-origin" };
const ENTRY = "knowledge/files/how-can-i-pay-41806f30.md";
const repos = {} as unknown as Repos;

let root: string;
let t: number;
let calls: string[][];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hub-local-route-"));
  mkdirSync(join(root, "projects", "acme-travel", "knowledge", "files"), { recursive: true });
  writeFileSync(join(root, "projects", "acme-travel", "project.md"), "# P\n");
  writeFileSync(join(root, "projects", "acme-travel", ENTRY), "x");
  t = 1_000_000;
  calls = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function setup(o: { available?: boolean; withLocal?: boolean } = {}) {
  const deps: ResolveDeps = { projectsRoot: join(root, "projects"), logRoot: join(root, "state", "log"), isProject: async (s) => s === "acme-travel", knowledgeHas: async (_s, e) => e === ENTRY };
  const local = { deps, run: async (bin: string, args: string[]) => void calls.push([bin, ...args]), available: o.available ?? true, now: () => t };
  const app = createApp(repos, { adminPort: ADMIN_PORT, instance: { configFile: join(root, "config.json"), configDir: root }, ...(o.withLocal === false ? {} : { local }) });
  const post = (action: string, body: unknown, headers: Record<string, string> = ADMIN) => app.request(`${API}/api/local/${action}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { app, post };
}

describe("POST /api/local/:action", () => {
  it("opens a key and answers the label only", async () => {
    const { post } = setup();
    const r = await post("finder.open", { project: "acme-travel", key: "knowledge" });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({ ok: true, opened: "Open folder" });
    expect(text).not.toContain(root);
    expect(calls).toEqual([["/usr/bin/open", join(root, "projects", "acme-travel", "knowledge")]]);
    t += 1000;
    expect((await post("file.open", { project: "acme-travel", key: entryKey(ENTRY) })).status).toBe(200);
    expect((await post("finder.reveal", { project: "acme-travel", key: "project.md" })).status).toBe(200);
    expect(calls[2]).toEqual(["/usr/bin/open", "-R", join(root, "projects", "acme-travel", "project.md")]);
  });
  it("refuses a foreign Origin, a missing Sec-Fetch-Site and a foreign Host with 403", async () => {
    const { post } = setup();
    const body = { project: "acme-travel", key: "knowledge" };
    for (const headers of [{ ...ADMIN, origin: "http://127.0.0.1:3000" }, { "content-type": "application/json", host: ADMIN.host, origin: ADMIN.origin }, { ...ADMIN, "sec-fetch-site": "same-site" }, { ...ADMIN, host: "evil.example:4317" }]) {
      expect((await post("finder.open", body, headers)).status).toBe(403);
    }
    expect(calls).toEqual([]);
  });
  it("an href id and an unknown id are 404; no local service is 404", async () => {
    const { post } = setup();
    expect((await post("mail.openMessage", { messageId: "a@b" })).status).toBe(404);
    expect((await post("shell.run", { cmd: "ls" })).status).toBe(404);
    expect((await setup({ withLocal: false }).post("finder.open", { project: "acme-travel", key: "knowledge" })).status).toBe(404);
  });
  it("a path in the body is 400 from the schema; a refusal is said without the path", async () => {
    const { post } = setup();
    for (const body of [{ project: "acme-travel", key: "../../config/config.json" }, { project: "acme-travel", key: "knowledge", path: "/etc" }, { project: "acme-travel", key: "/etc/passwd" }]) {
      const r = await post("file.open", body);
      expect(r.status).toBe(400);
    }
    const missing = await post("file.open", { project: "acme-travel", key: entryKey("knowledge/files/other.md") });
    expect(missing.status).toBe(404);
    const text = await missing.text();
    expect(text).not.toContain(root);
    expect(JSON.parse(text).error).toMatch(/^Not opened: /);
    expect(calls).toEqual([]);
  });
  it("501 when this machine cannot open, and for the desktop handoff (not offered)", async () => {
    const off = await setup({ available: false }).post("finder.open", { project: "acme-travel", key: "knowledge" });
    expect(off.status).toBe(501);
    expect((await off.json()).error).toMatch(/macOS/);
    const desk = await setup().post("agent.openInDesktop", { project: "acme-travel", tab: "t-1" });
    expect(desk.status).toBe(501);
    expect((await desk.json()).error).toMatch(/^Not offered: Claude Desktop would run this session without the hub's rules/);
    expect(calls).toEqual([]);
  });
  it("429 on a second open of the same key within 500 ms", async () => {
    const { post } = setup();
    const body = { project: "acme-travel", key: "knowledge" };
    expect((await post("finder.open", body)).status).toBe(200);
    t += 100;
    expect((await post("finder.open", body)).status).toBe(429);
    expect((await post("finder.open", { ...body, key: "project" })).status).toBe(200);
    t += 500;
    expect((await post("finder.open", body)).status).toBe(200);
    expect(calls).toHaveLength(3);
  });
  it("GET /api/instance says whether Open is available", async () => {
    expect((await (await setup().app.request(`${API}/api/instance`)).json()).localOpen).toBe(true);
    expect((await (await setup({ available: false }).app.request(`${API}/api/instance`)).json()).localOpen).toBe(false);
  });
});

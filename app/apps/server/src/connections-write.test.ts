import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectionDto } from "@hub/contract/connections";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { createApp } from "./app";
import { fakeProbeDeps } from "./connections";
import { captureOps } from "@hub/log/ops";

// Fake secrets in a throwaway folder; probes are stubs. Nothing here touches a real instance or the network.
const OLD = "ntn_OLDFAKENOTIONSECRET123456";
const NEW = "ntn_NEWFAKENOTIONSECRET123456";
const TG = "123456789:AAFakeTelegramTokenValue_1234567890";
const OLDPASS = "fake-app-pass-old-1111";
const BASE = "http://127.0.0.1:4317";

let handle: DbHandle;
let repos: Repos;
let dir: string;

const put = (name: string, text: string, mode = 0o600) => { writeFileSync(join(dir, name), text, { mode }); chmodSync(join(dir, name), mode); };
const settings = JSON.stringify({ schema: 1, slug: "x", kind: "generic", name: "x", mail: { accounts: ["Work", "Apple Only"], addresses: [] } });
const app = (env: NodeJS.ProcessEnv = {}) => createApp(repos, { connections: { dir: () => dir, env, deps: fakeProbeDeps() } });
type App = ReturnType<typeof app>;
const send = async (a: App, method: string, path: string, body?: unknown) => {
  const r = await a.request(`${BASE}${path}`, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  return { status: r.status, text: await r.text() };
};
const putSecret = (a: App, id: string, body: unknown) => send(a, "PUT", `/api/connections/${id}/secret`, body);
const everything = () => readdirSync(dir).map((n) => readFileSync(join(dir, n), "utf8")).join("\n");

beforeEach(async () => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  await repos.projects.replaceRegistry({ projects: [{ slug: "alpha", name: "alpha", status: "active", archived: false, settingsJson: settings, hash: "h" }], addresses: [] });
  dir = join(mkdtempSync(join(tmpdir(), "hub-conn-w-")), "secrets");
  mkdirSync(dir, { recursive: true });
  put("notion-token", OLD);
  put("mail-work.json", JSON.stringify({ account: "Work", host: "imap.example.test", port: 993, user: "me@example.test", pass: OLDPASS }));
});
afterEach(() => handle.close());

describe("PUT /api/connections/:id/secret", () => {
  it("stores a Notion token atomically as mode 600 and the reply holds no value", async () => {
    const r = await putSecret(app(), "notion:notion-token", { value: NEW });
    expect(r.status).toBe(200);
    expect(r.text).not.toContain(NEW);
    expect(connectionDto.parse(JSON.parse(r.text))).toMatchObject({ secret: { state: "stored" }, check: { state: "never" } });
    expect(readFileSync(join(dir, "notion-token"), "utf8").trim()).toBe(NEW);
    expect(statSync(join(dir, "notion-token")).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("stores a Telegram token, and a new key drops the old test result", async () => {
    const a = app();
    expect(connectionDto.parse(JSON.parse((await send(a, "POST", "/api/connections/notion:notion-token/test")).text)).check.state).toBe("fresh");
    const n = await putSecret(a, "notion:notion-token", { value: NEW });
    expect(connectionDto.parse(JSON.parse(n.text)).check.state).toBe("never");
    expect((await putSecret(a, "telegram:bot", { value: TG })).status).toBe(200);
    expect(statSync(join(dir, "telegram-bot-token")).mode & 0o777).toBe(0o600);
  });

  it("a mail account takes no key: the old login body is refused and nothing is written (decision 0026)", async () => {
    const before = everything();
    const a = app();
    const login = { account: "Work", host: "imap.example.test", port: 993, user: "me@example.test", password: "fake-app-pass-NEW-4321" };
    expect((await putSecret(a, "mail:work", login)).status).toBe(400);
    expect((await putSecret(a, "mail:work", { value: NEW })).status).toBe(404);
    expect((await putSecret(a, "mail:apple-only", { value: NEW })).status).toBe(404);
    expect(everything()).toBe(before);
  });

  it("an invalid key stores nothing and the sentence holds no value", async () => {
    const before = everything();
    const a = app();
    const bad = "has spaces and is not a token";
    for (const [id, body] of [["notion:notion-token", { value: bad }], ["telegram:bot", { value: bad }], ["notion:notion-token", { value: NEW, extra: bad }], ["telegram:bot", { password: bad }]] as const) {
      const r = await putSecret(a, id, body);
      expect(r.status, `${id} ${JSON.stringify(Object.keys(body))}`).toBe(400);
      expect(r.text).not.toContain(bad);
      expect(r.text).not.toContain(NEW);
    }
    expect(everything()).toBe(before);
    expect(readdirSync(dir).sort()).toEqual(["mail-work.json", "notion-token"]);
  });

  it("404 for an unknown id, 409 where a key cannot be set", async () => {
    const a = app();
    expect((await putSecret(a, "mail:ghost", { value: NEW })).status).toBe(404);
    expect((await putSecret(a, "notion:..%2Fx", { value: NEW })).status).toBe(404);
    const w = await putSecret(a, "whatsapp", { value: NEW });
    expect(w.status).toBe(404);
    expect(w.text).not.toContain(NEW);
    expect((await putSecret(createApp(repos, { connections: { dir: () => dir, env: { NOTION_TOKEN: NEW }, deps: fakeProbeDeps() } }), "notion:notion-token", { value: NEW })).status).toBe(409);
  });

  it("no value reaches a log line, even when a write fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const cap = captureOps();
    const a = app();
    await putSecret(a, "notion:notion-token", { value: NEW });
    await putSecret(a, "notion:notion-token", { value: "short" });
    // a folder where the file belongs: the rename fails, which is the write failing after the value was already in memory
    mkdirSync(join(dir, "telegram-bot-token"));
    writeFileSync(join(dir, "telegram-bot-token", "x"), "x");
    const failed = await putSecret(a, "telegram:bot", { value: TG });
    expect(failed.status).not.toBe(200);
    expect(failed.text).not.toContain(TG);
    const out = JSON.stringify([...spy.mock.calls, ...log.mock.calls, ...cap.lines]);
    cap.stop();
    for (const s of [NEW, TG, OLD, OLDPASS]) expect(out).not.toContain(s);
    spy.mockRestore(); log.mockRestore();
  });

  it("a read after a write never returns a value: the list and a test carry none", async () => {
    const a = app();
    await putSecret(a, "notion:notion-token", { value: NEW });
    const list = (await send(a, "GET", "/api/connections")).text;
    const t = (await send(a, "POST", "/api/connections/notion:notion-token/test")).text;
    for (const s of [NEW, OLD, OLDPASS]) { expect(list).not.toContain(s); expect(t).not.toContain(s); }
  });
});

describe("POST /api/connections/:id/remove", () => {
  it("deletes the key file and says the row is not set; an old mail login file is not touched", async () => {
    const a = app();
    const n = await send(a, "POST", "/api/connections/notion:notion-token/remove");
    expect(n.status).toBe(200);
    expect(connectionDto.parse(JSON.parse(n.text)).secret.state).toBe("missing");
    expect((await send(a, "POST", "/api/connections/mail:work/remove")).status).toBe(404);
    expect(readdirSync(dir)).toEqual(["mail-work.json"]);
  });

  it("refuses a key set by the environment, a row with no file; 404 for an unknown id", async () => {
    const a = app({ NOTION_TOKEN: NEW });
    const env = await send(a, "POST", "/api/connections/notion:notion-token/remove");
    expect(env.status).toBe(409);
    expect(readdirSync(dir)).toContain("notion-token");
    expect((await send(a, "POST", "/api/connections/telegram:bot/remove")).status).toBe(409);
    expect((await send(a, "POST", "/api/connections/mail:ghost/remove")).status).toBe(404);
  });
});

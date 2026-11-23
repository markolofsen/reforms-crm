import { chmodSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspect } from "@hub/connections";
import { connectionDto, connectionsDto, type ConnectionDto } from "@hub/contract/connections";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { testApp } from "../test-support/runtime";
import { MailNotAnswering } from "@hub/mail-app/osa";
import { appleMailAccounts, fakeProbeDeps, type MailAccountsRead } from "./connections";
import { ACCOUNTS_SCRIPT, RUNNING_SCRIPT } from "@hub/mail-app/scripts/read";
import { captureOps } from "@hub/log/ops";
import { projectStoreOf } from "@hub/projects/testing";

// Fake secrets in a throwaway folder; the probes are stubs. Nothing here touches a real instance or the network.
const NOTION = "ntn_FAKENOTIONSECRET1234567890";
const TG = "123456789:AAFakeTelegramTokenValue_1234567890";
const ALL = [NOTION, TG];
const T0 = new Date("2026-11-17T12:00:00Z");
const BASE = "http://127.0.0.1:4317";

let handle: DbHandle;
let repos: Repos;
let dir: string;
let now = T0;
let calls: string[];

const settings = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ schema: 1, slug: "x", kind: "generic", name: "x", mail: { accounts: ["Work"], addresses: [] }, ...over });
// P126 P3: a project's config is read from project.md through the store; the registry row only lists it.
const configs: Record<string, Record<string, unknown>> = {};
const projects = projectStoreOf(configs);
const register = (...p: { slug: string; settingsJson?: string }[]) => {
  for (const k of Object.keys(configs)) delete configs[k];
  for (const x of p) configs[x.slug] = JSON.parse(x.settingsJson ?? settings()) as Record<string, unknown>;
  return repos.projects.replaceRegistry({ projects: p.map((x) => ({ slug: x.slug, name: x.slug, status: "active", archived: false, settingsJson: x.settingsJson ?? settings(), hash: "h" })), addresses: [] });
};
const put = (name: string, text: string, mode = 0o600) => { writeFileSync(join(dir, name), text, { mode }); chmodSync(join(dir, name), mode); };

const stub = (status = 200) => ({
  fetch: (async (url: string) => { calls.push(String(url)); return new Response(JSON.stringify({ name: "Hub bot", result: { username: "hubbot" } }), { status }); }) as unknown as typeof fetch,
});
const app = (o: { status?: number; env?: NodeJS.ProcessEnv; minIntervalMs?: number; mail?: () => Promise<MailAccountsRead> } = {}) =>
  testApp(repos, { projects, now: () => now, messengers: () => ({ state: "off", reason: "no bot token file", failures: 0, stored: 0 }), connections: { dir: () => dir, env: o.env ?? {}, deps: stub(o.status), ...(o.mail ? { mailAccounts: o.mail } : {}), ...(o.minIntervalMs !== undefined ? { minIntervalMs: o.minIntervalMs } : {}) } });
type App = ReturnType<typeof app>;
const list = async (a: App) => { const r = await a.request(`${BASE}/api/connections`); return { status: r.status, text: await r.clone().text(), body: connectionsDto.parse(await r.json()) }; };
const test = async (a: App, id: string) => { const r = await a.request(`${BASE}/api/connections/${id}/test`, { method: "POST" }); return { status: r.status, text: await r.clone().text(), json: await r.json() as unknown }; };
const row = (c: ConnectionDto[], id: string) => { const r = c.find((x) => x.id === id); if (!r) throw new Error(`no ${id}`); return r; };

beforeEach(() => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  now = T0;
  calls = [];
  dir = join(mkdtempSync(join(tmpdir(), "hub-conn-srv-")), "secrets");
  mkdirSync(dir, { recursive: true });
  put("notion-token", NOTION);
});
afterEach(() => handle.close());

describe("GET /api/connections", () => {
  it("lists the token rows of two projects with who uses them, and their mail accounts read-only", async () => {
    await register({ slug: "alpha", settingsJson: settings({ mail: { accounts: ["Work", "Apple Only"], addresses: [] } }) }, { slug: "beta", settingsJson: settings({ notion: { tokenFile: "beta-token", databases: [] } }) });
    const { status, body } = await list(app({ mail: async () => ({ state: "answered", accounts: ["work", "me@example.test"] }) }));
    expect(status).toBe(200);
    expect(body.connections.map((c) => c.id)).toEqual(["notion:beta-token", "notion:notion-token", "telegram:bot"]);
    expect(body.mail).toEqual([
      { account: "Apple Only", foundInMail: false, usedBy: ["alpha"] },
      { account: "Work", foundInMail: true, usedBy: ["alpha", "beta"] },
    ]);
    expect(body.mailRead).toEqual({ state: "answered", fix: null });
    expect(row(body.connections, "notion:beta-token")).toMatchObject({ usedBy: ["beta"], secret: { state: "missing" } });
    expect(row(body.connections, "telegram:bot").note).toBe("Use a new bot made in BotFather, never one that has a webhook.");
    expect(body.instance).not.toContain("/");
    expect(calls).toEqual([]);
  });

  it("mail accounts are unknown (null), never a guess, while Mail cannot be asked; an old login file is no row", async () => {
    put("mail-work.json", JSON.stringify({ account: "Work", host: "imap.example.test", user: "me@example.test", pass: "fake-app-pass-4321" }));
    await register({ slug: "alpha" });
    const { body, text } = await list(app());
    expect(body.mail).toEqual([{ account: "Work", foundInMail: null, usedBy: ["alpha"] }]);
    expect(body.mailRead).toEqual({ state: "not-running", fix: null });
    expect(body.connections.some((c) => c.id.startsWith("mail"))).toBe(false);
    expect(text).not.toContain("fake-app-pass");
  });

  it("asks Apple Mail once per minute, and never when Mail is not running", async () => {
    const seen: string[] = [];
    let running = true;
    const osa = async (script: string) => {
      seen.push(script === RUNNING_SCRIPT ? "running" : script === ACCOUNTS_SCRIPT ? "accounts" : "other");
      if (script === RUNNING_SCRIPT) return String(running);
      return `Work\x1fme@example.test\x1d\x1e`;
    };
    let t = T0;
    const read = appleMailAccounts({ osa, now: () => t });
    expect(await read()).toEqual({ state: "answered", accounts: ["work", "me@example.test"] });
    expect(await read()).toEqual({ state: "answered", accounts: ["work", "me@example.test"] });
    expect(seen).toEqual(["running", "accounts"]);
    running = false;
    t = new Date(T0.getTime() + 61_000);
    expect(await read()).toEqual({ state: "not-running" });
    expect(seen).toEqual(["running", "accounts", "running"]);
  });

  it("a Mail that does not answer is its own state with a fix line, kept a minute, and the rest of the page still comes back", async () => {
    // Measured 2026-11-19: Mail held AppleEvents (-1712 after 2 min) and GET /api/connections stayed open past 60 s.
    let asked = 0;
    const osa = async (script: string) => {
      if (script === RUNNING_SCRIPT) return "true";
      asked++;
      throw new MailNotAnswering(5_000);
    };
    const read = appleMailAccounts({ osa, now: () => now });
    await register({ slug: "alpha" });
    const { status, body } = await list(app({ mail: read }));
    expect(status).toBe(200);
    expect(body.mail).toEqual([{ account: "Work", foundInMail: null, usedBy: ["alpha"] }]);
    expect(body.mailRead.state).toBe("not-answering");
    expect(body.mailRead.fix).toMatch(/Quit Mail/);
    expect(body.connections.map((c) => c.id)).toContain("notion:notion-token");
    await list(app({ mail: read }));
    expect(asked).toBe(1);
  });

  it("the real runner cuts a read at its budget and says Mail is not answering", async () => {
    const { osaWithin } = await import("@hub/mail-app/osa");
    const started = Date.now();
    // `delay 5` never reaches Mail: it only proves the cut. osascript runs on macOS only.
    if (process.platform !== "darwin") return;
    await expect(osaWithin(300)("delay 5", [])).rejects.toBeInstanceOf(MailNotAnswering);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("is the same data as inspect() for the same folder", async () => {
    await register({ slug: "alpha" });
    const { body } = await list(app());
    const rows = inspect({ dir, env: {}, projects: [{ slug: "alpha", notionTokenFile: "notion-token" }], telegram: { state: "off", reason: "no bot token file" } });
    expect(body.connections.map(({ check: _c, ...r }) => r)).toEqual(rows.map((r) => ({ ...r })));
  });

  it("NOTION_TOKEN shows as from-env; a loose file as unsafe-mode", async () => {
    put("telegram-bot-token", TG, 0o644);
    const { body } = await list(app({ env: { NOTION_TOKEN: NOTION } }));
    expect(row(body.connections, "notion:notion-token").secret.state).toBe("from-env");
    expect(row(body.connections, "telegram:bot")).toMatchObject({ secret: { state: "unsafe-mode" }, can: ["set", "remove"] });
  });

  it("the schema cannot carry a value: a stray field fails the parse", () => {
    const { body } = { body: connectionDto.parse({ id: "x", kind: "notion", label: "l", secret: { state: "stored" }, identity: null, usedBy: [], can: [], check: { state: "never" } }) };
    expect(connectionDto.safeParse({ ...body, value: NOTION }).success).toBe(false);
    expect(connectionDto.safeParse({ ...body, secret: { state: "stored", value: NOTION } }).success).toBe(false);
  });
});

describe("POST /api/connections/:id/test", () => {
  it("a stub probe makes the row fresh with the provider's public name, and no secret appears anywhere", async () => {
    await register({ slug: "alpha" });
    const a = app();
    const r = await test(a, "notion:notion-token");
    expect(r.status).toBe(200);
    expect(connectionDto.parse(r.json)).toMatchObject({ identity: "Hub bot", check: { state: "fresh", asOf: T0.toISOString(), value: { identity: "Hub bot" } } });
    const after = await list(a);
    expect(row(after.body.connections, "notion:notion-token").check.state).toBe("fresh");
    for (const t of [r.text, after.text]) for (const s of ALL) expect(t).not.toContain(s);
  });

  it("a rejected probe gives an error with a fix line and none of the provider's text", async () => {
    const a = app({ status: 401 });
    const r = connectionDto.parse((await test(a, "notion:notion-token")).json);
    expect(r.check).toMatchObject({ state: "error", code: "token-rejected", fix: "Replace the token in this row with a working integration token." });
    expect(JSON.stringify(r)).not.toContain(NOTION);
  });

  it("unreachable is its own code and asks for a retry", async () => {
    const a = testApp(repos, { projects, now: () => now, connections: { dir: () => dir, env: {}, deps: { fetch: (async () => { throw new TypeError(`boom ${NOTION}`); }) as unknown as typeof fetch } } });
    const r = await test(a, "notion:notion-token");
    expect(r.text).not.toContain(NOTION);
    expect(connectionDto.parse(r.json).check).toMatchObject({ state: "error", code: "unreachable", fix: "Check the network, then Test again." });
  });

  it("a second test within 30 s shares the first; after that it probes again", async () => {
    const a = app();
    await test(a, "notion:notion-token");
    await test(a, "notion:notion-token");
    expect(calls).toHaveLength(1);
    now = new Date(T0.getTime() + 31_000);
    await test(a, "notion:notion-token");
    expect(calls).toHaveLength(2);
  });

  it("two tests in flight at once make one probe", async () => {
    const a = app();
    await Promise.all([test(a, "notion:notion-token"), test(a, "notion:notion-token")]);
    expect(calls).toHaveLength(1);
  });

  it("a result is stale after an hour and is dropped when the secret changes", async () => {
    const a = app();
    await test(a, "notion:notion-token");
    now = new Date(T0.getTime() + 61 * 60_000);
    expect(row((await list(a)).body.connections, "notion:notion-token").check.state).toBe("stale");
    put("notion-token", "ntn_SECONDFAKEVALUE1234567");
    const future = new Date(Date.now() + 5000);
    (await import("node:fs")).utimesSync(join(dir, "notion-token"), future, future);
    expect(row((await list(a)).body.connections, "notion:notion-token").check.state).toBe("never");
  });

  it("refuses what has nothing to test (409), an unknown id or a mail account (404)", async () => {
    await register({ slug: "alpha" });
    const a = app();
    expect((await test(a, "telegram:bot")).status).toBe(409);
    expect((await test(a, "mail:work")).status).toBe(404);
    expect((await test(a, "mail:ghost")).status).toBe(404);
    expect((await test(a, "whatsapp")).status).toBe(404);
    expect((await test(a, "notion:..%2Fx")).status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("logs nothing that holds a secret", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const cap = captureOps();
    const a = app({ status: 401 });
    await list(a); await test(a, "notion:notion-token");
    const out = JSON.stringify([...spy.mock.calls, ...log.mock.calls, ...cap.lines]);
    for (const s of ALL) expect(out).not.toContain(s);
    spy.mockRestore(); log.mockRestore(); cap.stop();
  });

  it("writes no file and leaves the secrets folder as it was", async () => {
    const before = readdirSync(dir).sort();
    const a = app();
    await list(a); await test(a, "notion:notion-token");
    expect(readdirSync(dir).sort()).toEqual(before);
  });
});

describe("HUB_CONNECTIONS_PROBE=fake", () => {
  it("the stubs accept a key, and refuse one that contains REJECT, through the real probe code", async () => {
    const a = testApp(repos, { projects, now: () => now, connections: { dir: () => dir, env: {}, deps: fakeProbeDeps() } });
    expect(connectionDto.parse((await test(a, "notion:notion-token")).json).check.state).toBe("fresh");
    put("notion-token", "ntn_REJECTEDFAKEVALUE1234567");
    const future = new Date(Date.now() + 5000);
    (await import("node:fs")).utimesSync(join(dir, "notion-token"), future, future);
    expect(connectionDto.parse((await test(a, "notion:notion-token")).json).check.state).toBe("error");
  });
});

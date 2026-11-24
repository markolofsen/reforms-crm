import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { FakeAdapter } from "@hub/messengers";
import { testApp } from "../support/runtime";
import { startMessengers } from "../../src/messengers/bot";

const TOKEN = "1234567:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
let handle: DbHandle;
let repos: Repos;
const dir = mkdtempSync(join(tmpdir(), "hub-msg-"));
const tokenFile = (body = TOKEN) => {
  const f = join(dir, `t-${Math.random().toString(36).slice(2)}`);
  writeFileSync(f, body);
  return f;
};
const sync = (slugs: string[]) =>
  repos.projects.replaceRegistry({ projects: slugs.map((slug) => ({ slug, name: slug, status: "active", settingsJson: "{}", hash: slug })), addresses: [] });

beforeEach(() => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
});
afterEach(() => handle.close());

describe("messengers in the server", () => {
  it("is off without a token file, and health says why", async () => {
    await sync(["p"]);
    const h = await startMessengers({ repos, env: {}, tokenFile: join(dir, "missing") });
    expect(h.status()).toMatchObject({ state: "off", reason: "no bot token file" });
    const res = await testApp(repos, { messengers: h.status }).request("http://127.0.0.1:4317/api/health");
    expect(await res.json()).toMatchObject({ ok: true, messengers: { state: "off" } });
  });

  it("health defaults to off when nothing was started", async () => {
    const res = await testApp(repos).request("http://127.0.0.1:4317/api/health");
    expect(await res.json()).toMatchObject({ ok: true, messengers: { state: "off" } });
  });

  it("is off for a malformed token, for HUB_MESSENGERS=off, and without a unique project", async () => {
    await sync(["p"]);
    expect((await startMessengers({ repos, env: {}, tokenFile: tokenFile("nope") })).status().reason).toMatch(/not a Telegram token/);
    expect((await startMessengers({ repos, env: { HUB_MESSENGERS: "off" }, tokenFile: tokenFile() })).status().reason).toBe("HUB_MESSENGERS=off");
    await sync(["a", "b"]);
    expect((await startMessengers({ repos, env: {}, tokenFile: tokenFile() })).status().reason).toMatch(/HUB_MESSENGERS_PROJECT/);
    expect((await startMessengers({ repos, env: { HUB_MESSENGERS_PROJECT: "zzz" }, tokenFile: tokenFile() })).status().reason).toMatch(/not registered/);
  });

  it("polls with a receive-only adapter and reports running, then stops", async () => {
    await sync(["p"]);
    const fake = new FakeAdapter();
    let seen: unknown;
    const h = await startMessengers({
      repos,
      env: {},
      tokenFile: tokenFile(),
      adapterFor: () => ((seen = fake), fake),
      runner: async (d) => {
        d.onEvent?.({ type: "poll", result: { fetched: 0, cursor: null, stored: 2, chats: [], duplicates: 0, dropped: [], edited: 0 } });
        await new Promise<void>((r) => d.signal?.addEventListener("abort", () => r()));
      },
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toBe(fake);
    expect(h.status()).toMatchObject({ state: "running", project: "p", stored: 2 });
    expect(h.status().lastPollAt).toBeTruthy();
    await h.stop();
    expect(h.status().state).toBe("stopped");
  });

  it("a fatal error ends in error with the token redacted", async () => {
    await sync(["p"]);
    const h = await startMessengers({
      repos,
      env: {},
      tokenFile: tokenFile(),
      adapterFor: () => new FakeAdapter(),
      runner: async () => {
        throw new Error(`unauthorized ${TOKEN}`);
      },
    });
    await h.done;
    expect(h.status().state).toBe("error");
    expect(JSON.stringify(h.status())).not.toContain("AAAAAAAA");
  });
});

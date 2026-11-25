import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Repos } from "@hub/db";
import { createLlm, fakeTransport, memoryLedger } from "@hub/llm";
import { startWatch, type WatchDomain } from "../../src/watch/start";
import { watchRoutes } from "../../src/watch/routes";

// P144 W6: the Watch routes over a started domain (the core's acme fixture lens, no Telegram account, no timers). Nothing here
// reaches Telegram: with no account the watcher has no reader, so Join is refused in words.

const lenses = resolve(import.meta.dirname, "../../../../packages/watch/test/fixtures/packages");
const ADMIN = 5174;
let domain: WatchDomain | undefined;
afterEach(() => domain?.stop());

async function setup(watchMd: string | null) {
  const home = mkdtempSync(join(tmpdir(), "hub-watch-routes-"));
  const projects = join(home, "projects");
  mkdirSync(join(projects, "acme"), { recursive: true });
  if (watchMd !== null) writeFileSync(join(projects, "acme", "watch.md"), watchMd);
  const llm = createLlm({ ledger: memoryLedger(), transport: fakeTransport(() => ({ content: "{}" })) });
  domain = await startWatch({ repos: {} as Repos, paths: { projects, instancePackages: lenses, watch: join(home, "data", "watch") }, telegram: () => undefined, bump: () => undefined, llm, timers: false });
  return watchRoutes({ domain, adminPort: ADMIN, now: () => new Date("2026-11-25T10:00:00Z"), monthCost: async () => 0 });
}

const list = (lens: string) => `# Watch\n\n| Setting | Value |\n|---|---|\n| lens | ${lens} |\n\n## Groups\n\n- @garden_talk\n- @tools_and_more\n`;

describe("the Watch routes", () => {
  it("list the watching project and answer its page, off by default", async () => {
    const app = await setup(list("watch-acme"));
    const projects = await (await app.request("/api/watch")).json();
    expect(projects).toMatchObject({ projects: [{ slug: "acme", lens: expect.any(String), standing: { state: "off" } }] });
    const r = await app.request("/api/projects/acme/watch?days=7");
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toMatchObject({ slug: "acme", lens: { id: "acme" }, days: 7, standing: { state: "off" }, nextAnalysis: null, moments: [] });
    expect(body.trend.days).toHaveLength(7);
  });

  it("answer 404 for a project without a watch.md, and 503 with the reason for a lens that does not load", async () => {
    let app = await setup(null);
    expect((await app.request("/api/watch")).status).toBe(200);
    expect((await app.request("/api/projects/acme/watch")).status).toBe(404);
    domain?.stop();
    app = await setup(list("watch-missing"));
    const r = await app.request("/api/projects/acme/watch");
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ code: "unavailable", error: expect.stringContaining("watch-missing") });
  });

  it("take Join only through the door, and refuse it in words with no account", async () => {
    const app = await setup(list("watch-acme"));
    const path = "/api/projects/acme/watch/groups/garden_talk/join";
    expect((await app.request(path, { method: "POST" })).status).toBe(403);
    const r = await app.request(`http://127.0.0.1:${ADMIN}${path}`, { method: "POST", headers: { origin: `http://127.0.0.1:${ADMIN}`, host: `127.0.0.1:${ADMIN}`, "sec-fetch-site": "same-origin" } });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: "wrong_state" });
  });
});

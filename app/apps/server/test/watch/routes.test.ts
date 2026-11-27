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

  it("selects an isolated direction and exposes bounded cached context only from its source list", async () => {
    const app = await setup(list("watch-acme") + "\n## Direction tools\n| lens | watch-acme |\n| on | yes |\n### Groups\n- @tools_only\n");
    const p = domain?.project("acme");
    if (p?.state !== "ready") throw new Error("not ready");
    const sentAt = "2026-11-25T09:00:00.000Z";
    const storedAt = new Date("2026-11-25T10:00:00.000Z");
    p.store.addMessages("tools_only", Array.from({ length: 20 }, (_, i) => ({ messageId: i + 1, text: `message ${i + 1}`, senderId: "7", senderHandle: "author", sentAt, replyToMessageId: i === 9 ? 8 : null, threadId: 2 })), storedAt);
    const tools = p.store.forDirection("tools");
    tools.recordWindow({ windowKey: "tools:1-20", groupUsername: "tools_only", firstMessageId: 1, lastMessageId: 20, messages: 20, taskVersion: 1, model: "fake", costMicroUsd: 1, topics: ["tools"], mood: "calm", firstAt: sentAt, lastAt: sentAt },
      [{ groupUsername: "tools_only", messageId: 10, trigger: "broken_tool", triggerOther: "", intensity: 4, quote: "my mower died", authorId: "7", authorHandle: "author", reactorHandles: [], context: "garden", why: "tools", windowKey: "tools:1-20", at: sentAt }], storedAt);
    const body = await (await app.request("/api/projects/acme/watch?direction=tools")).json();
    expect(body).toMatchObject({ direction: "tools", lens: { version: 1 }, freshness: { lastMessageAt: sentAt, lastStoredAt: storedAt.toISOString() }, moments: [{ group: "tools_only", messageId: 10 }] });
    expect((await (await app.request("/api/projects/acme/watch")).json()).moments).toEqual([]);
    const context = await app.request("/api/projects/acme/watch/context?direction=tools&group=tools_only&messageId=10");
    expect(context.status).toBe(200);
    const detail = await context.json();
    expect(detail.contextKind).toBe("chronological");
    expect(detail.messages).toHaveLength(13);
    expect(detail.messages[0].messageId).toBe(4);
    expect(detail.messages[6]).toMatchObject({ messageId: 10, replyToMessageId: 8, threadId: 2 });
    expect((await app.request("/api/projects/acme/watch/context?direction=default&group=tools_only&messageId=10")).status).toBe(404);
    expect((await app.request("/api/projects/acme/watch/context?direction=tools&group=tools_only&messageId=999")).status).toBe(404);
  });

  it("fails closed for unknown or broken named directions without disabling the default", async () => {
    const app = await setup(list("watch-acme") + "\n## Direction broken\n| lens | watch-missing |\n### Groups\n- @garden_talk\n");
    expect((await app.request("/api/projects/acme/watch")).status).toBe(200);
    expect((await app.request("/api/projects/acme/watch?direction=unknown")).status).toBe(404);
    expect((await app.request("/api/projects/acme/watch?direction=broken")).status).toBe(503);
    expect((await app.request("/api/projects/acme/watch/context?direction=unknown&group=garden_talk&messageId=1")).status).toBe(404);
  });
});

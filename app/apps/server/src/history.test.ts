import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { historyDto } from "@hub/contract/review";
import { testApp } from "./test-support/runtime";

// The client's history holds the messenger rows the hub stored; it reads no mail (decision 0026).
const ANNA = "anna@example.test";
let handle: DbHandle;
let repos: Repos;
let clientId: number;
const URL = (id: number, q = "project=p") => `http://127.0.0.1:4317/api/clients/${id}/history?${q}`;

beforeEach(async () => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  await repos.projects.replaceRegistry({
    projects: [{ slug: "p", name: "P", status: "active", settingsJson: JSON.stringify({ mail: { accounts: ["Google"], addresses: ["me@example.test"] } }), hash: "h" }],
    addresses: [],
  });
  clientId = await repos.clients.create({ project: "p", email: ANNA, name: "Anna" });
});
afterEach(() => handle.close());

const say = (id: string, sentAt: string, text: string) =>
  repos.messengers.insertMessage({ project: "p", channel: "telegram_bot", account: "1", chatId: "100", remoteMessageId: id, direction: "in", kind: "text", text, sentAt, retainUntil: "2027-12-31T00:00:00.000Z" });
const get = async (url: string) => {
  const r = await testApp(repos).request(url);
  return { status: r.status, body: (await r.json()) as unknown };
};

describe("GET /api/clients/:id/history", () => {
  it("serves the linked chat's messenger rows, newest first, in the contract's shape", async () => {
    await repos.messengers.addIdentifier("p", clientId, "telegram", "100");
    await say("1", "2026-11-11T10:00:00.000Z", "tg one");
    await say("2", "2026-11-12T10:00:00.000Z", "tg two");
    const { status, body } = await get(URL(clientId));
    expect(status).toBe(200);
    const h = historyDto.parse(body);
    expect(h.items.map((i) => [i.source, i.text])).toEqual([["messenger", "tg two"], ["messenger", "tg one"]]);
    expect(Object.keys(body as object)).not.toContain("mailUnavailable");
  });

  it("pages with the cursor", async () => {
    await repos.messengers.addIdentifier("p", clientId, "telegram", "100");
    for (const [i, d] of ["10", "11", "12"].entries()) await say(String(i), `2026-11-${d}T10:00:00.000Z`, `tg${d}`);
    const p1 = historyDto.parse((await get(URL(clientId, "project=p&limit=2"))).body);
    expect(p1.items.map((i) => i.text)).toEqual(["tg12", "tg11"]);
    const p2 = historyDto.parse((await get(URL(clientId, `project=p&limit=2&cursor=${p1.nextCursor}`))).body);
    expect(p2.items.map((i) => i.text)).toEqual(["tg10"]);
    expect(p2.nextCursor).toBeUndefined();
  });

  it("a client with no linked chat has an empty history", async () => {
    expect((await get(URL(clientId))).body).toEqual({ items: [] });
  });

  it("is project-scoped: another project's client is 404, a bad cursor is 400, bad input is 400", async () => {
    expect((await get(URL(clientId, "project=other"))).status).toBe(404);
    expect((await get(URL(99999))).status).toBe(404);
    expect((await get(URL(clientId, "project=p&cursor=junk"))).status).toBe(400);
    expect((await get(URL(clientId, "project=p&limit=0"))).status).toBe(400);
    expect((await get(URL(clientId, ""))).status).toBe(400);
  });

  it("is refused for a foreign host like every route", async () => {
    expect((await testApp(repos).request(`http://evil.example/api/clients/${clientId}/history?project=p`)).status).toBe(403);
  });
});

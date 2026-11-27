import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepos, openDb, type DbHandle } from "@hub/db";
import { FakeMailer } from "@hub/send/mailer";
import { watchActionRoutes } from "../src/send/watch-actions-routes";

const actions = vi.hoisted(() => ({ context: vi.fn(), propose: vi.fn(), get: vi.fn(), send: vi.fn(), reconcile: vi.fn() }));
vi.mock("../src/send/watch-actions", () => ({ watchActions: () => actions }));
const ID = "a".repeat(64);
const HASH = "b".repeat(64);
const base = "/api/projects/acme/watch/actions";
let db: DbHandle;
let app: ReturnType<typeof watchActionRoutes>;
const headers = { "content-type": "application/json", "x-hub-agent-token": "fixture-local-cli-token" };

beforeEach(() => {
  vi.resetAllMocks();
  db = openDb(":memory:");
  app = watchActionRoutes({ repos: createRepos(db.db), sender: { mailer: new FakeMailer(), projectsDir: "/fixture/projects",
    policyDir: "/fixture/state/projects", allowList: [], adminPort: 5173, agent: { token: headers["x-hub-agent-token"], events: () => [] } } });
  actions.send.mockResolvedValue({ status: "sent", proposalId: ID, sendId: 1, messageId: "500", reason: null });
  actions.reconcile.mockResolvedValue({ status: "sent", proposalId: ID, sendId: 1, messageId: "500", reason: null });
});
afterEach(() => db.close());

describe("public actions are a token-protected local CLI surface", () => {
  it("refuses every read and mutation without the token before invoking the service", async () => {
    for (const { method, path } of [{ method: "GET", path: "/context" }, { method: "POST", path: "/proposals" }, { method: "GET", path: `/proposals/${ID}` },
      { method: "POST", path: `/proposals/${ID}/send` }, { method: "POST", path: `/proposals/${ID}/reconcile` }]) {
      const res = await app.request(`http://127.0.0.1:4317${base}${path}`, { method });
      expect(res.status).toBe(403);
    }
    for (const call of Object.values(actions)) expect(call).not.toHaveBeenCalled();
  });

  it("passes only an exact proposal/hash and rejects caller-supplied authority or raw peer", async () => {
    const path = `http://127.0.0.1:4317${base}/proposals/${ID}/send`;
    const bad = await app.request(path, { method: "POST", headers, body: JSON.stringify({ textHash: HASH, authority: "owner", chatId: -1 }) });
    expect(bad.status).toBe(400);
    expect(actions.send).not.toHaveBeenCalled();
    const sent = await app.request(path, { method: "POST", headers, body: JSON.stringify({ textHash: HASH }) });
    expect(sent.status).toBe(200);
    expect(actions.send).toHaveBeenCalledExactlyOnceWith("acme", ID, HASH);
  });

  it("keeps an uncertain result explicit and reconciliation has no send operation", async () => {
    actions.send.mockResolvedValueOnce({ status: "uncertain", proposalId: ID, sendId: 1, messageId: null, reason: "DELIVERY_UNKNOWN" });
    const sent = await app.request(`http://127.0.0.1:4317${base}/proposals/${ID}/send`, { method: "POST", headers, body: JSON.stringify({ textHash: HASH }) });
    expect(sent.status).toBe(202);
    expect(await sent.json()).toMatchObject({ status: "uncertain", reason: "DELIVERY_UNKNOWN" });
    const resolved = await app.request(`http://127.0.0.1:4317${base}/proposals/${ID}/reconcile`, { method: "POST", headers, body: JSON.stringify({ messageId: 500 }) });
    expect(resolved.status).toBe(200);
    expect(actions.reconcile).toHaveBeenCalledExactlyOnceWith("acme", ID, 500);
    expect(actions.send).toHaveBeenCalledTimes(1);
  });
});

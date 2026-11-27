import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepos, openDb, type DbHandle } from "@hub/db";
import { FakeMailer } from "@hub/send/mailer";
import { watchReviewPreparedDto } from "@hub/contract/watch-review";
import { watchReviewRoutes } from "../../src/send/watch-review/routes";
import { AT, ID, PAYLOAD, POLICY, reviewFixture } from "./fixtures";

const actions = vi.hoisted(() => ({ list: vi.fn(), review: vi.fn(), photo: vi.fn(), send: vi.fn(), reconcileKnown: vi.fn(), propose: vi.fn(), context: vi.fn() }));
vi.mock("../../src/send/watch-actions", () => ({ watchActions: () => actions }));
const base = "http://127.0.0.1:4317/api/projects/acme/watch/proposals";
const headers = { "content-type": "application/json", origin: "http://127.0.0.1:5173", "sec-fetch-site": "same-origin" };
let db: DbHandle;
let app: ReturnType<typeof watchReviewRoutes>;
let clock: number;
const post = (path: string, body: unknown, h: Record<string, string> = headers) =>
  app.request(path, { method: "POST", headers: h, body: JSON.stringify(body) });
const prepare = async () => watchReviewPreparedDto.parse(await (await post(`${base}/${ID}/prepare`, { payloadHash: PAYLOAD })).json());

beforeEach(() => {
  vi.resetAllMocks();
  clock = Date.parse(AT);
  db = openDb(":memory:");
  app = watchReviewRoutes({ repos: createRepos(db.db), sender: { mailer: new FakeMailer(), projectsDir: "/fixture/projects",
    policyDir: "/fixture/state/projects", allowList: [], adminPort: 5173, now: () => new Date(clock) } });
  actions.review.mockImplementation(async () => reviewFixture());
  actions.list.mockResolvedValue({ project: "acme", direction: "default", group: "public_group", messageId: 70, observedAt: AT, items: [reviewFixture()] });
  actions.send.mockResolvedValue({ status: "sent", proposalId: ID, sendId: 9, messageId: "500", reason: null });
  actions.reconcileKnown.mockResolvedValue({ status: "sent", proposalId: ID, sendId: 9, messageId: "500", reason: null });
});
afterEach(() => db.close());

describe("browser public proposal review", () => {
  it("reads stored source versions and an existing review without preparing, inspecting or sending", async () => {
    expect((await app.request(`${base}?direction=default&group=public_group&messageId=70`)).status).toBe(200);
    expect(actions.list).toHaveBeenCalledExactlyOnceWith("acme", { direction: "default", group: "public_group", messageId: 70 });
    expect((await app.request(`${base}/${ID}`)).status).toBe(200);
    expect(actions.review).toHaveBeenCalledExactlyOnceWith("acme", ID);
    for (const call of [actions.propose, actions.context, actions.send, actions.reconcileKnown]) expect(call).not.toHaveBeenCalled();
    expect((await post(base, { rulesAccepted: true, text: "browser-generated" })).status).toBe(404);
  });

  it("refuses missing/foreign origins and another port before any mutation service call", async () => {
    for (const h of [{ "content-type": "application/json" }, { ...headers, origin: "http://127.0.0.1:9999" },
      { ...headers, "sec-fetch-site": "same-site" }, { ...headers, host: "outside.example.test" }]) {
      for (const suffix of ["prepare", "send", "reconcile"]) expect((await post(`${base}/${ID}/${suffix}`, {}, h)).status).toBe(403);
    }
    for (const call of Object.values(actions)) expect(call).not.toHaveBeenCalled();
  });

  it("prepares the exact immutable payload with a fresh check, without invoking propose or send", async () => {
    const prepared = await prepare();
    expect(actions.review).toHaveBeenCalledExactlyOnceWith("acme", ID, true);
    expect(prepared).toMatchObject({ review: reviewFixture(), payloadHash: PAYLOAD, policyGeneration: POLICY,
      expiresAt: "2026-11-27T12:01:00.000Z" });
    expect(actions.send).not.toHaveBeenCalled();
    expect(actions.propose).not.toHaveBeenCalled();
  });

  it("cannot prepare a changed payload, a stale review or a changed protected generation", async () => {
    expect((await post(`${base}/${ID}/prepare`, { payloadHash: "1".repeat(64) })).status).toBe(409);
    actions.review.mockResolvedValueOnce({ ...reviewFixture(), state: "stale", canPrepare: false, reasons: ["the source changed"] });
    expect((await post(`${base}/${ID}/prepare`, { payloadHash: PAYLOAD })).status).toBe(409);
    actions.review.mockResolvedValueOnce({ ...reviewFixture(), currentPolicyGeneration: "2".repeat(64) });
    expect((await post(`${base}/${ID}/prepare`, { payloadHash: PAYLOAD })).status).toBe(409);
    expect(actions.send).not.toHaveBeenCalled();
  });

  it("binds each ticket to project, proposal, payload and policy; wrong use also spends it", async () => {
    for (const wrong of [
      { path: base.replace("/acme/", "/other/") + `/${ID}/send`, payloadHash: PAYLOAD, policyGeneration: POLICY },
      { path: `${base}/${"1".repeat(64)}/send`, payloadHash: PAYLOAD, policyGeneration: POLICY },
      { path: `${base}/${ID}/send`, payloadHash: "2".repeat(64), policyGeneration: POLICY },
      { path: `${base}/${ID}/send`, payloadHash: PAYLOAD, policyGeneration: "3".repeat(64) },
    ]) {
      const { ticket } = await prepare();
      const { path, ...binding } = wrong;
      expect((await post(path, { ticket, ...binding })).status).toBe(403);
      expect((await post(`${base}/${ID}/send`, { ticket, payloadHash: PAYLOAD, policyGeneration: POLICY })).status).toBe(403);
    }
    expect(actions.send).not.toHaveBeenCalled();
  });

  it("expires a confirmation after 60 seconds without touching the public door", async () => {
    const { ticket } = await prepare();
    clock += 60_000;
    expect((await post(`${base}/${ID}/send`, { ticket, payloadHash: PAYLOAD, policyGeneration: POLICY })).status).toBe(403);
    expect(actions.send).not.toHaveBeenCalled();
  });

  it("consumes a ticket before async delivery, so concurrent requests invoke the door once", async () => {
    const { ticket } = await prepare();
    let finish: (() => void) | undefined;
    actions.send.mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => resolve({ status: "sent", proposalId: ID, sendId: 9, messageId: "500", reason: null });
    }));
    const body = { ticket, payloadHash: PAYLOAD, policyGeneration: POLICY };
    const first = post(`${base}/${ID}/send`, body);
    await vi.waitFor(() => expect(actions.send).toHaveBeenCalledTimes(1));
    expect((await post(`${base}/${ID}/send`, body)).status).toBe(403);
    finish?.();
    expect((await first).status).toBe(200);
    expect(actions.send).toHaveBeenCalledExactlyOnceWith("acme", ID, PAYLOAD);
  });

  it("preserves unknown delivery as an explicit outcome and never turns a refusal into Sent", async () => {
    const prepared = await prepare();
    actions.send.mockResolvedValueOnce({ status: "uncertain", proposalId: ID, sendId: 9, messageId: null, reason: "DELIVERY_UNKNOWN" });
    const result = await post(`${base}/${ID}/send`, { ticket: prepared.ticket, payloadHash: PAYLOAD, policyGeneration: POLICY });
    expect(result.status).toBe(202);
    expect(await result.json()).toMatchObject({ status: "uncertain", reason: "DELIVERY_UNKNOWN" });
    const next = await prepare();
    actions.send.mockResolvedValueOnce({ refused: ["Stop sending is on"] });
    const refused = await post(`${base}/${ID}/send`, { ticket: next.ticket, payloadHash: PAYLOAD, policyGeneration: POLICY });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "wrong_state", refused: ["Stop sending is on"] });
  });

  it("reconciles only the stored receipt and rejects caller-supplied ids or review authority", async () => {
    expect((await post(`${base}/${ID}/reconcile`, { messageId: 500 })).status).toBe(400);
    expect((await post(`${base}/${ID}/prepare`, { payloadHash: PAYLOAD, rulesAccepted: true })).status).toBe(400);
    expect(actions.reconcileKnown).not.toHaveBeenCalled();
    expect((await post(`${base}/${ID}/reconcile`, {})).status).toBe(200);
    expect(actions.reconcileKnown).toHaveBeenCalledExactlyOnceWith("acme", ID);
    expect(actions.send).not.toHaveBeenCalled();
  });

  it("previews only a server-resolved proposal asset with non-executable, uncached image headers", async () => {
    actions.photo.mockResolvedValueOnce({ bytes: new Uint8Array([137, 80, 78, 71]), mime: "image/png" });
    const image = await app.request(`${base}/${ID}/photo?path=/outside&url=https://outside.example.test`);
    expect(image.status).toBe(200);
    expect(actions.photo).toHaveBeenCalledExactlyOnceWith("acme", ID);
    expect(Object.fromEntries(image.headers)).toMatchObject({ "content-type": "image/png", "x-content-type-options": "nosniff",
      "cache-control": "no-store", "cross-origin-resource-policy": "same-origin" });
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
    actions.photo.mockResolvedValueOnce({ refused: ["The reviewed photo changed."] });
    expect((await app.request(`${base}/${ID}/photo`)).status).toBe(409);
    actions.photo.mockResolvedValueOnce(null);
    expect((await app.request(base.replace("/acme/", "/other/") + `/${ID}/photo`)).status).toBe(404);
  });
});

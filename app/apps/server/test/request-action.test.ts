import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { ACTION_HEADER, isActionId } from "@hub/config/action-id";
import { captureOps, ops, resetOps } from "@hub/log/ops";
import { actionOfRequest } from "../src/http/request-action";

// P137 L1: a request runs as one action; the admin's id is kept, anything else replaced; every line inside carries it.
afterEach(() => resetOps());

const app = () =>
  new Hono().use("*", actionOfRequest).get("/api/x", (c) => {
    ops("notion").warn("deep inside");
    return c.json({ ok: true });
  }).get("/api/boom", (c) => c.json({ error: "down" }, 503));

describe("the request's action (P137 L1)", () => {
  it("keeps the admin's id, answers with it, and stamps every line written inside", async () => {
    const cap = captureOps();
    const r = await app().request("/api/x", { headers: { [ACTION_HEADER]: "w-kqzhtrvmab" } });
    cap.stop();
    expect(r.headers.get(ACTION_HEADER)).toBe("w-kqzhtrvmab");
    expect(cap.lines.map((l) => [l.message, l.action])).toEqual([["deep inside", "w-kqzhtrvmab"]]);
  });

  it("replaces a missing or foreign id with its own", async () => {
    const r = await app().request("/api/x", { headers: { [ACTION_HEADER]: "<script>" } });
    const id = r.headers.get(ACTION_HEADER);
    expect(isActionId(id)).toBe(true);
    expect(id?.startsWith("r-")).toBe(true);
  });

  it("a 5xx other than 500 is one warn line under the request's action", async () => {
    const cap = captureOps();
    await app().request("/api/boom", { headers: { [ACTION_HEADER]: "w-kqzhtrvmab" } });
    cap.stop();
    expect(cap.lines).toMatchObject([{ level: "warn", source: "server", message: "503 GET /api/boom", action: "w-kqzhtrvmab" }]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { draftChangedDto as schema } from "@hub/contract/responses";
import { ApiFailure, read } from "../src/lib/api/client";

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("read", () => {
  it("parses a success with the contract schema and sends the query", async () => {
    const fetch = vi.fn(async () => reply(200, { ok: true, draftId: 3 }));
    vi.stubGlobal("fetch", fetch);
    expect(await read(schema, { method: "GET", path: "/api/x", query: { project: "p", skip: undefined, offset: 0 } })).toEqual({ ok: true, draftId: 3 });
    expect(fetch).toHaveBeenCalledWith("/api/x?project=p&offset=0", expect.objectContaining({ method: "GET" }));
  });

  it("turns a refusal into the server's sentence and code", async () => {
    vi.stubGlobal("fetch", async () => reply(409, { error: "Already done", code: "wrong_state" }));
    await expect(read(schema, { method: "POST", path: "/api/x" })).rejects.toMatchObject({ message: "Already done", code: "wrong_state", status: 409 });
  });

  it("fails with a sentence when the server answers in another shape", async () => {
    vi.stubGlobal("fetch", async () => reply(200, { ok: true, draftId: "three" }));
    await expect(read(schema, { method: "GET", path: "/api/x" })).rejects.toBeInstanceOf(ApiFailure);
  });

  it("retries once when the database is busy", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reply(503, { error: "busy", code: "busy" })).mockResolvedValueOnce(reply(200, { ok: true, draftId: 1 }));
    vi.stubGlobal("fetch", fetch);
    expect(await read(schema, { method: "POST", path: "/api/x", body: {} })).toEqual({ ok: true, draftId: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("says the server cannot be reached when the request itself fails", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("failed");
    });
    await expect(read(schema, { method: "GET", path: "/api/x" })).rejects.toMatchObject({ code: "server", status: 0 });
  });
});

import { describe, expect, it } from "vitest";
import { classifyNotionError, COUNT_PAGE_CAP, COUNT_ROW_CAP, countPages } from "../src/count";
import { createNotionReader } from "../src/notion";
import { DS_CLIENTS, FakeReader, makePage, sampleDbs } from "./helpers";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A data source of `total` rows served 100 per request; records every request. */
function stubFetch(total: number, seen: { method: string; path: string }[]) {
  return (async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = new URL(typeof input === "string" ? input : (input as URL | Request).toString());
    seen.push({ method: init?.method ?? "GET", path: url.pathname });
    const body = JSON.parse(init?.body ?? "{}") as { start_cursor?: string };
    const from = body.start_cursor ? Number(body.start_cursor) : 0;
    const to = Math.min(total, from + 100);
    return json({ object: "list", results: Array.from({ length: to - from }, (_, i) => ({ object: "page", id: `p${from + i}`, last_edited_time: "t", properties: {} })), has_more: to < total, next_cursor: to < total ? String(to) : null });
  }) as unknown as typeof fetch;
}

describe("countPages", () => {
  it("counts the rows of a small data source and says it is not capped", async () => {
    const r = new FakeReader(sampleDbs());
    expect(await countPages(r, DS_CLIENTS)).toEqual({ count: 3, capped: false });
    expect(r.calls.retrieveMarkdown).toBe(0);
  });

  it("stops at the cap and says so (stub fetch: 20 requests, not 25)", async () => {
    const seen: { method: string; path: string }[] = [];
    const reader = createNotionReader("t", { fetch: stubFetch(2500, seen), sleep: async () => {} });
    expect(await countPages(reader, "ds1")).toEqual({ count: COUNT_ROW_CAP, capped: true });
    expect(seen.length).toBe(COUNT_PAGE_CAP);
    expect(seen.every((s) => s.method === "POST" && s.path === "/v1/data_sources/ds1/query")).toBe(true);
  });

  it("reads exactly as many requests as the rows need below the cap (250 rows: 3)", async () => {
    const seen: { method: string; path: string }[] = [];
    const reader = createNotionReader("t", { fetch: stubFetch(250, seen), sleep: async () => {} });
    expect(await countPages(reader, "ds1")).toEqual({ count: 250, capped: false });
    expect(seen.length).toBe(3);
  });

  it("returns an empty data source as 0, not capped", async () => {
    const r = new FakeReader({ x: { info: { id: "x", title: "", properties: {} }, pages: [], bodies: {} } });
    expect(await countPages(r, "x")).toEqual({ count: 0, capped: false });
  });

  it("holds nothing of the rows", async () => {
    const r = new FakeReader({ x: { info: { id: "x", title: "", properties: {} }, pages: [makePage("a", "Secret Name")], bodies: {} } });
    expect(JSON.stringify(await countPages(r, "x"))).not.toContain("Secret");
  });
});

describe("classifyNotionError", () => {
  it("names the failure by status or code and never by message", () => {
    expect(classifyNotionError({ status: 401, code: "unauthorized" })).toBe("token-rejected");
    expect(classifyNotionError({ code: "unauthorized" })).toBe("token-rejected");
    expect(classifyNotionError({ status: 404, code: "object_not_found" })).toBe("not-shared");
    expect(classifyNotionError({ status: 403 })).toBe("not-shared");
    expect(classifyNotionError({ status: 503 })).toBe("unreachable");
    expect(classifyNotionError(new Error("fetch failed"))).toBe("unreachable");
    expect(classifyNotionError(new Error("something odd"))).toBe("failed");
    expect(classifyNotionError("x")).toBe("failed");
  });
});

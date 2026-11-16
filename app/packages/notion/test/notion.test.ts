import { describe, expect, it } from "vitest";
import { createNotionReader } from "../src/notion.js";

interface Seen {
  method: string;
  path: string;
  auth: string | null;
}

function fakeFetch(seen: Seen[]) {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  return (async (input: unknown, init?: { method?: string; headers?: Record<string, string> | Headers; body?: string }) => {
    const url = new URL(typeof input === "string" ? input : (input as URL | Request).toString());
    const headers = new Headers(init?.headers as ConstructorParameters<typeof Headers>[0]);
    seen.push({ method: init?.method ?? "GET", path: url.pathname, auth: headers.get("authorization") });
    if (url.pathname === "/v1/data_sources/ds1") {
      return json({ object: "data_source", id: "ds1", title: [{ plain_text: "Cli" }, { plain_text: "ents" }], properties: { Name: { type: "title" } } });
    }
    if (url.pathname === "/v1/data_sources/ds1/query") {
      const body = JSON.parse(init?.body ?? "{}") as { start_cursor?: string };
      return body.start_cursor
        ? json({ object: "list", results: [{ object: "page", id: "p3", last_edited_time: "t", properties: {} }], has_more: false, next_cursor: null })
        : json({
            object: "list",
            results: [
              { object: "page", id: "p1", last_edited_time: "t", properties: {} },
              { object: "page", id: "p2", last_edited_time: "t", properties: {} },
            ],
            has_more: true,
            next_cursor: "c2",
          });
    }
    if (url.pathname === "/v1/pages/p1/markdown") {
      return json({ object: "page_markdown", id: "p1", markdown: "# Hi\n", truncated: true, unknown_block_ids: ["b1"] });
    }
    return new Response(JSON.stringify({ object: "error", status: 404, code: "object_not_found", message: "no" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("createNotionReader (stubbed fetch, no network)", () => {
  it("retrieves a data source, pages to the end and reads markdown, with nothing but reads", async () => {
    const seen: Seen[] = [];
    const reader = createNotionReader("ntn\u005ftest_token", { fetch: fakeFetch(seen), sleep: async () => {} });

    const info = await reader.retrieveDataSource("ds1");
    expect(info).toEqual({ id: "ds1", title: "Clients", properties: { Name: { type: "title" } } });

    const ids: string[] = [];
    for await (const page of reader.listPages("ds1")) ids.push(page.id);
    expect(ids).toEqual(["p1", "p2", "p3"]);

    expect(await reader.retrieveMarkdown("p1")).toEqual({ markdown: "# Hi\n", truncated: true, unknownBlockIds: ["b1"] });

    const writes = seen.filter((s) => s.method !== "GET" && !s.path.endsWith("/query"));
    expect(writes).toEqual([]);
    expect(seen.filter((s) => s.method !== "GET").every((s) => s.path === "/v1/data_sources/ds1/query")).toBe(true);
    expect(seen.every((s) => s.auth === `Bearer ${"ntn"}\u005ftest_token`)).toBe(true);
  });

  it("waits between requests (about 3 per second by default)", async () => {
    const seen: Seen[] = [];
    let now = 0;
    const slept: number[] = [];
    const reader = createNotionReader("t", {
      fetch: fakeFetch(seen),
      now: () => now,
      sleep: async (ms) => {
        slept.push(ms);
        now += ms;
      },
    });
    await reader.retrieveDataSource("ds1");
    await reader.retrieveMarkdown("p1");
    await reader.retrieveMarkdown("p1");
    expect(slept).toEqual([334, 334]);
  });
});

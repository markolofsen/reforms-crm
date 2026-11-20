import { describe, expect, it } from "vitest";
import { createStampWriter, readClientStamp, stampClientSend, STAMP_FIELDS, type StampWriter } from "../src/stamp";
import type { NotionReader, PageObject, PropertyConfig } from "../src/types";

// P89: the Hub's one Notion write, Last sent at / Last sent by on the client's page after a confirmed send.
const page = (id: string, mail: string): PageObject => ({ id, last_edited_time: "2026-11-20T00:00:00.000Z", properties: { Email: { type: "email", email: mail } } });

function reader(props: Record<string, PropertyConfig>, pages: PageObject[]): NotionReader {
  return {
    retrieveDataSource: async (id) => ({ id, title: "Clients", properties: { Name: { type: "title" }, Email: { type: "email" }, ...props } }),
    async *listPages() { yield* pages; },
    findPages: async () => pages,
    retrieveMarkdown: async () => ({ markdown: "", truncated: false, unknownBlockIds: [] }),
  };
}
const FIELDS = { [STAMP_FIELDS.at]: { type: "date" }, [STAMP_FIELDS.by]: { type: "rich_text" } };
const recorder = (): StampWriter & { calls: unknown[][] } => { const calls: unknown[][] = []; return { calls, stamp: async (...a) => { calls.push(a); } }; };

describe("stampClientSend", () => {
  it("stamps the client found by the recipient's address with the time and the sender's name", async () => {
    const w = recorder();
    const r = await stampClientSend({ reader: reader(FIELDS, [page("p1", "ann@x.example")]), writer: w }, { clientsDataSource: "ds", email: "Ann@X.example", at: "2026-11-20T10:00:00.000Z", by: "Anna" });
    expect(r).toEqual({ state: "stamped", pageId: "p1" });
    expect(w.calls).toEqual([["p1", "2026-11-20T10:00:00.000Z", "Anna"]]);
  });
  it("writes nothing when the fields are missing (Notion not updated yet), or the address is no client", async () => {
    const w = recorder();
    const missing = await stampClientSend({ reader: reader({ [STAMP_FIELDS.at]: { type: "date" } }, [page("p1", "ann@x.example")]), writer: w }, { clientsDataSource: "ds", email: "ann@x.example", at: "x", by: "A" });
    expect(missing).toMatchObject({ state: "skipped", reason: "fields_missing", detail: 'the Clients database has no "Last sent by" (text)' });
    const stranger = await stampClientSend({ reader: reader(FIELDS, [page("p1", "ann@x.example")]), writer: w }, { clientsDataSource: "ds", email: "bob@x.example", at: "x", by: "A" });
    expect(stranger).toMatchObject({ state: "skipped", reason: "not_client" });
    expect(w.calls).toEqual([]);
  });
  it("the writer sends exactly the two properties to pages.update and nothing else", async () => {
    const seen: Array<{ url: string; method: string; body: unknown }> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), method: String(init.method), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ object: "page", id: "p1" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    await createStampWriter("t", { fetch: fetcher }).stamp("p1", "2026-11-20T10:00:00.000Z", "Anna");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("PATCH");
    expect(seen[0]!.url).toMatch(/\/v1\/pages\/p1$/);
    expect(seen[0]!.body).toEqual({ properties: { "Last sent at": { date: { start: "2026-11-20T10:00:00.000Z" } }, "Last sent by": { rich_text: [{ type: "text", text: { content: "Anna" } }] } } });
  });
});

// P90: the stamp read back, for the open card's teammate line (personal mailboxes).
describe("readClientStamp", () => {
  const stamped = (at: string | null, by: string): PageObject => ({ id: "p1", last_edited_time: "x", properties: { Email: { type: "email", email: "ann@x.example" }, [STAMP_FIELDS.at]: { type: "date", date: at ? { start: at } : null }, [STAMP_FIELDS.by]: { type: "rich_text", rich_text: by ? [{ plain_text: by }] : [] } } });
  it("returns who and when from the client's page, or null when the client, the date or the name is absent", async () => {
    expect(await readClientStamp(reader(FIELDS, [stamped("2026-11-20T14:02:00.000+00:00", "Igor")]), "ds", "Ann@x.example")).toEqual({ at: "2026-11-20T14:02:00.000Z", by: "Igor" });
    expect(await readClientStamp(reader(FIELDS, [stamped(null, "Igor")]), "ds", "ann@x.example")).toBeNull();
    expect(await readClientStamp(reader(FIELDS, [stamped("2026-11-20T14:02:00.000Z", "")]), "ds", "ann@x.example")).toBeNull();
    expect(await readClientStamp(reader(FIELDS, [stamped("2026-11-20T14:02:00.000Z", "Igor")]), "ds", "bob@x.example")).toBeNull();
  });
});

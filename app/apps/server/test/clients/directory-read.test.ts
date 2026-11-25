import { describe, expect, it } from "vitest";
import type { NotionReader, PageObject } from "@hub/notion";
import { startClientDirectory } from "../../src/clients/directory";

// P145 K4 (verdict 11): a schema edit between two pages of the Clients listing makes Notion answer 400 validation_error for the
// stale cursor. The directory reads once more from the first page and never holds a page twice; any other failure keeps the last read.
const card = (id: string, phone: string): PageObject => ({ id, last_edited_time: "x", properties: { Name: { type: "title", title: [{ plain_text: id }] }, Phone: { type: "phone_number", phone_number: phone } } });
const stale = () => Object.assign(new Error("x"), { status: 400, code: "validation_error" });

function reader(fail: (run: number, page: number) => Error | null): NotionReader & { runs: number } {
  const r = {
    runs: 0,
    retrieveDataSource: async () => ({ id: "ds", title: "Clients", properties: {} }),
    async *listPages() {
      const run = ++r.runs;
      for (const [page, rows] of [[1, [card("a", "+15550000001")]], [2, [card("b", "+15550000002")]]] as const) {
        const e = fail(run, page);
        if (e) throw e;
        yield* rows;
      }
    },
    findPages: async () => [],
    retrieveMarkdown: async () => ({ markdown: "", truncated: false, unknownBlockIds: [] }),
  };
  return r;
}

describe("the Clients directory read", () => {
  it("a 400 after the first page restarts the listing once, from the first page, with no duplicate", async () => {
    const r = reader((run, page) => (run === 1 && page === 2 ? stale() : null));
    const d = startClientDirectory({ dataSourceId: "ds", tokenFile: "notion-token", reader: r, auto: false });
    await d.refresh();
    expect(r.runs).toBe(2);
    expect(d.status()).toMatchObject({ state: "ready", entries: 2 });
  });

  it("a second failure is the read's error; another status is not retried", async () => {
    const twice = reader(() => stale());
    const d = startClientDirectory({ dataSourceId: "ds", tokenFile: "notion-token", reader: twice, auto: false });
    await d.refresh();
    expect(twice.runs).toBe(2);
    expect(d.status().state).toBe("error");
    const other = reader(() => Object.assign(new Error("x"), { status: 502, code: "bad_gateway" }));
    const e = startClientDirectory({ dataSourceId: "ds", tokenFile: "notion-token", reader: other, auto: false });
    await e.refresh();
    expect(other.runs).toBe(1);
  });
});

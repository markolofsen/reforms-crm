import type { DataSourceInfo, NotionReader, PageMarkdown, PageObject } from "../src/types";

export interface FakeDb {
  info: DataSourceInfo;
  pages: PageObject[];
  bodies: Record<string, string>;
  truncated?: Set<string>;
  fail?: string;
}

export function title(text: string) {
  return { id: "title", type: "title", title: [{ plain_text: text, text: { content: text } }] };
}

export function select(name: string) {
  return { id: "sel", type: "select", select: { name } };
}

export function makePage(id: string, name: string, extra: Record<string, unknown> = {}, edited = "2026-11-01T10:00:00.000Z"): PageObject {
  return {
    object: "page",
    id,
    last_edited_time: edited,
    created_time: "2026-10-01T10:00:00.000Z",
    properties: { Name: title(name), ...(extra as PageObject["properties"]) },
  };
}

export function makeInfo(id: string, name: string, properties: DataSourceInfo["properties"] = {}): DataSourceInfo {
  return { id, title: name, properties: { Name: { type: "title" }, ...properties } };
}

/** In-memory Notion. Counts every call; it has no write method because NotionReader has none. */
export class FakeReader implements NotionReader {
  calls = { retrieveDataSource: 0, listPages: 0, retrieveMarkdown: 0 };
  markdownFor: string[] = [];
  constructor(public dbs: Record<string, FakeDb>) {}

  private db(id: string): FakeDb {
    const db = this.dbs[id];
    if (!db) throw new Error(`object_not_found: ${id}`);
    if (db.fail) throw new Error(db.fail);
    return db;
  }

  async retrieveDataSource(id: string): Promise<DataSourceInfo> {
    this.calls.retrieveDataSource++;
    return structuredClone(this.db(id).info);
  }

  async *listPages(id: string): AsyncIterable<PageObject> {
    this.calls.listPages++;
    // Reverse order on purpose: the dump must not depend on the order Notion returns.
    for (const page of [...this.db(id).pages].reverse()) yield structuredClone(page);
  }

  async retrieveMarkdown(pageId: string): Promise<PageMarkdown> {
    this.calls.retrieveMarkdown++;
    this.markdownFor.push(pageId);
    for (const db of Object.values(this.dbs)) {
      if (db.pages.some((p) => p.id === pageId)) {
        const truncated = db.truncated?.has(pageId) ?? false;
        return { markdown: db.bodies[pageId] ?? "", truncated, unknownBlockIds: truncated ? ["blk-1"] : [] };
      }
    }
    throw new Error(`object_not_found: ${pageId}`);
  }
}

export const DS_CLIENTS = "11111111-1111-1111-1111-111111111111";
export const DS_LEADS = "22222222-2222-2222-2222-222222222222";

export function sampleDbs(): Record<string, FakeDb> {
  return {
    [DS_CLIENTS]: {
      info: makeInfo(DS_CLIENTS, "Clients", {
        Grade: { type: "select", select: { options: [{ name: "Priority" }, { name: "Standard" }, { name: "Low" }] } },
        Created: { type: "created_time" },
      }),
      pages: [
        makePage("aaaa0001-0000-0000-0000-000000000001", "Ada Client", {
          Grade: select("Priority"),
          Created: { id: "c", type: "created_time", created_time: "2026-10-01T10:00:00.000Z" },
          Docs: {
            id: "f",
            type: "files",
            files: [{ name: "a.pdf", type: "file", file: { url: "https://s3.example/a.pdf?X-Amz-Signature=abc", expiry_time: "2026-11-14T11:00:00Z" } }],
          },
          Leads: { id: "r", type: "relation", relation: [{ id: "bbbb0001-0000-0000-0000-000000000001" }], has_more: false },
        }),
        makePage("aaaa0002-0000-0000-0000-000000000002", "Ben Client", { Grade: select("Low") }),
        makePage("aaaa0003-0000-0000-0000-000000000003", "Cy Client"),
      ],
      bodies: {
        "aaaa0001-0000-0000-0000-000000000001": "# Ada\n\nLong history.\n",
        "aaaa0002-0000-0000-0000-000000000002": "Short note.\n",
        "aaaa0003-0000-0000-0000-000000000003": "",
      },
      truncated: new Set(["aaaa0003-0000-0000-0000-000000000003"]),
    },
    [DS_LEADS]: {
      info: makeInfo(DS_LEADS, "Leads", { Status: { type: "select", select: { options: [{ name: "New" }, { name: "Won" }] } } }),
      pages: [makePage("bbbb0001-0000-0000-0000-000000000001", "Website request", { Status: select("New") })],
      bodies: { "bbbb0001-0000-0000-0000-000000000001": "Hello, I want a viewing.\n" },
    },
  };
}

import { describe, expect, it } from "vitest";
import { findClientByEmail } from "../src/client-lookup";
import type { NotionReader, PageObject } from "../src/types";

// P87: draft_write's new thread asks whether an address is a client of the project's Notion Clients (read only).

const page = (id: string, props: Record<string, unknown>): PageObject => ({ id, last_edited_time: "2026-11-20T00:00:00.000Z", properties: props as PageObject["properties"] });
const email = (v: string) => ({ type: "email", email: v });
const box = (v: boolean) => ({ type: "checkbox", checkbox: v });
const rich = (v: string) => ({ type: "rich_text", rich_text: [{ plain_text: v }] });

function reader(pages: PageObject[]): NotionReader & { filters: unknown[] } {
  const filters: unknown[] = [];
  return {
    filters,
    retrieveDataSource: async (id) => ({ id, title: "Clients", properties: { Name: { type: "title" }, Email: { type: "email" }, "Other emails": { type: "rich_text" }, Notes: { type: "rich_text" } } }),
    async *listPages() {
      yield* pages;
    },
    // The fake returns every page: the lookup itself must check that a page names the address.
    findPages: async (_id, filter) => {
      filters.push(filter);
      return pages;
    },
    retrieveMarkdown: async () => ({ markdown: "", truncated: false, unknownBlockIds: [] }),
  };
}

describe("findClientByEmail", () => {
  it("finds a client by its Email or Other emails, and queries only the email properties", async () => {
    const r = reader([page("p1", { Email: email("mark@x.example") }), page("p2", { Email: email("a@y.example"), "Other emails": rich("ann@x.example, a2@x.example") })]);
    expect(await findClientByEmail(r, "ds", "Mark@X.example")).toEqual({ state: "client", pageId: "p1" });
    expect(await findClientByEmail(r, "ds", "ann@x.example")).toEqual({ state: "client", pageId: "p2" });
    expect(JSON.stringify(r.filters[0])).toContain('"property":"Email"');
    expect(JSON.stringify(r.filters[0])).not.toContain("Notes");
  });

  it("a stranger is no client; a Synthetic row never counts; Do not contact is said", async () => {
    const r = reader([page("p1", { Email: email("test@x.example"), Synthetic: box(true) }), page("p2", { Email: email("dnc@x.example"), "Do not contact": box(true) })]);
    expect(await findClientByEmail(r, "ds", "stranger@x.example")).toEqual({ state: "not_client" });
    expect(await findClientByEmail(r, "ds", "test@x.example")).toEqual({ state: "not_client" });
    expect(await findClientByEmail(r, "ds", "dnc@x.example")).toEqual({ state: "do_not_contact", pageId: "p2" });
  });
});

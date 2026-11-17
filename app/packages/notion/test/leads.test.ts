import { describe, expect, it } from "vitest";
import { parseLeadPage, renderLeadSummary, summarizeLeads } from "../src/leads";
import type { PageObject } from "../src/types";

const t = (s: string) => [{ plain_text: s }];
function page(o: { name?: string; status?: string | null; source?: string; brands?: string[]; received?: string; next?: string; client?: boolean; email?: string }): PageObject {
  return {
    id: `id-${o.name ?? "x"}`,
    last_edited_time: "2026-11-17T00:00:00Z",
    properties: {
      Name: { type: "title", title: t(o.name ?? "") },
      Status: { type: "select", select: o.status === null || o.status === undefined ? null : { name: o.status } },
      Source: { type: "select", select: o.source ? { name: o.source } : null },
      Brand: { type: "multi_select", multi_select: (o.brands ?? []).map((name) => ({ name })) },
      "Received at": { type: "date", date: o.received ? { start: o.received } : null },
      "Next step": { type: "date", date: o.next ? { start: o.next } : null },
      Client: { type: "relation", relation: o.client ? [{ id: "c" }] : [] },
      Email: { type: "email", email: o.email ?? null },
    },
  };
}

describe("leads", () => {
  it("parses a page; an empty status stays null and an unknown option is ignored", () => {
    const l = parseLeadPage(page({ name: "Ann", status: null, source: "Website", brands: ["carapis", "Reforms"], received: "2026-11-16T10:00:00Z", email: "a@b.co" }));
    expect(l).toMatchObject({ name: "Ann", status: null, source: "Website", brands: ["carapis", "Reforms"], email: "a@b.co", hasClient: false });
    expect(parseLeadPage(page({ name: "Bob", status: "Weird" })).status).toBeNull();
  });
  it("summarises like the live views: needs reply, overdue, won without a client", () => {
    const leads = [
      parseLeadPage(page({ name: "old-new", status: "New", received: "2026-11-10T08:00:00Z", brands: ["carapis"] })),
      parseLeadPage(page({ name: "today-new", status: "New", received: "2026-11-17T08:00:00Z" })),
      parseLeadPage(page({ name: "no-status", status: null, received: "2026-11-12" })),
      parseLeadPage(page({ name: "late", status: "In progress", next: "2026-11-15", received: "2026-11-01" })),
      parseLeadPage(page({ name: "ontime", status: "In progress", next: "2026-11-20", received: "2026-11-01" })),
      parseLeadPage(page({ name: "won-orphan", status: "Won", received: "2026-11-02" })),
      parseLeadPage(page({ name: "won-linked", status: "Won", client: true, received: "2026-11-03" })),
      parseLeadPage(page({ name: "junk", status: "Spam", received: "2026-11-04" })),
    ];
    const s = summarizeLeads(leads, "2026-11-17");
    expect(s.total).toBe(8);
    expect(s.byStatus).toMatchObject({ New: 3, "In progress": 2, Won: 2, Spam: 1 });
    expect(s.needsReply.map((l) => l.name)).toEqual(["old-new", "no-status"]);
    expect(s.overdue.map((l) => l.name)).toEqual(["late"]);
    expect(s.wonNoClient.map((l) => l.name)).toEqual(["won-orphan"]);
    expect(s.byBrand).toMatchObject({ carapis: 1, "(none)": 7 });
    expect(renderLeadSummary(s)).toContain("needs reply (new, received before today) (2)");
  });
});

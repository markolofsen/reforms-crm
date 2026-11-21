import { describe, expect, it } from "vitest";
import { findLeadByEmail } from "../src/client-lookup";
import { contactChannelOf, parseLeadDetail } from "../src/leads";
import { convertLead, newClientProperties, writeLeadStatus, type LeadWriter } from "../src/lead-convert";
import type { DataSourceInfo, NotionReader, PageObject, PropertyConfig } from "../src/types";

// P97 (decision 0044): the lead's reply address, and the Hub's writes on leads at the first reply sent and on Spam.
const rt = (s: string) => ({ type: "rich_text", rich_text: s ? [{ plain_text: s }] : [] });
const opts = (...names: string[]) => ({ options: names.map((name) => ({ name })) });

const LEADS: Record<string, PropertyConfig> = {
  Name: { type: "title" },
  Email: { type: "email" },
  Details: { type: "rich_text" },
  Status: { type: "select", select: opts("New", "In progress", "Won", "Lost", "Spam") },
  Client: { type: "relation" },
};
const CLIENTS: Record<string, PropertyConfig> = {
  Name: { type: "title" },
  Email: { type: "email" },
  Phone: { type: "phone_number" },
  Relationship: { type: "select", select: opts("Lead", "Prospect", "Client") },
  Brand: { type: "multi_select", multi_select: opts("carapis", "Reforms") },
};

function lead(id: string, o: { email?: string; details?: string; status?: string | null; client?: string | null; received?: string } = {}): PageObject {
  return {
    id,
    last_edited_time: "x",
    properties: {
      Name: { type: "title", title: [{ plain_text: "KodaCar" }] },
      Email: { type: "email", email: o.email ?? "koboriubiratan@gmail.com" },
      Details: rt(o.details ?? ""),
      Status: { type: "select", select: o.status === null ? null : { name: o.status ?? "New" } },
      Client: { type: "relation", relation: o.client ? [{ id: o.client }] : [] },
      "Received at": { type: "date", date: { start: o.received ?? "2026-11-20T10:00:00.000Z" } },
    },
  };
}
const card = (id: string, email: string): PageObject => ({ id, last_edited_time: "x", properties: { Name: { type: "title", title: [{ plain_text: id }] }, Email: { type: "email", email } } });

function fake(o: { leads: PageObject[]; clients: PageObject[]; leadsProps?: Record<string, PropertyConfig>; createFails?: number; updateFails?: number }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const ds = (id: string): DataSourceInfo => ({ id, title: id, properties: id === "leads" ? (o.leadsProps ?? LEADS) : CLIENTS });
  const reader: NotionReader = {
    retrieveDataSource: async (id) => ds(id),
    async *listPages(id) { yield* id === "leads" ? o.leads : o.clients; },
    findPages: async (id) => (id === "leads" ? o.leads : o.clients),
    retrieveMarkdown: async () => ({ markdown: "", truncated: false, unknownBlockIds: [] }),
  };
  const fail = (status: number | undefined) => { if (status) throw Object.assign(new Error("x"), { status, code: "restricted_resource" }); };
  const writer: LeadWriter = {
    setStatus: async (...a) => { fail(o.updateFails); calls.push(["status", ...a]); },
    linkClient: async (...a) => { fail(o.updateFails); calls.push(["link", ...a]); },
    createClient: async (...a) => { fail(o.createFails); calls.push(["create", ...a]); return "new-card"; },
    retrieveLead: async (id) => o.leads.find((p) => p.id === id) ?? lead(id),
  };
  return { reader, writer, calls };
}
const input = { leadsDataSource: "leads", clientsDataSource: "clients", leadPageId: "L1", email: "koboriubiratan@gmail.com", name: "KodaCar", brand: "carapis" };

describe("the lead's reply address (the owner's answer 4)", () => {
  it("is the email typed on the form, else the account email; another channel gives none", () => {
    expect(contactChannelOf("Company: Voltest\nContact channel: Email: Sam.Sarvas@scoutitweb.com\nSegment: dealer")).toEqual({ email: "sam.sarvas@scoutitweb.com" });
    expect(contactChannelOf("Contact channel: WhatsApp: 0804291728")).toEqual({ other: "WhatsApp: 0804291728" });
    expect(contactChannelOf("Segment: dealer")).toBeNull();
    expect(parseLeadDetail(lead("a", { email: "sam.sarvas@getvoltest.com", details: "Contact channel: Email: sam.sarvas@scoutitweb.com" })).replyTo).toBe("sam.sarvas@scoutitweb.com");
    expect(parseLeadDetail(lead("b", { details: "Contact channel: WhatsApp: 0804291728" }))).toMatchObject({ replyTo: "koboriubiratan@gmail.com", otherContact: "WhatsApp: 0804291728" });
  });
  it("findLeadByEmail matches the account email or the typed one, never a Spam row", async () => {
    const f = fake({ leads: [lead("a", { email: "acc@x.test", details: "Contact channel: Email: typed@x.test" }), lead("s", { email: "spam@x.test", status: "Spam" })], clients: [] });
    expect(await findLeadByEmail(f.reader, "leads", "Typed@x.test")).toEqual({ state: "lead", pageId: "a" });
    expect(await findLeadByEmail(f.reader, "leads", "acc@x.test")).toEqual({ state: "lead", pageId: "a" });
    expect(await findLeadByEmail(f.reader, "leads", "spam@x.test")).toEqual({ state: "not_lead" });
  });
});

describe("convertLead at the first reply sent (verdict 5)", () => {
  it("one Clients card with the address: links it and sets In progress, creates nothing", async () => {
    const f = fake({ leads: [lead("L1")], clients: [card("c1", "koboriubiratan@gmail.com")] });
    const r = await convertLead(f, input);
    expect(r).toEqual({ clientPageId: "c1", card: "linked", status: "in_progress", note: null });
    expect(f.calls).toEqual([["link", "L1", "Client", "c1"], ["status", "L1", { name: "Status", type: "select" }, "In progress"]]);
  });
  it("no card: creates one (Relationship Lead, the brand as the schema spells it) and links it", async () => {
    const f = fake({ leads: [lead("L1")], clients: [] });
    const r = await convertLead(f, { ...input, brand: "Carapis" });
    expect(r).toMatchObject({ clientPageId: "new-card", card: "created", status: "in_progress", note: null });
    expect(f.calls[0]).toEqual(["create", "clients", { Name: { title: [{ type: "text", text: { content: "KodaCar" } }] }, Email: { email: "koboriubiratan@gmail.com" }, Relationship: { select: { name: "Lead" } }, Brand: { multi_select: [{ name: "carapis" }] } }]);
  });
  it("several cards: links none and says so; an existing card is never written", async () => {
    const f = fake({ leads: [lead("L1")], clients: [card("c1", "koboriubiratan@gmail.com"), card("c2", "koboriubiratan@gmail.com")] });
    const r = await convertLead(f, input);
    expect(r).toMatchObject({ clientPageId: null, card: "several" });
    expect(r.note).toMatch(/2 Clients cards have koboriubiratan@gmail.com/);
    expect(f.calls.filter((c) => c[0] !== "status")).toEqual([]);
  });
  it("already linked: nothing to link; a Won lead keeps its Status", async () => {
    const f = fake({ leads: [lead("L1", { client: "c9", status: "Won" })], clients: [] });
    expect(await convertLead(f, input)).toEqual({ clientPageId: "c9", card: "already_linked", status: "kept", note: null });
    expect(f.calls).toEqual([]);
  });
  it("Insert content missing (403 on create): a note for the owner, never thrown; the Status still moves", async () => {
    const f = fake({ leads: [lead("L1")], clients: [], createFails: 403 });
    const r = await convertLead(f, input);
    expect(r).toMatchObject({ clientPageId: null, card: "refused", status: "in_progress" });
    expect(r.note).toMatch(/Insert content/);
  });
  it("a status-typed Status is written as status; an option that does not exist is skipped, not invented", async () => {
    const asStatus = { ...LEADS, Status: { type: "status", status: opts("New", "In progress", "Spam") } };
    const f = fake({ leads: [lead("L1", { client: "c1" })], clients: [], leadsProps: asStatus });
    await convertLead(f, input);
    expect(f.calls).toEqual([["status", "L1", { name: "Status", type: "status" }, "In progress"]]);
    const g = fake({ leads: [lead("L1")], clients: [], leadsProps: { ...LEADS, Status: { type: "select", select: opts("New") } } });
    expect(await writeLeadStatus(g, { leadsDataSource: "leads", pageId: "L1", status: "Spam" })).toEqual({ state: "skipped", reason: 'the Leads Status has no option "Spam"' });
  });
  it("the new card carries only the properties the Clients schema has", () => {
    const bare: DataSourceInfo = { id: "c", title: "Clients", properties: { Title: { type: "title" } } };
    expect(newClientProperties(bare, { name: "", email: "a@x.test", phone: "+1", brand: "carapis" })).toEqual({ Title: { title: [{ type: "text", text: { content: "a@x.test" } }] } });
  });
});

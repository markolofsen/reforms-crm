import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import type { NotionReader, PageObject } from "@hub/notion";
import type { LeadWriter } from "@hub/notion/leads-write";
import { createApp } from "./app";
import { convertSentLead, NO_LEADS_TOKEN, startLeadsReader, windowOf } from "./leads-reader";

// P97 S2, S4, S5: the Leads reader with a fake Notion (no test reaches Notion), the Inbox's Leads group, Spam and Undo, and the
// conversion at the first reply sent.
let handle: DbHandle;
let repos: Repos;
let dir: string;
const NOW = new Date("2026-11-21T10:00:00.000Z");
const LEADS_DS = "41806f30-6f14-812a-8a42-000b3b9c3ee4";
const CLIENTS_DS = "41806f30-6f14-81ac-b8e1-000bac534e05";

function page(id: string, o: { name?: string; email?: string; details?: string; status?: string | null; received?: string; brand?: string } = {}): PageObject {
  return {
    id,
    last_edited_time: "x",
    created_time: "2026-11-01T00:00:00.000Z",
    properties: {
      Name: { type: "title", title: [{ plain_text: o.name ?? "KodaCar" }] },
      Email: { type: "email", email: o.email ?? "koboriubiratan@gmail.com" },
      Message: { type: "rich_text", rich_text: [{ plain_text: "We need the car data API for Brazil." }] },
      Details: { type: "rich_text", rich_text: o.details ? [{ plain_text: o.details }] : [] },
      Status: { type: "select", select: o.status === null ? null : { name: o.status ?? "New" } },
      Brand: { type: "multi_select", multi_select: [{ name: o.brand ?? "carapis" }] },
      Client: { type: "relation", relation: [] },
      "Received at": { type: "date", date: { start: o.received ?? "2026-11-20T19:35:00.000Z" } },
    },
  };
}

function fakeNotion(pages: PageObject[], clients: PageObject[] = []) {
  const calls: unknown[][] = [];
  const reader: NotionReader = {
    retrieveDataSource: async (id) => ({
      id,
      title: id,
      properties: id === LEADS_DS
        ? { Name: { type: "title" }, Email: { type: "email" }, Details: { type: "rich_text" }, Client: { type: "relation" }, Status: { type: "select", select: { options: ["New", "In progress", "Won", "Lost", "Spam"].map((name) => ({ name })) } } }
        : { Name: { type: "title" }, Email: { type: "email" }, Relationship: { type: "select", select: { options: [{ name: "Lead" }, { name: "Client" }] } } },
    }),
    async *listPages(id) { yield* id === LEADS_DS ? pages : clients; },
    findPages: async (id) => (id === LEADS_DS ? pages : clients),
    retrieveMarkdown: async () => ({ markdown: "", truncated: false, unknownBlockIds: [] }),
  };
  const writer: LeadWriter = {
    setStatus: async (...a) => { calls.push(["status", ...a]); },
    linkClient: async (...a) => { calls.push(["link", ...a]); },
    createClient: async (...a) => { calls.push(["create", ...a]); return "new-card"; },
    retrieveLead: async (id) => pages.find((p) => p.id.replace(/-/g, "") === id.replace(/-/g, "")) ?? page(id),
  };
  return { clients: () => ({ reader, writer }), calls };
}

function projectFolder(extra: string[] = []) {
  mkdirSync(join(dir, "projects", "p"), { recursive: true });
  writeFileSync(
    join(dir, "projects", "p", "project.md"),
    ["# P", "", "## Settings", "", "| Field | Value | Answered | By |", "|---|---|---|---|", "| schema | 1 | 2026-11-14 | agent |", "| status | active | 2026-11-15 | agent |", "| mail.accounts | me@example.test | 2026-11-14 | agent |", "| mail.addresses | me@example.test | 2026-11-14 | owner |", ...extra, "", "## Notion databases", "", `- clients: ${CLIENTS_DS}`, `- leads: ${LEADS_DS}`, ""].join("\n"),
  );
}

beforeEach(async () => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  dir = mkdtempSync(join(tmpdir(), "hub-leads-"));
  await repos.projects.replaceRegistry({ projects: [{ slug: "p", name: "P", status: "active", settingsJson: "{}", hash: "h" }], addresses: [] });
});
afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

const env = (o: Record<string, string> = {}) => ({ HUB_HOME: dir, HUB_CONFIG_DIR: join(dir, "secrets"), ...o }) as NodeJS.ProcessEnv;
const reader = (n: ReturnType<typeof fakeNotion>) => startLeadsReader({ repos, projectsDir: join(dir, "projects"), env: env({ NOTION_TOKEN: "secret_test" }), now: () => NOW, clients: n.clients, auto: false });

describe("windowOf (verdict 9 as answered: the last 14 days)", () => {
  it("keeps the window's pages with the reply address and the brand row's name, and counts older New ones", () => {
    const pages = [page("a".repeat(32), { email: "acc@x.test", details: "Contact channel: Email: typed@x.test" }), page("b".repeat(32), { received: "2026-10-01" }), page("c".repeat(32), { received: "2026-10-01", status: "Won" })];
    const r = windowOf(pages, { project: "p", config: { brands: [{ name: "Carapis", receivesAt: [], signature: [], answered: "", by: "agent" }] as never, leads: { noticeSenders: [], windowDays: 14 } }, now: NOW });
    expect(r.older).toBe(1);
    expect(r.rows).toEqual([expect.objectContaining({ pageId: "a".repeat(32), email: "typed@x.test", accountEmail: "acc@x.test", brand: "Carapis", notionStatus: "New" })]);
  });
});

describe("the Leads reader and the Inbox's Leads group", () => {
  it("lists the New leads in GET /inbound, with the older count; a robot notice never is a row", async () => {
    projectFolder();
    const n = fakeNotion([page("a".repeat(32)), page("b".repeat(32), { received: "2026-09-30" })]);
    const leads = reader(n);
    await leads.read();
    const app = createApp(repos, { leads });
    const res = await app.request("/api/projects/p/inbound");
    const body = (await res.json()) as { rows: unknown[]; leads: { rows: Array<{ pageId: string; email: string }>; total: number; read: { older: number; reason: string | null } } };
    expect(body.rows).toEqual([]);
    expect(body.leads.total).toBe(1);
    expect(body.leads.rows[0]).toMatchObject({ pageId: "a".repeat(32), email: "koboriubiratan@gmail.com" });
    expect(body.leads.read).toMatchObject({ older: 1, reason: null });
  });

  it("no token: the line says why and nothing fails", async () => {
    projectFolder();
    const leads = startLeadsReader({ repos, projectsDir: join(dir, "projects"), env: env(), now: () => NOW, auto: false });
    await leads.read();
    expect(leads.status().projects[0]).toMatchObject({ slug: "p", reason: NO_LEADS_TOKEN });
    expect(leads.status().state).toBe("running");
  });

  it("Spam sets the Status in Notion and leaves the group; Undo sets New and brings it back", async () => {
    projectFolder();
    const n = fakeNotion([page("a".repeat(32))]);
    const leads = reader(n);
    await leads.read();
    const app = createApp(repos, { leads });
    const spam = await (await app.request(`/api/projects/p/leads/${"a".repeat(32)}/spam`, { method: "POST" })).json();
    expect(spam).toMatchObject({ ok: true, notion: "written", note: null });
    expect(n.calls).toEqual([["status", "a".repeat(32), { name: "Status", type: "select" }, "Spam"]]);
    expect((await repos.leadRows.open("p", "2026-11-01")).length).toBe(0);
    const undo = await (await app.request(`/api/projects/p/leads/${"a".repeat(32)}/undo`, { method: "POST" })).json();
    expect(undo).toMatchObject({ notion: "written" });
    expect(n.calls.at(-1)).toEqual(["status", "a".repeat(32), { name: "Status", type: "select" }, "New"]);
    expect((await repos.leadRows.open("p", "2026-11-01")).length).toBe(1);
    expect((await app.request("/api/projects/p/leads/nothex/spam", { method: "POST" })).status).toBe(404);
  });

  it("Not now is local: Notion is not written", async () => {
    projectFolder();
    const n = fakeNotion([page("a".repeat(32))]);
    const leads = reader(n);
    await leads.read();
    const app = createApp(repos, { leads });
    expect(await (await app.request(`/api/projects/p/leads/${"a".repeat(32)}/not-now`, { method: "POST" })).json()).toMatchObject({ notion: "none" });
    expect(n.calls).toEqual([]);
  });
});

describe("convertSentLead at the first reply sent (S4)", () => {
  it("a send to a stored lead creates its card, links it, sets In progress once; a send to anyone else does nothing", async () => {
    projectFolder();
    const n = fakeNotion([page("a".repeat(32))]);
    await reader(n).read();
    const c = { repos, projectsDir: join(dir, "projects"), env: env({ NOTION_TOKEN: "secret_test" }), clients: n.clients, now: () => NOW };
    expect(await convertSentLead(c, { project: "p", to: ["someone@else.test"], draftId: 1 })).toEqual({ state: "none" });
    expect(await convertSentLead(c, { project: "p", to: ["KodaCar <koboriubiratan@gmail.com>"], draftId: 1 })).toEqual({ state: "converted" });
    expect(n.calls.map((x) => x[0])).toEqual(["create", "link", "status"]);
    expect(await repos.leadRows.get("p", "a".repeat(32))).toMatchObject({ clientPageId: "new-card", notionStatus: "In progress" });
    expect(await convertSentLead(c, { project: "p", to: ["koboriubiratan@gmail.com"], draftId: 2 })).toEqual({ state: "none" });
  });
  it("notion.convert_leads off: nothing is written", async () => {
    projectFolder(["| notion.convert_leads | off | 2026-11-21 | owner |"]);
    const n = fakeNotion([page("a".repeat(32))]);
    await reader(n).read();
    expect(await convertSentLead({ repos, projectsDir: join(dir, "projects"), env: env({ NOTION_TOKEN: "secret_test" }), clients: n.clients }, { project: "p", to: ["koboriubiratan@gmail.com"], draftId: 1 })).toEqual({ state: "off" });
    expect(n.calls).toEqual([]);
  });
});

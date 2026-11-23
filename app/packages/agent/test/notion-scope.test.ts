import { describe, expect, it } from "vitest";
import { notionCapability, notionNote, notionViolations, projectNotion, type NotionScope } from "../src/notion-scope";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { projectStore, setSendPolicy } from "@hub/projects";
import { tmpdir } from "node:os";
import path from "node:path";
import { hubPaths } from "@hub/config/paths";
import { sessionCapabilities } from "../src/connectors";
import { capabilitiesOf, sessionRules, testModeLine } from "../src/session-rules";
import { NOTION_RULE } from "../src/notion-scope";

// P82: one Notion connector sees two teamspaces with databases of the same names. The session is told its own ids and the guard
// refuses another project's. The ids are saas's and realty's from 2026-11-20 (the owner's case: "есть клиенты по saas?").

const SAAS: NotionScope = {
  slug: "saas-support",
  databases: [
    { role: "clients", dataSourceId: "41806f30-6f14-81ac-b8e1-000bac534e05" },
    { role: "leads", dataSourceId: "41806f30-6f14-812a-8a42-000b3b9c3ee4" },
    { role: "documents", dataSourceId: "41806f30-6f14-81f4-b69b-000b81c70b32" },
    { role: "business-contacts", dataSourceId: "41806f30-6f14-8139-93fd-000b27df28a9" },
    { role: "tasks", dataSourceId: "41806f30-6f14-8198-8f26-000b230d6a8b" },
  ],
  teamspace: "CRM: SaaS",
  teamspaceId: null,
  parentPage: null,
};
const REALTY_CLIENTS_DS = "6096f440-6f14-8000-8000-000000001521";
const REALTY_CLIENTS_DB = "1fcaf8df-ea52-4113-8f04-f854fbf476c7";
const OWN_PAGE = "41806f30-6f14-81d5-832d-ecbdf9d06c5e";
const query = (ds: string) => ({ data: { mode: "sql", data_source_urls: [`collection://${ds}`], query: `SELECT url FROM "collection://${ds}" LIMIT 50` } });

describe("the capabilities line names the project's databases (P82 S2)", () => {
  it("five collection:// ids and no teamspace while notion.teamspace_id is unset", () => {
    const l = notionCapability(SAAS);
    for (const d of SAAS.databases) expect(l).toContain(`${d.role} collection://${d.dataSourceId}`);
    expect(l).toContain("never by search");
    expect(l).not.toContain("teamspace CRM: SaaS");
    expect(notionCapability({ ...SAAS, teamspaceId: "aaaa0000-0000-4000-8000-000000000001" })).toContain("; teamspace CRM: SaaS");
    expect(sessionCapabilities("saas-support", [], "codex", SAAS)).toContain("clients collection://41806f30-6f14-81ac-b8e1-000bac534e05");
    expect(sessionCapabilities("saas-support", [], "claude")).toContain("notion: the project's CRM databases");
  });
  it("a bound session's capabilities line names the fixture project's ids and carries the rule, for both CLIs", () => {
    const paths = hubPaths({ home: mkdtempSync(path.join(tmpdir(), "hub-notion-scope-")), env: {} });
    const fixtures = path.join(__dirname, "..", "..", "projects", "test", "fixtures", "projects");
    for (const cli of ["claude", "codex"] as const) {
      const l = capabilitiesOf(paths, fixtures, "acme-travel", cli) ?? "";
      expect(l).toContain("clients collection://00000000-0000-4000-8000-000000000001, documents collection://00000000-0000-4000-8000-000000000002");
      expect(l.endsWith(NOTION_RULE)).toBe(true);
    }
  });
  it("P92: the notion part says read and write, so a session never claims it has no Notion write tool", () => {
    expect(notionCapability(SAAS)).toContain("read and write (query, create and update rows; delete and move are denied)");
  });
  it("P92: in test mode the line names the owner's test addresses (not the project's own) as valid recipients; any: no such sentence", () => {
    const paths = hubPaths({ home: mkdtempSync(path.join(tmpdir(), "hub-test-mode-")), env: {} });
    const fixtures = path.join(__dirname, "..", "..", "projects", "test", "fixtures", "projects");
    mkdirSync(path.dirname(paths.configFile), { recursive: true });
    writeFileSync(paths.configFile, JSON.stringify({ allow_list: ["Owner.Test@gmail.example", "hello@acme.example"] }));
    const l = capabilitiesOf(paths, fixtures, "acme-travel", "claude") ?? "";
    expect(l).toContain(testModeLine(["owner.test@gmail.example"]));
    expect(l).toMatch(/never refuse them as not a client/);
    // P98: a test address is answered as a client, never remarked on (P129 verdict 7: "do it at once" is the work-order rule now).
    expect(l).toContain("without remarking that it is a test address");
    expect(l.endsWith(NOTION_RULE)).toBe(true);
    setSendPolicy(paths.stateProjects, "acme-travel", projectStore({ projects: fixtures }).config("acme-travel").kind, { "draft.recipients": "any" }, "test");
    expect(capabilitiesOf(paths, fixtures, "acme-travel", "claude") ?? "").not.toContain("Test mode");
  });
  it("P92, P129 verdict 7: the session rules make the owner the authority: his request is the work order, a Notion row on his request is done, the tools decide what is allowed, only sends and deletes are forbidden", () => {
    const r = sessionRules("acme");
    expect(r).toContain("The owner is the authority.");
    expect(r).toContain("His request in this session is the work order");
    expect(r).toContain("Never decide yourself that an address, client or recipient is not allowed: the tool checks it.");
    expect(r).toContain("is created or edited on his request; Notion deletes and moves are forbidden.");
  });
  it("a project with no list says so, with the phrase", () => {
    expect(notionCapability({ ...SAAS, databases: [] })).toBe("notion: no databases listed in project.md (say: настрой проект saas-support)");
  });
  it("project_show's notion part (projectNotion) returns the same five", () => {
    expect(projectNotion(SAAS).databases.map((d) => d.url)).toEqual(SAAS.databases.map((d) => `collection://${d.dataSourceId}`));
    expect(projectNotion(SAAS).teamspace).toBeNull();
  });
});

describe("notionViolations (P82 S3)", () => {
  it("a query on realty's clients is refused with saas's ids; saas's own passes; dashes do not matter", () => {
    const v = notionViolations("mcp__notion__notion-query-data-sources", query(REALTY_CLIENTS_DS), SAAS);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/is not one of saas-support's Notion databases \(clients collection:\/\/41806f30-6f14-81ac-b8e1-000bac534e05, leads/);
    expect(notionViolations("mcp__notion__notion-query-data-sources", query(REALTY_CLIENTS_DB), SAAS)).toHaveLength(1);
    expect(notionViolations("mcp__notion__notion-query-data-sources", query("41806f30-6f14-81ac-b8e1-000bac534e05"), SAAS)).toEqual([]);
    expect(notionViolations("mcp__notion__notion-query-data-sources", query("41806f306f1481acb8e1000bac534e05"), SAAS)).toEqual([]);
  });
  it("create-pages: a foreign data source or any database_id is refused; the project's data source passes; a private draft passes", () => {
    const create = (parent: unknown) => notionViolations("mcp__notion__notion-create-pages", { parent, pages: [{ properties: { Name: "x" } }] }, SAAS);
    expect(create({ data_source_id: "41806f30-6f14-81ac-b8e1-000bac534e05" })).toEqual([]);
    expect(create({ data_source_id: REALTY_CLIENTS_DS })).toHaveLength(1);
    expect(create({ database_id: REALTY_CLIENTS_DB })[0]).toMatch(/use data_source_id 41806f30-6f14-81ac-b8e1-000bac534e05 \(clients\)/);
    expect(create(undefined)).toEqual([]);
    expect(create({ page_id: OWN_PAGE })).toHaveLength(1);
    expect(create({ teamspace_id: "bbbb0000-0000-4000-8000-000000000002" })).toHaveLength(1);
  });
  it("update-page: refused unless this session read the page from one of the project's databases", () => {
    const upd = { page_id: OWN_PAGE, command: "update_properties", properties: { Status: "Active" } };
    expect(notionViolations("mcp__notion__notion-update-page", upd, SAAS)[0]).toMatch(/has not read that page from one of saas-support's databases/);
    const fromClients = [{ op: "query", sources: ["41806f306f1481acb8e1000bac534e05"], pageIds: ["41806f306f1481d5832decbdf9d06c5e"] }];
    expect(notionViolations("mcp__notion__notion-update-page", upd, SAAS, fromClients)).toEqual([]);
    const fromRealty = [{ op: "fetch", sources: ["6096f4406f1480008000000000001521"], pageIds: ["41806f306f1481d5832decbdf9d06c5e"] }];
    expect(notionViolations("mcp__notion__notion-update-page", upd, SAAS, fromRealty)).toHaveLength(1);
    // A page created in the project's database counts too (the ledger records the parent as the source).
    expect(notionViolations("mcp__notion__notion-create-pages", { parent: { page_id: OWN_PAGE } }, SAAS, fromClients)).toEqual([]);
  });
  it("search and fetch are never refused; an unbound session or an empty list refuses nothing; other servers are not judged", () => {
    expect(notionViolations("mcp__notion__notion-search", { query: "Clients" }, SAAS)).toEqual([]);
    expect(notionViolations("mcp__notion__notion-fetch", { id: REALTY_CLIENTS_DB }, SAAS)).toEqual([]);
    expect(notionViolations("mcp__notion__notion-query-data-sources", query(REALTY_CLIENTS_DS), undefined)).toEqual([]);
    expect(notionViolations("mcp__notion__notion-query-data-sources", query(REALTY_CLIENTS_DS), { ...SAAS, databases: [] })).toEqual([]);
    expect(notionViolations("mcp__mail-mcp__find_messages", query(REALTY_CLIENTS_DS), SAAS)).toEqual([]);
  });
});

describe("notionNote (P82 S3, the post hook)", () => {
  it("an unscoped search gets the note with the project's ids; one narrowed to a project source does not", () => {
    expect(notionNote("mcp__notion__notion-search", { query: "Clients" }, { results: [] }, SAAS)).toMatch(/not narrowed to saas-support.*clients collection:\/\/41806f30-6f14-81ac-b8e1-000bac534e05/);
    expect(notionNote("mcp__notion__notion-search", { query: "x", data_source_url: "collection://41806f30-6f14-81ac-b8e1-000bac534e05" }, {}, SAAS)).toBeNull();
  });
  it("a fetch that returns realty's Clients gets the note; a fetch from a project source does not", () => {
    const realty = { text: `<database url="https://app.notion.com/p/${REALTY_CLIENTS_DB.replace(/-/g, "")}"><data-source url="collection://${REALTY_CLIENTS_DS}">` };
    expect(notionNote("mcp__notion__notion-fetch", { id: REALTY_CLIENTS_DB }, realty, SAAS)).toMatch(/collection:\/\/6096f4406f1480008000000000001521, which is not one of saas-support's listed databases/);
    const own = { text: '<parent-data-source url="collection://41806f30-6f14-81ac-b8e1-000bac534e05" name="Clients"/>' };
    expect(notionNote("mcp__notion__notion-fetch", { id: OWN_PAGE }, own, SAAS)).toBeNull();
    expect(notionNote("mcp__notion__notion-fetch", { id: OWN_PAGE }, own, undefined)).toBeNull();
  });
});

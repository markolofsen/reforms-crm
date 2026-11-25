import { projectStore } from "@hub/projects/store";
import { readJson, type McpFile } from "../context";
import { verifyProjectDatabases } from "../notion-check";
import { addMapField, mapFieldRows } from "../notion-map-field";
import { addFollowUpFields, followUpFieldRows } from "../notion-follow-up-fields";
import { addLeadPassFields, leadPassFieldRows } from "../notion-lead-pass-fields";
import { descriptionRows, syncDescriptions } from "../notion-descriptions";
import { addProjectOptions, projectFieldRows, projectKeyVerdict } from "../notion-projects-field";
import { applyBugReports, bugReportsRows } from "../notion-bug-reports";
import path from "node:path";
import type { Step } from "../types";
import { fileState, NOTION_FILE, probeNotion, readValue } from "@hub/connections";
import { fail, pass, warn } from "./helpers";

export const notionSteps: Step[] = [
  {
    id: "notion.token", group: "Notion", title: "Notion integration token",
    why: "The hub's own read integration: the admin Overview counts, the database check, `notion-dump` and the Notion backup use it. A manual session writes through the connector and needs no token. Access in full: `@docs/setup/access.md`.",
    verifies: "The token file is stored with mode 600 and Notion accepts it (`GET /users/me`). Which databases it reaches is the next step, `notion.access`.",
    manual: {
      steps: [
        "Easiest: Settings ▸ Connections in the admin, or `pnpm hub setup --automation` (plain `hub setup` asks for no token); both check it with `GET /users/me`. By hand:",
        "Open https://www.notion.so/profile/integrations and create an internal integration; copy its secret.",
        "In Notion, open the CRM teamspace (or each CRM database), choose Connections and add the integration.",
        "Store the token: `pnpm hub token notion` (hidden prompt; writes `state/secrets/notion-token`, mode 600).",
        "Which databases it must reach, and what to share, is checked by `notion.access`.",
      ],
    },
    async check(ctx) {
      const f = fileState(ctx.configDir, NOTION_FILE);
      const file = path.join(ctx.configDir, NOTION_FILE);
      const why = f.state === "missing" ? `${file} is missing` : f.state === "empty" ? `${file} is empty` : f.state === "unsafe-mode" ? `${file} is mode ${f.mode}, must be 600` : undefined;
      if (why) return fail(`${why}: run \`hub setup\` (hidden prompt) or \`hub token notion\``);
      const probe = await probeNotion({ fetch: ctx.fetch }, readValue(ctx.configDir, NOTION_FILE) ?? "");
      if (probe.state !== "valid") return fail(probe.detail);
      return pass(`token accepted${probe.identity ? ` (integration "${probe.identity}")` : ""}`);
    },
  },
  {
    id: "notion.access", group: "Notion", title: "The integration reaches every database of every project",
    why: "Notion shares nothing with an integration by default, and a database that is moved or merged loses its grant. The unattended extras (`notion-dump`, the Overview counts) read each database with the integration token, so each one must be shared with it.",
    verifies: "For every project that lists Notion databases: each database in project.md answers to the integration (shared, readable, capability Read content), is not archived and not in the trash, and every database its relations point at (Leads, People, ...) is reachable. A failure names the database and says to share it with the integration under Connections. A relation target project.md does not list that is archived (an optional or legacy module such as Organizations, P145 verdict 9) is a WARN naming the property: the Hub never writes it. Read only: GET requests. WARN when there is no token to test with.",
    manual: {
      steps: [
        "In Notion open the project's teamspace root page, choose `...` > Connections and add the integration. Sub-pages and databases inherit it; a database that was moved out loses it, so share again after a move.",
        "The integration needs the capability Read content (Notion > Settings > Integrations > your integration > Capabilities). It never writes.",
        "An archived database is not a grant problem: point project.md at the live database (`## Notion databases`) or restore it in Notion.",
      ],
    },
    async check(ctx) {
      const projects = projectStore({ projects: ctx.paths.projects }).list();
      const needs = projects.filter((p) => p.parsed.config.notion.databases.length > 0);
      if (!needs.length) return pass("no project lists Notion databases yet");
      const sharedOnly = needs.every((p) => p.parsed.config.notion.tokenFile === NOTION_FILE);
      if (sharedOnly && fileState(ctx.configDir, NOTION_FILE).state !== "stored") return warn("not tested: no usable Notion token (see notion.token)");
      const v = await verifyProjectDatabases(ctx, projects);
      return !v.ok ? fail(v.detail) : v.warnings?.length ? warn(v.detail) : pass(v.detail);
    },
  },
  {
    id: "notion.client-map", group: "Notion", title: "Clients carry the client map's date",
    why: "P135: the Hub copies each client's map to their Clients page (a \"Client map\" section with a Mermaid code block) and sets the date \"Map updated\", so a Notion view can sort clients by their newest map. A database without the date still gets the map; only the date is skipped.",
    verifies: "Each project's Clients database (project.md, `clients`) has the property \"Map updated\" of type date. Read only: one GET per project. WARN when there is no token to read with, or the name is taken by another type.",
    does: "Adds the date property \"Map updated\" to each Clients database that lacks it (one PATCH of the data source; no other property is touched, nothing is deleted). The integration needs Update content.",
    async check(ctx) {
      const rows = await mapFieldRows(ctx, projectStore({ projects: ctx.paths.projects }).list());
      if (!rows.length) return pass("no project lists a Clients database");
      const missing = rows.filter((r) => r.state === "missing");
      if (missing.length) return fail(`${missing.map((r) => r.detail).join("; ")}: \`hub install --only notion.client-map\` adds it`);
      const other = rows.filter((r) => r.state !== "ok");
      return other.length ? warn(other.map((r) => r.detail).join("; ")) : pass(`${rows.length} Clients database(s) have "Map updated"`);
    },
    async apply(ctx) {
      return addMapField(ctx, await mapFieldRows(ctx, projectStore({ projects: ctx.paths.projects }).list()));
    },
  },
  {
    id: "notion.follow-ups", group: "Notion", title: "Clients carry the follow-up properties",
    why: "P142 (decision 0050): the daily follow-up sweep copies each client's plan to their Clients page: the dates and states as four Hub-owned properties (Next follow-up, Follow-up status, Follow-ups sent, Waiting on) and one dated line under \"Follow-ups\". A database without them still gets the line; only the properties are skipped.",
    verifies: "Each project's Clients database (project.md, `clients`) has \"Next follow-up\" (date), \"Follow-up status\" (select), \"Follow-ups sent\" (number) and \"Waiting on\" (select). Read only: one GET per project. WARN when there is no token to read with, or a name is taken by another type.",
    does: "Adds the missing ones to each Clients database (one PATCH of the data source; the selects with their options; no other property is touched, the CRM's Follow-up on and Waiting since stay the CRM's, nothing is deleted). The integration needs Update content.",
    async check(ctx) {
      const rows = await followUpFieldRows(ctx, projectStore({ projects: ctx.paths.projects }).list());
      if (!rows.length) return pass("no project lists a Clients database");
      const missing = rows.filter((r) => r.state === "missing");
      if (missing.length) return fail(`${missing.map((r) => r.detail).join("; ")}: \`hub install --only notion.follow-ups\` adds them`);
      const other = rows.filter((r) => r.state !== "ok");
      return other.length ? warn(other.map((r) => r.detail).join("; ")) : pass(`${rows.length} Clients database(s) have the follow-up properties`);
    },
    async apply(ctx) {
      return addFollowUpFields(ctx, await followUpFieldRows(ctx, projectStore({ projects: ctx.paths.projects }).list()));
    },
  },
  {
    id: "notion.lead-pass", group: "Notion", title: "Leads carry the lead pass properties",
    why: "P147 (decision 0055): the daily lead pass copies each decision to the lead's Notion page as two Hub-owned properties, \"Hub decision\" (Reply, Client, Spam proposed, Not now proposed, For you) and \"Hub reason\" (one line why). A database without them still gets the decisions in the Hub; only the Notion copy is skipped.",
    verifies: "Each project's Leads database (project.md, `leads`) has \"Hub decision\" (select) and \"Hub reason\" (text). Read only: one GET per project. WARN when there is no token to read with, or a name is taken by another type.",
    does: "Adds the missing ones to each Leads database (one PATCH of the data source; the select with its options; Status, Owner and Notes are never touched, nothing is deleted). The integration needs Update content.",
    async check(ctx) {
      const rows = await leadPassFieldRows(ctx, projectStore({ projects: ctx.paths.projects }).list());
      if (!rows.length) return pass("no project lists a Leads database");
      const missing = rows.filter((r) => r.state === "missing");
      if (missing.length) return fail(`${missing.map((r) => r.detail).join("; ")}: \`hub install --only notion.lead-pass\` adds them`);
      const other = rows.filter((r) => r.state !== "ok");
      return other.length ? warn(other.map((r) => r.detail).join("; ")) : pass(`${rows.length} Leads database(s) have the lead pass properties`);
    },
    async apply(ctx) {
      return addLeadPassFields(ctx, await leadPassFieldRows(ctx, projectStore({ projects: ctx.paths.projects }).list()));
    },
  },
  {
    id: "notion.descriptions", group: "Notion", title: "Live property descriptions match the pack",
    why: "P140 P1a: a property's description is the rule a person and an agent read in Notion. The client profile (Clients' Name, Email, Phone, Relationship, Type, Lead source, Next step) reads \"Kept current by the agent from what the client says (never invented); the owner may edit.\" An older description that calls them the CRM's stops the agent's profile refresh.",
    verifies: "Each project database that has descriptions in the pack (`schema/<db>.json`, `description`) holds the same text live. Read only: one GET per database. WARN when there is no token to read with.",
    does: "Sets the pack's description on each property that differs: one PATCH per data source, a select's options sent back exactly as Notion holds them (no option, colour or type changes), nothing deleted. The integration needs Update content.",
    async check(ctx) {
      const rows = await descriptionRows(ctx, projectStore({ projects: ctx.paths.projects }).list(), ctx.paths.notionPack);
      if (!rows.length) return pass("no project lists a database the pack describes");
      const differs = rows.filter((r) => r.state === "differs");
      if (differs.length) return fail(`${differs.map((r) => r.detail).join("; ")}: \`hub install --only notion.descriptions\` sets them`);
      const other = rows.filter((r) => r.state !== "ok");
      return other.length ? warn(other.map((r) => r.detail).join("; ")) : pass(`${rows.length} database(s) carry the pack's descriptions`);
    },
    async apply(ctx) {
      return syncDescriptions(ctx, await descriptionRows(ctx, projectStore({ projects: ctx.paths.projects }).list(), ctx.paths.notionPack));
    },
  },
  {
    id: "notion.projects", group: "Notion", title: "Every brand is a project option",
    why: "P145 (decision 0053): one project key names a project everywhere: a `## Brands` row, a Clients (and Documents, Contacts, Tasks, Expenses, Bug reports) `Projects` option and a Leads `Brand` option match when their keys (lower case, letters and digits) are equal. A brand with no option cannot be tagged, and a lead form's writer leaves Brand empty.",
    verifies: "For each project with `## Brands`: Clients has `Projects` (multi_select), and every brand row has an option of its key in Clients.Projects, Leads.Brand and the `Projects` of the other listed databases. Read only: one GET per database. WARN for an option no brand row claims (another project's brand, or a project with no brand row), for a database whose property is missing or not a multi_select, or with no token.",
    does: "Adds the missing options (and creates Clients `Projects` when missing): one PATCH per data source, the live options sent back unchanged with the new ones; nothing is removed or renamed. The integration needs Update content.",
    async check(ctx) {
      const rows = await projectFieldRows(ctx, projectStore({ projects: ctx.paths.projects }).list());
      if (!rows.length) return pass("no project lists ## Brands and a Notion database with a project property");
      const todo = rows.filter((r) => r.state === "missing" || r.state === "no_property");
      if (todo.length) return fail(`${todo.map((r) => r.detail).join("; ")}: \`hub install --only notion.projects\` adds them`);
      const other = rows.filter((r) => r.state !== "ok" || r.unclaimed.length);
      return other.length ? warn(other.map((r) => r.detail).join("; ")) : pass(`${rows.length} database(s) carry every brand's option`);
    },
    async apply(ctx) {
      return addProjectOptions(ctx, await projectFieldRows(ctx, projectStore({ projects: ctx.paths.projects }).list()));
    },
  },
  {
    id: "notion.project-keys", group: "Notion", title: "Brands, keys and options agree",
    why: "P145 (decision 0053): the doctor shows every brand with its project key and the options it matched, so drift between project.md and Notion is visible: a brand with no option, a key two options share, an option no brand claims, or a Clients database without the `Project signals` formula.",
    verifies: "Per project and database: `<brand>-><key>-><matched options>`. FAIL when a brand matches no option or two; WARN for an option no brand row claims (never `Other`) and for a Clients database without `Project signals` (a formula the API cannot create: its text is in the pack's schema/clients.json). Read only.",
    async check(ctx) {
      const v = projectKeyVerdict(await projectFieldRows(ctx, projectStore({ projects: ctx.paths.projects }).list()));
      return v.level === "pass" ? pass(v.detail) : v.level === "warn" ? warn(v.detail) : fail(v.detail);
    },
  },
  {
    id: "notion.bug-reports", group: "Notion", title: "Bug reports database",
    why: "P145 (decision 0054): a client's bug report is filed in the project's Bug reports database by the Hub's `bug_report` tool (one report per symptom, the clients and their words appended). Required by no project kind: without it the tool says the database is missing.",
    verifies: "Each project with a Clients database lists `bug-reports` in project.md, and that database has every property and option of the pack's schema/bug-reports.json, with `Clients` pointing at the project's Clients. Read only. WARN with no token, or for a property of another type (renamed by hand in Notion).",
    does: "Creates \"Bug reports\" under Clients' parent page with the pack's properties and a one-way relation to Clients, then writes `bug-reports: <id>` into project.md; on a listed database adds only the missing properties and options (nothing renamed or removed). The integration needs Insert content.",
    async check(ctx) {
      const rows = await bugReportsRows(ctx, projectStore({ projects: ctx.paths.projects }).list());
      if (!rows.length) return pass("no project lists a Clients database");
      const todo = rows.filter((r) => r.state === "absent" || r.state === "missing");
      if (todo.length) return fail(`${todo.map((r) => r.detail).join("; ")}: \`hub install --only notion.bug-reports\``);
      const other = rows.filter((r) => r.state !== "ok");
      return other.length ? warn(other.map((r) => r.detail).join("; ")) : pass(rows.map((r) => r.detail).join("; "));
    },
    async apply(ctx) {
      return applyBugReports(ctx, await bugReportsRows(ctx, projectStore({ projects: ctx.paths.projects }).list()));
    },
  },
  {
    id: "notion.connector", group: "Notion", title: "Notion connector in the session",
    why: "A manual session reads and writes the CRM through the Notion connector (Claude Desktop, or the `notion` server of `.mcp.json` in Claude Code); no integration token is involved.",
    verifies: "`.mcp.json` lists the `notion` server (hint only: whether you have signed in to it is seen inside a session, with `/mcp`).",
    manual: { steps: ["In Claude Code run `/mcp` once and sign in to `notion`; in Claude Desktop enable the Notion connector in Settings > Connectors."] },
    async check(ctx) {
      const have = readJson<McpFile>(ctx.paths.mcpFile)?.mcpServers ?? {};
      return "notion" in have
        ? pass("`notion` is in .mcp.json; sign in once with `/mcp` (Claude Code) or Settings > Connectors (Claude Desktop)")
        : warn("no `notion` server in .mcp.json yet (the install step adds it); Claude Desktop needs its Notion connector switched on");
    },
  },
];

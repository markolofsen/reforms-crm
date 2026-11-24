import { projectStore } from "@hub/projects/store";
import { readJson, type McpFile } from "../context";
import { verifyProjectDatabases } from "../notion-check";
import { addMapField, mapFieldRows } from "../notion-map-field";
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
    verifies: "For every project that lists Notion databases: each database in project.md answers to the integration (shared, readable, capability Read content), is not archived and not in the trash, and every database its relations point at (Leads, People, ...) is reachable and live too. A failure names the database and says to share it with the integration under Connections. Read only: GET requests. WARN when there is no token to test with.",
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
      return v.ok ? pass(v.detail) : fail(v.detail);
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

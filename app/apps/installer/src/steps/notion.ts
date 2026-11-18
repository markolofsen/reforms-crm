import { loadProjects } from "@hub/projects";
import { readJson } from "../context";
import { verifyProjectDatabases } from "../notion-check";
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
        "Easiest: the Connections page of the admin, or `pnpm hub setup --automation` (plain `hub setup` asks for no token); both check it with `GET /users/me`. By hand:",
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
      const projects = loadProjects(ctx.paths.projects);
      const needs = projects.filter((p) => p.parsed.config.notion.databases.length > 0);
      if (!needs.length) return pass("no project lists Notion databases yet");
      const sharedOnly = needs.every((p) => p.parsed.config.notion.tokenFile === NOTION_FILE);
      if (sharedOnly && fileState(ctx.configDir, NOTION_FILE).state !== "stored") return warn("not tested: no usable Notion token (see notion.token)");
      const v = await verifyProjectDatabases(ctx, projects);
      return v.ok ? pass(v.detail) : fail(v.detail);
    },
  },
  {
    id: "notion.connector", group: "Notion", title: "Notion connector in the session",
    why: "A manual session reads and writes the CRM through the Notion connector (Claude Desktop, or the `notion` server of `.mcp.json` in Claude Code); no integration token is involved.",
    verifies: "`.mcp.json` lists the `notion` server (hint only: whether you have signed in to it is seen inside a session, with `/mcp`).",
    manual: { steps: ["In Claude Code run `/mcp` once and sign in to `notion`; in Claude Desktop enable the Notion connector in Settings > Connectors."] },
    async check(ctx) {
      const have = readJson(ctx.paths.mcpFile)?.mcpServers ?? {};
      return "notion" in have
        ? pass("`notion` is in .mcp.json; sign in once with `/mcp` (Claude Code) or Settings > Connectors (Claude Desktop)")
        : warn("no `notion` server in .mcp.json yet (the install step adds it); Claude Desktop needs its Notion connector switched on");
    },
  },
];

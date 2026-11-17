import { loadProjects } from "@hub/projects";
import { readJson } from "../context.ts";
import { verifyProjectDatabases } from "../notion-check.ts";
import path from "node:path";
import type { Step } from "../types.ts";
import { fileState, NOTION_FILE, probeNotion, readValue } from "@hub/connections";
import { fail, pass, warn } from "./helpers.ts";

export const notionSteps: Step[] = [
  {
    id: "notion.token", group: "Notion", title: "Notion integration token",
    why: "Optional. Only the Notion backup (`notion-dump`) and unattended runs read Notion through your own integration; a manual session uses the connector and needs none.",
    verifies: "The token file is stored with mode 600, Notion accepts it, and every database listed in every project's project.md can be read with it.",
    manual: {
      steps: [
        "Easiest: `pnpm hub setup` asks for the token and checks it with `GET /users/me`. By hand:",
        "Open https://www.notion.so/profile/integrations and create an internal integration; copy its secret.",
        "In Notion, open the CRM teamspace (or each CRM database), choose Connections and add the integration.",
        "Store the token: `pnpm hub token notion` (hidden prompt; writes `state/secrets/notion-token`, mode 600).",
        "If a database is unreachable the check names the teamspace page to share with the integration.",
      ],
    },
    async check(ctx) {
      const f = fileState(ctx.configDir, NOTION_FILE);
      const file = path.join(ctx.configDir, NOTION_FILE);
      const why = f.state === "missing" ? `${file} is missing` : f.state === "empty" ? `${file} is empty` : f.state === "unsafe-mode" ? `${file} is mode ${f.mode}, must be 600` : undefined;
      if (why) return fail(`${why}: run \`hub setup\` (hidden prompt) or \`hub token notion\``);
      const probe = await probeNotion({ fetch: ctx.fetch }, readValue(ctx.configDir, NOTION_FILE) ?? "");
      if (probe.state !== "valid") return fail(probe.detail);
      const v = await verifyProjectDatabases(ctx, loadProjects(ctx.paths.projects));
      return v.ok ? pass(`token valid; ${v.detail}`) : fail(v.detail);
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

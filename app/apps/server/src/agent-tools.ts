import { Hono } from "hono";
import { agentChecks, defaultProbe, fakeAgentRows, type AgentProbe } from "@hub/agent/checks";
import { AGENT_CLIS, instanceFeatures, type HubPaths } from "@hub/config/paths";
import { agentToolsDto, type AgentToolsDto } from "@hub/contract/agent-tools";
import type { Repos } from "@hub/db";
import { throwawayDbNamed } from "@hub/send";
import { notFound } from "./http";

// "Agent tools" in Connections (P49 5B): the rows of `@hub/agent` `agentChecks` for both CLIs, per project. The last result
// is kept in memory; the first GET computes it, Refresh recomputes (about 10 s: each MCP server is asked once per CLI).

/** `HUB_AGENT_TOOLS`: unset (real checks) or `fake` (e2e: fixed rows); `fake` needs `HUB_DB`, like `HUB_MAILER=fake`. */
export function chooseAgentTools(env: NodeJS.ProcessEnv): "real" | "fake" {
  const v = env.HUB_AGENT_TOOLS?.trim();
  if (!v) return "real";
  if (v !== "fake") throw new Error(`HUB_AGENT_TOOLS must be unset or "fake", got "${v}"`);
  if (!throwawayDbNamed(env)) throw new Error("HUB_AGENT_TOOLS=fake needs HUB_DB set to a throwaway database file: the default database is the live one");
  return "fake";
}

export interface AgentToolsOptions {
  paths: HubPaths;
  repos: Repos;
  fake?: boolean;
  probe?: AgentProbe;
  now?: () => Date;
}

export function createAgentTools(o: AgentToolsOptions) {
  const last = new Map<string, AgentToolsDto>();
  const now = o.now ?? (() => new Date());
  const probe = o.probe ?? defaultProbe();
  async function compute(slug: string): Promise<AgentToolsDto> {
    const f = instanceFeatures(o.paths);
    const rows = [];
    for (const cli of AGENT_CLIS) rows.push(...(o.fake ? fakeAgentRows(slug, cli) : await agentChecks({ paths: o.paths, slug, cli, unattended: f.agent.unattended, probe })));
    const dto = agentToolsDto.parse({ project: slug, unattended: f.agent.unattended, defaultCli: f.agent.default, rows, checkedAt: now().toISOString() });
    last.set(slug, dto);
    return dto;
  }
  return {
    get: async (slug: string) => last.get(slug) ?? compute(slug),
    refresh: compute,
  };
}
export type AgentToolsService = ReturnType<typeof createAgentTools>;

export function agentToolRoutes(repos: Repos, service: AgentToolsService | undefined) {
  const known = async (slug: string) => (await repos.projects.get(slug)) !== null;
  const off = { error: "agent tools not set up", code: "not_found" as const };
  return new Hono()
    .get("/api/projects/:slug/agent-tools", async (c) => {
      const slug = c.req.param("slug");
      if (!service) return c.json(off, 404);
      if (!(await known(slug))) return notFound(c, "project");
      return c.json(await service.get(slug));
    })
    .post("/api/projects/:slug/agent-tools/refresh", async (c) => {
      const slug = c.req.param("slug");
      if (!service) return c.json(off, 404);
      if (!(await known(slug))) return notFound(c, "project");
      return c.json(await service.refresh(slug));
    });
}

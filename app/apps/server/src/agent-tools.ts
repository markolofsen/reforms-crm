import { Hono } from "hono";
import { agentChecks, defaultProbe, fakeAgentRows, NOTION_EVIDENCE_DAYS, notionEvidenceOf, type AgentProbe } from "@hub/agent/checks";
import { logStoreOf, readEvents } from "@hub/log/store";
import { resolveConnectors } from "@hub/agent/connectors";
import { loadProject } from "@hub/projects";
import { cliDetector, detectClis, type CliDetector } from "@hub/agent/detect";
import { AGENT_CLIS, instanceFeatures, type HubPaths } from "@hub/config/paths";
import { agentToolsDto, type AgentCapability, type AgentToolsDto } from "@hub/contract/agent-tools";
import type { CliFactDto } from "@hub/contract/terminal";
import type { Repos } from "@hub/db";
import { throwawayDbNamed } from "@hub/send";
import { notFound } from "./http";
import type { AgentServices } from "./composition/capabilities";

// "Agent tools" in Connections (P49 5B): the rows of `@hub/agent` `agentChecks` for both CLIs, per project. The last result
// is kept in memory; the first GET computes it, Refresh recomputes and re-detects the CLIs (about 10 s: each MCP server is
// asked once per CLI).

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
  /** Rows 1 and 2 (P57): the server's shared detector, so they equal the terminal's pick. */
  detector?: CliDetector;
  /** Refresh also checks again whether a terminal tab can start (P66, the terminal's `recheck`). */
  onRefresh?: () => void;
}

/** P62: the connectors attached to the project (none when its project.md does not load: the rows say why). */
function capabilitiesOf(paths: HubPaths, slug: string): AgentCapability[] {
  try {
    return resolveConnectors(paths, loadProject(paths.projects, slug).parsed.config).attached.map((c) => ({ kind: c.kind, name: c.name, account: c.account?.account ?? null }));
  } catch { return []; }
}

/** `HUB_AGENT_TOOLS=fake`: one attached calendar connector whose account is known, and no Drive. */
const FAKE_CAPABILITIES: AgentCapability[] = [{ kind: "calendar", name: "gcal-demo", account: "owner@example.com" }];

export function createAgentTools(o: AgentToolsOptions) {
  const last = new Map<string, AgentToolsDto>();
  const now = o.now ?? (() => new Date());
  const probe = o.probe ?? defaultProbe();
  const detector = o.detector ?? cliDetector({ detect: () => detectClis() });
  async function compute(slug: string, fresh = false): Promise<AgentToolsDto> {
    const f = instanceFeatures(o.paths);
    const facts = o.fake ? [] : (await (fresh ? detector.refresh() : detector.get())).facts;
    const rows = [];
    // P82: the Notion row reads what this project's sessions did with Notion in the last 14 days (the log, P54).
    const since = new Date(now().getTime() - NOTION_EVIDENCE_DAYS * 86_400_000).toISOString();
    const events = o.fake ? [] : readEvents(logStoreOf(o.paths), { project: slug, kinds: ["tool_call", "tool_result", "tool_error"], since });
    for (const cli of AGENT_CLIS) rows.push(...(o.fake ? fakeAgentRows(slug, cli) : await agentChecks({ paths: o.paths, slug, cli, unattended: f.agent.unattended, probe, facts, notionEvidence: notionEvidenceOf(events, cli), defaultCli: f.agent.default })));
    const capabilities = o.fake ? FAKE_CAPABILITIES : capabilitiesOf(o.paths, slug);
    const dto = agentToolsDto.parse({ project: slug, unattended: f.agent.unattended, defaultCli: f.agent.default, rows, capabilities, checkedAt: now().toISOString() });
    last.set(slug, dto);
    return dto;
  }
  return {
    get: async (slug: string) => last.get(slug) ?? compute(slug),
    /** The cached rows only, never a run (P63: the Overview's parts read this); null before the first GET or Refresh. */
    peek: (slug: string): AgentToolsDto | null => last.get(slug) ?? null,
    /** The CLI detector's last answer without its paths (P63), never a detection; null before the first one. */
    clis: (): CliFactDto[] | null => detector.peek()?.facts.map((f) => ({ cli: f.cli, state: f.state, version: f.version, detail: f.detail, fix: f.fix })) ?? null,
    /** Refresh in Connections also re-detects the CLIs (P57 1e): he may have just signed in. */
    refresh: (slug: string) => { o.onRefresh?.(); return compute(slug, true); },
  };
}
export type AgentToolsService = ReturnType<typeof createAgentTools>;

export function agentToolRoutes({ repos, tools: service }: AgentServices) {
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

import type { SafetyKind } from "@hub/config";
import { activityDto, type ActivityView } from "@hub/contract/activity";
import { agentFeedDto } from "@hub/contract/agent-feed";
import { pulseDto } from "@hub/contract/health";
import { coreUpdateDto, instanceDto } from "@hub/contract/instance";
import { knowledgeListDto, type KnowledgeView } from "@hub/contract/knowledge";
import { localOpenedDto, type ServerActionId } from "@hub/contract/local";
import type { AgentSettingsBody, SafetyRuleBody } from "@hub/contract/requests";
import { agentSettingsDto, projectOverviewDto, projectsDto, safetyRuleSavedDto, safetyRulesDto } from "@hub/contract/responses";
import { read } from "./client";

/** The instance's brand and its core update notice (P68), the projects, the pulse, the agent's activity (and its live feed, P59), the safety rules and the agent settings (P55), and the one local Open (P61). */
export const metaApi = {
  instance: () => read(instanceDto, { method: "GET", path: "/api/instance" }),
  /** P68: the server's cached answer; `checkCore` runs one check now (429 within a minute). */
  core: () => read(coreUpdateDto, { method: "GET", path: "/api/instance/core" }),
  checkCore: () => read(coreUpdateDto, { method: "POST", path: "/api/instance/core/check" }),
  projects: () => read(projectsDto, { method: "GET", path: "/api/projects" }),
  overview: (project: string) => read(projectOverviewDto, { method: "GET", path: "/api/project", query: { project } }),
  pulse: () => read(pulseDto, { method: "GET", path: "/api/pulse" }),
  /** P73: one page of the timeline, older than `before` (the previous page's `next`). */
  activity: (project: string, view: ActivityView, client: number | null, before: string | null) =>
    read(activityDto, { method: "GET", path: "/api/activity", query: { project, view, client: client ?? undefined, before: before ?? undefined } }),
  agentFeed: (project: string) => read(agentFeedDto, { method: "GET", path: `/api/projects/${encodeURIComponent(project)}/agent-feed` }),
  /** P70: the Knowledge table of one project, filtered and searched on the server. */
  knowledge: (project: string, filter: KnowledgeView, q: string) => read(knowledgeListDto, { method: "GET", path: `/api/projects/${encodeURIComponent(project)}/knowledge`, query: { filter, q } }),
  rules: (project: string) => read(safetyRulesDto, { method: "GET", path: "/api/safety-rules", query: { project } }),
  setRule: (project: string, kind: SafetyKind, patch: Omit<SafetyRuleBody, "project">) => read(safetyRuleSavedDto, { method: "PUT", path: `/api/safety-rules/${kind}`, body: { project, ...patch } }),
  /** P55: the project's agent model and advisor; a change applies at the next session start. */
  agentSettings: (project: string) => read(agentSettingsDto, { method: "GET", path: "/api/agent-settings", query: { project } }),
  setAgentSettings: (project: string, patch: Omit<AgentSettingsBody, "project">) => read(agentSettingsDto, { method: "PUT", path: "/api/agent-settings", body: { project, ...patch } }),
  /** P61: the only POST to `/api/local` (a project and a key; the server resolves the path). Called by `components/local-action.tsx`. */
  localOpen: (action: ServerActionId, args: unknown) => read(localOpenedDto, { method: "POST", path: `/api/local/${action}`, body: args }),
};

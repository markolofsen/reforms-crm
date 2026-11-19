import type { RunStatus, SafetyKind } from "@hub/config";
import { activityDto } from "@hub/contract/activity";
import { agentFeedDto } from "@hub/contract/agent-feed";
import { pulseDto } from "@hub/contract/health";
import { coreUpdateDto, instanceDto } from "@hub/contract/instance";
import { localOpenedDto, type ServerActionId } from "@hub/contract/local";
import type { SafetyRuleBody } from "@hub/contract/requests";
import { projectOverviewDto, projectsDto, safetyRuleSavedDto, safetyRulesDto } from "@hub/contract/responses";
import { read } from "./client";

/** The instance's brand and its core update notice (P68), the projects, the pulse, the agent's activity (and its live feed, P59), the safety rules, and the one local Open (P61). */
export const metaApi = {
  instance: () => read(instanceDto, { method: "GET", path: "/api/instance" }),
  /** P68: the server's cached answer; `checkCore` runs one check now (429 within a minute). */
  core: () => read(coreUpdateDto, { method: "GET", path: "/api/instance/core" }),
  checkCore: () => read(coreUpdateDto, { method: "POST", path: "/api/instance/core/check" }),
  projects: () => read(projectsDto, { method: "GET", path: "/api/projects" }),
  overview: (project: string) => read(projectOverviewDto, { method: "GET", path: "/api/project", query: { project } }),
  pulse: () => read(pulseDto, { method: "GET", path: "/api/pulse" }),
  activity: (project: string, filter: "all" | RunStatus) => read(activityDto, { method: "GET", path: "/api/activity", query: { project, filter } }),
  agentFeed: (project: string) => read(agentFeedDto, { method: "GET", path: `/api/projects/${encodeURIComponent(project)}/agent-feed` }),
  rules: (project: string) => read(safetyRulesDto, { method: "GET", path: "/api/safety-rules", query: { project } }),
  setRule: (project: string, kind: SafetyKind, patch: Omit<SafetyRuleBody, "project">) => read(safetyRuleSavedDto, { method: "PUT", path: `/api/safety-rules/${kind}`, body: { project, ...patch } }),
  /** P61: the only POST to `/api/local` (a project and a key; the server resolves the path). Called by `components/local-action.tsx`. */
  localOpen: (action: ServerActionId, args: unknown) => read(localOpenedDto, { method: "POST", path: `/api/local/${action}`, body: args }),
};

import type { SafetyKind } from "@hub/config";
import type { SafetyRuleBody } from "@hub/contract/requests";
import { pulseDto } from "@hub/contract/health";
import { eventsDto, projectOverviewDto, projectsDto, runsDto, safetyRuleSavedDto, safetyRulesDto } from "@hub/contract/responses";
import { read } from "./client";

/** Projects, the agent log, the safety rules and the pulse the admin polls. */
export const metaApi = {
  projects: () => read(projectsDto, { method: "GET", path: "/api/projects" }),
  overview: (project: string) => read(projectOverviewDto, { method: "GET", path: "/api/project", query: { project } }),
  pulse: () => read(pulseDto, { method: "GET", path: "/api/pulse" }),
  runs: (project: string) => read(runsDto, { method: "GET", path: "/api/runs", query: { project } }),
  events: (project: string, runId: number) => read(eventsDto, { method: "GET", path: `/api/runs/${runId}/events`, query: { project } }),
  rules: (project: string) => read(safetyRulesDto, { method: "GET", path: "/api/safety-rules", query: { project } }),
  setRule: (project: string, kind: SafetyKind, patch: Omit<SafetyRuleBody, "project">) => read(safetyRuleSavedDto, { method: "PUT", path: `/api/safety-rules/${kind}`, body: { project, ...patch } }),
};

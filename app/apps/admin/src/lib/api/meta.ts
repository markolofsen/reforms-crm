import type { SafetyKind } from "@hub/config";
import { getActivity, getAgentFeed, getAgentSettings, getCoreUpdate, getInstance, getProjectLinks, getProjectOverview, getPulse, getKnowledgeText, getSafetyRules, listKnowledge, listProjects } from "@hub/api";
import { activityDto, type ActivityView } from "@hub/contract/activity";
import { agentFeedDto } from "@hub/contract/agent-feed";
import { pulseDto } from "@hub/contract/health";
import { coreUpdateDto, instanceDto } from "@hub/contract/instance";
import { knowledgeListDto, knowledgeTextDto, type KnowledgeView } from "@hub/contract/knowledge";
import { appsDto, localOpenedDto, type ServerActionId } from "@hub/contract/local";
import type { AgentSettingsBody, SafetyRuleBody } from "@hub/contract/requests";
import { agentSettingsDto, projectLinksDto, projectOverviewDto, projectsDto, safetyRuleSavedDto, safetyRulesDto } from "@hub/contract/responses";
import { read, readGenerated } from "./client";

/** The instance's brand and its core update notice (P68), the projects, the pulse, the agent's activity (and its live feed, P59), the safety rules and the agent settings (P55), and the one local Open (P61). */
export const metaApi = {
  instance: () => readGenerated(getInstance(), instanceDto),
  /** P68: the server's cached answer; `checkCore` runs one check now (429 within a minute). */
  core: () => readGenerated(getCoreUpdate(), coreUpdateDto),
  checkCore: () => read(coreUpdateDto, { method: "POST", path: "/api/instance/core/check" }),
  /** P131 O2: Settings ▸ This Mac's Check again: which destination apps this Mac has, probed now (nothing opens). */
  checkApps: () => read(appsDto, { method: "POST", path: "/api/instance/apps/check" }),
  projects: () => readGenerated(listProjects(), projectsDto),
  overview: (project: string) => readGenerated(getProjectOverview({ project }), projectOverviewDto),
  links: (project: string) => readGenerated(getProjectLinks(project), projectLinksDto),
  pulse: () => readGenerated(getPulse(), pulseDto),
  /** P73: one page of the timeline, older than `before` (the previous page's `next`). */
  activity: (project: string, view: ActivityView, client: number | null, before: string | null) =>
    readGenerated(getActivity({ project, view, client: client ?? undefined, before: before ?? undefined }), activityDto),
  agentFeed: (project: string) => readGenerated(getAgentFeed(project), agentFeedDto),
  /** P70: the Knowledge table of one project, filtered and searched on the server. */
  knowledge: (project: string, filter: KnowledgeView, q: string) => readGenerated(listKnowledge(project, { filter, q }), knowledgeListDto),
  /** P128 X6: one entry's text, shown under its row (the Orval client is regenerated from the spec at the final gate). */
  knowledgeText: (project: string, key: string) => readGenerated(getKnowledgeText(project, { key }), knowledgeTextDto),
  rules: (project: string) => readGenerated(getSafetyRules({ project }), safetyRulesDto),
  setRule: (project: string, kind: SafetyKind, patch: Omit<SafetyRuleBody, "project">) => read(safetyRuleSavedDto, { method: "PUT", path: `/api/safety-rules/${kind}`, body: { project, ...patch } }),
  /** P55: the project's agent model and advisor; a change applies at the next session start. */
  agentSettings: (project: string) => readGenerated(getAgentSettings({ project }), agentSettingsDto),
  setAgentSettings: (project: string, patch: Omit<AgentSettingsBody, "project">) => read(agentSettingsDto, { method: "PUT", path: "/api/agent-settings", body: { project, ...patch } }),
  /** P61: the only POST to `/api/local` (a project and a key; the server resolves the path). Called by `lib/data/instance.ts` (`postLocalOpen`). */
  localOpen: (action: ServerActionId, args: unknown) => read(localOpenedDto, { method: "POST", path: `/api/local/${action}`, body: args }),
};

import type { SafetyKind } from "@hub/config";
import { checkApps, checkCoreUpdate, getGetInstanceLogoUrl, getStreamLiveUrl, getActivity, getAgentFeed, getAgentSettings, getCoreUpdate, getInstance, getProjectLinks, getProjectOverview, getPulse, getKnowledgeText, getSafetyRules, listKnowledge, listProjects, openLocal, setAgentSettings, setSafetyRule } from "@hub/api";
import { activityDto, type ActivityView } from "@hub/contract/activity";
import { agentFeedDto } from "@hub/contract/agent-feed";
import { pulseDto } from "@hub/contract/health";
import { coreUpdateDto, instanceDto } from "@hub/contract/instance";
import { knowledgeListDto, knowledgeTextDto, type KnowledgeView } from "@hub/contract/knowledge";
import { appsDto, LOCAL_ACTIONS, localOpenedDto, type ServerActionId } from "@hub/contract/local";
import type { AgentSettingsBody, SafetyRuleBody } from "@hub/contract/requests";
import { agentSettingsDto, safetyRuleSavedDto, safetyRulesDto } from "@hub/contract/settings";
import { projectLinksDto, projectOverviewDto, projectsDto } from "@hub/contract/project";
import { readGenerated } from "./client";

/** The instance's brand and its core update notice (P68), the projects, the pulse, the agent's activity (and its live feed, P59), the safety rules and the agent settings (P55), and the one local Open (P61). */
export const metaApi = {
  instance: () => readGenerated(getInstance(), instanceDto),
  /** The brand's logo file, an <img> source (`@hub/api/ledger` URL_HELPERS). */
  logoUrl: (): string => getGetInstanceLogoUrl(),
  /** The live stream's URL (SSE, opened by `lib/cache/live.ts`), after the last applied counter when the page has one. */
  streamUrl: (after: number | null): string => getStreamLiveUrl(after === null ? undefined : { since: String(after) }),
  /** P68: the server's cached answer; `checkCore` runs one check now (429 within a minute). */
  core: () => readGenerated(getCoreUpdate(), coreUpdateDto),
  checkCore: () => readGenerated(checkCoreUpdate(), coreUpdateDto),
  /** P131 O2: Settings ▸ This Mac's Check again: which destination apps this Mac has, probed now (nothing opens). */
  checkApps: () => readGenerated(checkApps(), appsDto),
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
  setRule: (project: string, kind: SafetyKind, patch: Omit<SafetyRuleBody, "project">) => readGenerated(setSafetyRule(kind, { project, ...patch }), safetyRuleSavedDto),
  /** P55: the project's agent model and advisor; a change applies at the next session start. */
  agentSettings: (project: string) => readGenerated(getAgentSettings({ project }), agentSettingsDto),
  setAgentSettings: (project: string, patch: Omit<AgentSettingsBody, "project">) => readGenerated(setAgentSettings({ project, ...patch }), agentSettingsDto),
  /** P61: the only local Open (a project and a key; the server resolves the path and checks `args` against the action's own schema). Called by `lib/data/instance.ts` (`postLocalOpen`). */
  localOpen: (action: ServerActionId, args: unknown) => {
    const checked = LOCAL_ACTIONS[action].args.safeParse(args);
    if (!checked.success) return Promise.reject(new Error(`This Open was given the wrong details: ${checked.error.issues[0]?.message ?? "invalid"}.`));
    return readGenerated(openLocal(action, checked.data), localOpenedDto);
  },
};

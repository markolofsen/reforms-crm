import type { SafetyKind } from "@hub/config";
import { getAgentSettings, getSafetyRules, setAgentSettings, setSafetyRule } from "@hub/api";
import type { AgentSettingsBody, SafetyRuleBody } from "@hub/contract/requests";
import { agentSettingsDto, safetyRuleSavedDto, safetyRulesDto } from "@hub/contract/settings";
import { readGenerated } from "../client";

/** One project's settings (P127 V13): the safety rules and the agent's model and advisor (P55). */
export const projectSettingsApi = {
  rules: (project: string) => readGenerated(getSafetyRules({ project }), safetyRulesDto),
  setRule: (project: string, kind: SafetyKind, patch: Omit<SafetyRuleBody, "project">) => readGenerated(setSafetyRule(kind, { project, ...patch }), safetyRuleSavedDto),
  /** P55: a change applies at the next session start. */
  agentSettings: (project: string) => readGenerated(getAgentSettings({ project }), agentSettingsDto),
  setAgentSettings: (project: string, patch: Omit<AgentSettingsBody, "project">) => readGenerated(setAgentSettings({ project, ...patch }), agentSettingsDto),
};

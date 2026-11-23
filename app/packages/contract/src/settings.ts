import { z } from "zod";
import { ADVISOR_MODELS, AGENT_MODELS, SAFETY_KINDS } from "@hub/config";

// One project's checks (safety rules) and its agent settings (P55).

export const safetyRuleDto = z.object({
  kind: z.enum(SAFETY_KINDS),
  enabled: z.boolean(),
  level: z.enum(["amber", "red"]),
  params: z.object({ words: z.array(z.string()).optional(), days: z.number().optional() }),
});
export type SafetyRuleDto = z.infer<typeof safetyRuleDto>;
export const safetyRulesDto = z.object({ rules: z.array(safetyRuleDto) });
export const safetyRuleSavedDto = z.object({ rule: safetyRuleDto });
export type SafetyRulesDto = z.infer<typeof safetyRulesDto>;

/** P55: the project's agent settings, Claude Code only (`advisorModel` is kept while the advisor is off). */
export const agentSettingsDto = z.object({ agent: z.object({ model: z.enum(AGENT_MODELS), advisor: z.boolean(), advisorModel: z.enum(ADVISOR_MODELS) }).strict() });
export type AgentSettingsDto = z.infer<typeof agentSettingsDto>;

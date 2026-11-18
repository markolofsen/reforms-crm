import { z } from "zod";

// "Agent tools" in Connections (P49 section 5B): per CLI and per project, whether a hub agent session has what it needs,
// loaded and correct. The server returns the last result of `@hub/agent` `agentChecks` (the same rows as `hub doctor
// --only Agent`); the admin computes nothing. Every red row carries one command line to fix it.

export const AGENT_TOOL_CLIS = ["claude", "codex"] as const;
export const AGENT_TOOL_STATES = ["pass", "warn", "fail", "skip"] as const;
export type AgentToolState = (typeof AGENT_TOOL_STATES)[number];

export const agentToolRow = z.strictObject({
  /** Stable id: `cli.version`, `mcp.present.mail-mcp`, ... */
  id: z.string(),
  cli: z.enum(AGENT_TOOL_CLIS),
  title: z.string(),
  state: z.enum(AGENT_TOOL_STATES),
  detail: z.string(),
  /** One command line, shown with a copy button; null when there is nothing to run. */
  fix: z.string().nullable(),
});
export type AgentToolRow = z.infer<typeof agentToolRow>;

export const agentToolsDto = z.strictObject({
  project: z.string(),
  /** `agent.unattended` of the instance, and `agent.default`. */
  unattended: z.boolean(),
  defaultCli: z.enum(AGENT_TOOL_CLIS),
  rows: z.array(agentToolRow),
  /** When the rows were computed; null when they never were (the first GET computes them). */
  checkedAt: z.string().nullable(),
});
export type AgentToolsDto = z.infer<typeof agentToolsDto>;

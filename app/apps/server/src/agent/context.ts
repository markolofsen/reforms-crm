import type { Repos } from "@hub/db";
import type { AgentToolsDto } from "@hub/contract/agent-tools";
import type { LogStore } from "@hub/log/store";
import type { FocusStore } from "./focus";

export type AgentToolsCapability = {
  get(slug: string): Promise<AgentToolsDto>;
  refresh(slug: string): Promise<AgentToolsDto>;
};

/** The agent domain's context (P126 S1): Agent tools, the shared focus, the pointer and the session log's feed. */
export type AgentContext = {
  repos: Repos;
  now: () => Date;
  adminPort: number;
  tools?: AgentToolsCapability;
  /** The shared focus (P51); absent, `POST /api/focus` is 404. */
  focus?: FocusStore;
  /** The agent's pointer file (P72); absent, `GET /api/pointer` answers no pointer. */
  pointerFile?: string;
  /** The agent session log (P54); absent, the feed is 404. */
  log?: LogStore;
};

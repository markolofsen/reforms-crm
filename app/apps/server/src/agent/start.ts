import type { Repos } from "@hub/db";
import type { HubPaths } from "@hub/config/paths";
import type { RuntimeModes } from "@hub/config/modes";
import { logStoreOf, readEvents } from "@hub/log/store";
import { ensureAgentSendToken } from "@hub/agent/send-token";
import type { CliDetector } from "@hub/agent/detect";
import type { Runtime } from "../composition/runtime";
import type { AgentSendOptions } from "../send/context";
import { createAgentTools } from "./tools";
import { createFocusStore } from "./focus";

/**
 * The agent domain at start (P126 S1): Agent tools, the shared focus (P51), the pointer file (P72), the session log, and the
 * agent's send on the owner's word (decision 0046: the token is `hub mcp`'s, in state/secrets, denied to every session; the session
 * log is read per call).
 */
export function start(o: { repos: Repos; paths: HubPaths; modes: RuntimeModes; detector: CliDetector; recheck: () => void }): { handles: Runtime["agent"]; send: AgentSendOptions } {
  const log = logStoreOf(o.paths);
  const tools = createAgentTools({ paths: o.paths, repos: o.repos, fake: o.modes.agentTools === "fake", detector: o.detector, onRefresh: o.recheck });
  const send: AgentSendOptions = {
    token: ensureAgentSendToken(o.paths),
    events: (project, since) => readEvents(log, { project, kinds: ["prompt", "focus"], since }),
  };
  return { handles: { tools, focus: createFocusStore({ file: o.paths.focus }), pointerFile: o.paths.pointer, log }, send };
}

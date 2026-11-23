import { agentFeedDto } from "@hub/contract/agent-feed";
import { agentToolsDto } from "@hub/contract/agent-tools";
import { focusInput } from "@hub/contract/focus";
import { pointerDto } from "@hub/contract/pointer";
import { okDto } from "@hub/contract/review";
import { slugParam } from "@hub/contract/requests";
import type { Operation } from "../http/openapi";

/** The agent domain's operations (P120 W2): the feed, the tools, the shared focus (one door, P51) and the pointer's one GET (P72). */
export const operations: Operation[] = [
  { method: "get", path: "/api/projects/:slug/agent-feed", operationId: "getAgentFeed", summary: "Read the agent's recent turns", tags: ["meta"], params: slugParam, reply: { name: "AgentFeed", schema: agentFeedDto }, errors: [404, 503] },
  { method: "get", path: "/api/projects/:slug/agent-tools", operationId: "getAgentTools", summary: "Read the project's agent tools", tags: ["connections"], params: slugParam, reply: { name: "AgentTools", schema: agentToolsDto }, errors: [404, 503] },
  { method: "post", path: "/api/projects/:slug/agent-tools/refresh", operationId: "refreshAgentTools", summary: "Read the project's agent tools again now", tags: ["connections"], params: slugParam, reply: { name: "AgentTools", schema: agentToolsDto }, errors: [403, 404, 503] },
  // The page's close also posts a clear through `fetch(…, { keepalive })` at this operation's URL.
  { method: "post", path: "/api/focus", operationId: "postFocus", summary: "Post what the owner's admin shows (ids only)", tags: ["agent"], body: { name: "FocusInput", schema: focusInput }, reply: { name: "Ok", schema: okDto }, errors: [400, 403, 404] },
  { method: "get", path: "/api/pointer", operationId: "getPointer", summary: "Read the agent's pointer", tags: ["agent"], reply: { name: "Pointer", schema: pointerDto }, errors: [503] },
];

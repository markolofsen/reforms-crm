import { Hono } from "hono";
import type { AgentContext } from "./context";
import { agentToolRoutes } from "./tools";
import { agentFeedRoutes } from "./feed-routes";
import { focusRoutes } from "./focus-routes";
import { pointerRoutes } from "./pointer-routes";

/** Every agent route over its one context (P126 S1). */
export const routes = (ctx: AgentContext) =>
  new Hono().route("/", agentToolRoutes(ctx)).route("/", agentFeedRoutes(ctx)).route("/", focusRoutes(ctx)).route("/", pointerRoutes(ctx));

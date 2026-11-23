import { Hono } from "hono";
import type { InstanceContext } from "./context";
import { coreRoutes, instanceRoutes } from "./instance-routes";
import { connectionRoutes } from "./connections-routes";
import { opsLogRoutes } from "./ops-log-routes";
import { autostartRoutes } from "./autostart-routes";

/** Every instance route over its one context (P126 S1). */
export const routes = (ctx: InstanceContext) =>
  new Hono().route("/", instanceRoutes(ctx)).route("/", coreRoutes(ctx)).route("/", connectionRoutes(ctx)).route("/", opsLogRoutes(ctx)).route("/", autostartRoutes(ctx));

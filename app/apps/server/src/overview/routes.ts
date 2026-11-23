import { Hono } from "hono";
import type { OverviewContext } from "./context";
import { healthRoutes } from "./health-routes";
import { overviewRoutes } from "./overview-routes";
import { schemeRoutes } from "./scheme-routes";

/** Health, the Overview and the scheme over one context (P126 S1). */
export const routes = (ctx: OverviewContext) => new Hono().route("/", healthRoutes(ctx)).route("/", overviewRoutes(ctx)).route("/", schemeRoutes(ctx));

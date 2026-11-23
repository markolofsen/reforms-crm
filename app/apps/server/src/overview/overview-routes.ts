import { Hono } from "hono";
import type { OverviewContext } from "./context";

/** The Overview. `GET` reads local facts only: no network, no write. */
export function overviewRoutes({ overview: service }: OverviewContext) {
  return new Hono().get("/api/overview", async (c) => c.json(await service.get()));
}

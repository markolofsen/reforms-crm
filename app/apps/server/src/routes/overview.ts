import { Hono } from "hono";
import type { OverviewService } from "../overview";

/** The Overview. `GET` reads local facts only: no network, no write. */
export function overviewRoutes(service: OverviewService) {
  return new Hono().get("/api/overview", async (c) => c.json(await service.get()));
}

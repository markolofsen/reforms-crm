import { Hono } from "hono";
import type { OverviewServices } from "../composition/capabilities";

/** The Overview. `GET` reads local facts only: no network, no write. */
export function overviewRoutes({ service }: OverviewServices) {
  return new Hono().get("/api/overview", async (c) => c.json(await service.get()));
}

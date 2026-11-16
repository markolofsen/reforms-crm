import { Hono } from "hono";
import { refreshRequest } from "@hub/contract/overview";
import { notFound, v } from "../http";
import type { OverviewService } from "../overview";

/**
 * The Overview. `GET` reads local facts and the in-memory cache: no network, no write. `POST /refresh` is a read of
 * Mail or Notion for one project (IMAP search and headers, Notion queries) and writes nothing anywhere, which is why
 * it needs no confirmation: its only effect is the server's cache.
 */
export function overviewRoutes(service: OverviewService) {
  return new Hono()
    .get("/api/overview", async (c) => c.json(await service.get()))
    .post("/api/overview/refresh", v("json", refreshRequest), async (c) => {
      const r = await service.refresh(c.req.valid("json"));
      return r ? c.json(r) : notFound(c, "Project");
    });
}

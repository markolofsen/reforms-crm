import { Hono } from "hono";
import { pulseDto } from "@hub/contract/health";
import type { OverviewContext } from "./context";

export function healthRoutes(services: OverviewContext): Hono {
  return new Hono()
    .get("/api/health", (c) => c.json(services.health()))
    .get("/api/pulse", (c) => c.json(pulseDto.parse({ dataVersion: services.dataVersion(), serverTime: services.now().toISOString(), health: services.health() })));
}

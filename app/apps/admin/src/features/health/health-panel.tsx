"use client";

import { usePulse } from "@/lib/data/instance";
import { HealthView } from "./health-view";

/** Reads `GET /api/pulse` from the browser, through the same-origin rewrite to the running Hono server. */
export function HealthPanel() {
  const query = usePulse();
  const pulse = query.data;
  const facts = pulse ? { apiVersion: pulse.health.apiVersion, dataVersion: pulse.dataVersion, serverTime: pulse.serverTime, mailer: pulse.health.mailer } : null;
  return <HealthView facts={facts} stale={query.isError} />;
}

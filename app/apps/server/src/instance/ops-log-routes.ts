import { Hono } from "hono";
import type { StatusNext } from "@hub/contract/overview";
import { opsErrorsDto, RECENT_ERRORS_HOURS, RECENT_ERRORS_LIMIT } from "@hub/contract/ops-log";
import { readOps, type OpsSource } from "@hub/log/ops";
import type { InstanceContext } from "./context";

/** The page that fixes what a source's error is about (P86): the same places as a part's `place`. Total over the sources. */
export const OPS_PLACE: Readonly<Record<OpsSource, StatusNext | null>> = {
  server: "mac",
  core: "mac",
  installer: "mac",
  db: "mac",
  whatsapp: "messengers",
  telegram: "messengers",
  telegram_bot: "messengers",
  autolink: "messengers",
  preanalysis: "messengers",
  mail: "mail",
  notion: "connections",
  send: "sending",
  agent: "agent",
  terminal: "agent",
  knowledge: "knowledge",
};

/**
 * `GET /api/ops/errors` (P86): Overview's Recent errors, the newest `error` lines of the last 24 h of the ops log, each with the
 * place that fixes it. Read only, behind the general guard; the live topic `ops-log` says when to read it again. Without a store
 * (a test app) the list is empty.
 */
export function opsLogRoutes({ opsLog: store, now }: InstanceContext) {
  return new Hono().get("/api/ops/errors", (c) => {
    const since = new Date(now().getTime() - RECENT_ERRORS_HOURS * 3_600_000).toISOString();
    const lines = store ? readOps(store, { level: "error", since }) : [];
    const rows = lines.slice(-RECENT_ERRORS_LIMIT).reverse().map((l) => ({ time: l.time, source: l.source, message: l.message.slice(0, 600), place: OPS_PLACE[l.source], project: typeof l.fields?.project === "string" && l.fields.project ? l.fields.project.slice(0, 100) : null }));
    return c.json(opsErrorsDto.parse({ rows, total: lines.length, hours: RECENT_ERRORS_HOURS }));
  });
}

import { Hono } from "hono";
import { stuckNodes } from "@hub/diagram/map";
import { clientMapDto, stuckClientsDto, type StuckClientDto } from "@hub/contract/client-map";
import { sendParam, slugParam } from "@hub/contract/requests";
import { notFound, v } from "../http/http";
import type { MailContext } from "./context";

/** P136 verdict 7f: a `waiting` node holds the client up after this many days. */
export const STUCK_WAITING_DAYS = 7;

/** Most stuck first: a blocked node, then the oldest wait; then the name. Pure. */
export function rankStuck(rows: StuckClientDto[]): StuckClientDto[] {
  const key = (r: StuckClientDto) => ({ blocked: r.nodes.some((n) => n.state === "blocked"), oldest: Math.min(...r.nodes.map((n) => Date.parse(n.since))) });
  return [...rows].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x.blocked !== y.blocked) return x.blocked ? -1 : 1;
    return x.oldest - y.oldest || a.name.localeCompare(b.name);
  });
}

/**
 * P135 K2: `GET /api/projects/:slug/clients/:id/map`, the client's map for the conversation pane's Map sheet: the current Mermaid
 * text, when it was drawn, the version before it and (P136) its sources and reasons. Read only; the agent writes a map through
 * `client_map` (hub mcp).
 * P136 Q7: `GET /api/projects/:slug/client-maps/stuck`, Overview's "Where we are stuck": the clients whose map has a blocked node
 * or one waiting a week, read from the stored versions (`@hub/diagram/map` `stuckNodes`). Read only.
 */
export function clientMapRoutes({ repos }: MailContext) {
  return new Hono()
    .get("/api/projects/:slug/clients/:id/map", v("param", sendParam), async (c) => {
      const { slug, id } = c.req.valid("param");
      const m = await repos.clientMaps.get(slug, id);
      if (!m) return notFound(c, "client");
      return c.json(clientMapDto.parse({ clientId: m.clientId, name: m.name, email: m.email, source: m.source, updatedAt: m.updatedAt, previous: m.previous, versions: m.versions, sources: m.sources, reasons: m.reasons }));
    })
    .get("/api/projects/:slug/client-maps/stuck", v("param", slugParam), async (c) => {
      const { slug } = c.req.valid("param");
      const now = Date.now();
      const rows = (await repos.clientMaps.histories(slug)).flatMap((h) => {
        const nodes = stuckNodes(h.versions, now, STUCK_WAITING_DAYS);
        return nodes.length ? [{ clientId: h.clientId, name: h.name || h.email, email: h.email, nodes }] : [];
      });
      return c.json(stuckClientsDto.parse({ project: slug, waitingDays: STUCK_WAITING_DAYS, clients: rankStuck(rows) }));
    });
}

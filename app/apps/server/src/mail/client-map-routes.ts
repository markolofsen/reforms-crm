import { Hono } from "hono";
import { clientMapDto } from "@hub/contract/client-map";
import { sendParam } from "@hub/contract/requests";
import { notFound, v } from "../http/http";
import type { MailContext } from "./context";

/**
 * P135 K2: `GET /api/projects/:slug/clients/:id/map`, the client's map for the conversation pane's Map sheet: the current Mermaid
 * text, when it was drawn and the version before it. Read only; the agent writes a map through `client_map` (hub mcp).
 */
export function clientMapRoutes({ repos }: MailContext) {
  return new Hono().get("/api/projects/:slug/clients/:id/map", v("param", sendParam), async (c) => {
    const { slug, id } = c.req.valid("param");
    const m = await repos.clientMaps.get(slug, id);
    if (!m) return notFound(c, "client");
    return c.json(clientMapDto.parse({ clientId: m.clientId, name: m.name, source: m.source, updatedAt: m.updatedAt, previous: m.previous, versions: m.versions }));
  });
}

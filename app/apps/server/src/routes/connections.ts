import { Hono } from "hono";
import { connectionDto, connectionsDto } from "@hub/contract/connections";
import { notFound } from "../http";
import { NotTestable, type ConnectionsService } from "../connections";

/**
 * The Connections panel. `GET` reads files and settings and the in-memory test results: no network, no write.
 * `POST .../test` is one read-only probe of one connection (Notion `users/me`, Telegram `getMe`, an IMAP login and a mailbox list). Neither
 * route can send, draft or change a draft, and none returns a secret: the reply schemas have no field for one.
 */
export function connectionRoutes(service: ConnectionsService) {
  return new Hono()
    .get("/api/connections", async (c) => c.json(connectionsDto.parse(await service.list())))
    .post("/api/connections/:id/test", async (c) => {
      try {
        const r = await service.test(c.req.param("id"));
        return r ? c.json(connectionDto.parse(r)) : notFound(c, "Connection");
      } catch (e) {
        if (e instanceof NotTestable) return c.json({ error: e.message, code: "wrong_state" as const }, 409);
        throw e;
      }
    });
}

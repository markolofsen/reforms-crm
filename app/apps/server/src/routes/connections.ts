import { Hono } from "hono";
import { connectionDto, connectionsDto } from "@hub/contract/connections";
import { setSecretBody } from "@hub/contract/requests";
import type { ConnectionsServices } from "../composition/capabilities";
import { notFound, v } from "../http";
import { NotTestable, Refusal } from "../connections";

/**
 * Settings ▸ Connections and ▸ Mail (P70). `GET` reads files and settings and the in-memory test results: no network, no write.
 * `POST .../test` is one read-only probe of one connection (Notion `users/me`, Telegram `getMe`, an IMAP login and a mailbox list). Neither
 * route can send, draft or change a draft, and none returns a secret: the reply schemas have no field for one.
 * The two writes (decision 0020) are the only way a key enters from the browser and the only way one leaves the folder: `PUT .../secret`
 * stores it (mode 600, atomic), `POST .../remove` deletes the file. The body of a PUT is never logged, echoed or kept.
 */
export function connectionRoutes({ service }: ConnectionsServices) {
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
    })
    .put("/api/connections/:id/secret", v("json", setSecretBody), async (c) => {
      try {
        const r = await service.setSecret(c.req.param("id"), c.req.valid("json"));
        return r ? c.json(connectionDto.parse(r)) : notFound(c, "Connection");
      } catch (e) {
        if (e instanceof Refusal) return c.json({ error: e.message, code: e.status === 400 ? ("invalid" as const) : ("wrong_state" as const) }, e.status);
        throw e;
      }
    })
    .post("/api/connections/:id/remove", async (c) => {
      try {
        const r = await service.removeSecret(c.req.param("id"));
        return r ? c.json(connectionDto.parse(r)) : notFound(c, "Connection");
      } catch (e) {
        if (e instanceof Refusal) return c.json({ error: e.message, code: "wrong_state" as const }, 409);
        throw e;
      }
    });
}

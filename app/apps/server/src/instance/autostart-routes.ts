import { Hono } from "hono";
import { sentenceOf } from "@hub/contract/errors";
import { autostartDto, setAutostartBody } from "@hub/contract/autostart";
import { gateRefusal } from "../http/admin-gate";
import type { AutostartServices } from "../composition/capabilities";
import { HubError } from "@hub/config/errors";

/**
 * `GET /api/instance/autostart` reads whether this Mac starts the Hub at login (P67); `POST` with `{enabled}` switches it. The
 * switch changes what the Mac does at the next login, so it is the admin page's door only (exact admin Origin, loopback Host,
 * `Sec-Fetch-Site: same-origin`, as the local Open). The body is strict: the label is the server's. Without the service (tests,
 * off macOS the server still passes one) both are 404.
 */
export function autostartRoutes({ service, adminPort }: AutostartServices) {
  return new Hono()
    .get("/api/instance/autostart", async (c) => {
      if (!service) return c.json({ error: "No autostart on this server.", code: "not_found" as const }, 404);
      return c.json(autostartDto.parse(await service.read()));
    })
    .post("/api/instance/autostart", async (c) => {
      const why = gateRefusal({ origin: c.req.header("origin"), host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site") }, adminPort, { sameSite: true });
      if (why) return c.json({ error: `Refused: ${why}.`, code: "forbidden" as const }, 403);
      if (!service) return c.json({ error: "No autostart on this server.", code: "not_found" as const }, 404);
      const parsed = setAutostartBody.safeParse(await c.req.json().catch(() => undefined));
      if (!parsed.success) return c.json({ error: sentenceOf(parsed.error), code: "invalid" as const }, 400);
      try {
        return c.json(autostartDto.parse(await service.set(parsed.data.enabled)));
      } catch (e) {
        // A HubError (AutostartNotSetUp: 409) is the server's onError's (P126 E1); launchctl's own failure is named here.
        if (e instanceof HubError) throw e;
        return c.json({ error: `Not switched: ${e instanceof Error ? e.message : String(e)}`, code: "server" as const }, 500);
      }
    });
}

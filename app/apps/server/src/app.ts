import { Hono } from "hono";
import { ALLOWED_HOSTNAMES } from "@hub/config";
import { isBusy } from "@hub/db";
import { HubError, STATUS_OF, type ErrorKind } from "@hub/config/errors";
import type { ApiErrorCode } from "@hub/contract/errors";
import { errFields, ops } from "@hub/log/ops";
import type { Runtime } from "./composition/runtime";
import { contexts } from "./composition/contexts";
import { routes as overview } from "./overview/routes";
import { routes as projects } from "./projects/routes";
import { routes as instance } from "./instance/routes";
import { routes as mail } from "./mail/routes";
import { routes as messengers } from "./messengers/routes";
import { routes as agent } from "./agent/routes";
import { sendRoutes } from "./send/sends-routes";
import { liveRoutes } from "./live/routes";
import { terminalRoutes } from "./terminal/routes";
import { localRoutes } from "./local/routes";

/** The wire code of a kind (`@hub/contract/errors`): the kind itself, except a failed upstream service, which the wire calls `server`. */
const wireCode = (kind: ErrorKind): ApiErrorCode => (kind === "upstream" ? "server" : kind);
const allowed = (v: string) => (ALLOWED_HOSTNAMES as readonly string[]).includes(v);
const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

/**
 * The whole API over one runtime (P126 S1): the Host/Origin guard, one error mapper, one `.route` per domain. Loopback only: the
 * listener binds 127.0.0.1, and every request must name a loopback host (DNS-rebinding guard) and, when it has one, a loopback
 * Origin. No CORS headers are set. Sending is the one confirmed route (`send/sends-routes.ts`, decision 0011). Every refusal is
 * `{ error, code }` (`@hub/contract/errors`); a locked database is 503 `busy`.
 */
export function createApp(rt: Runtime) {
  const ctx = contexts(rt);
  return new Hono()
    .onError((err, c) => {
      // P126 E1: every refusal the Hub states is a HubError; its kind gives the status (a failed upstream is the wire's `server`).
      if (err instanceof HubError) return c.json({ ...err.detail, error: err.message, code: wireCode(err.kind) }, STATUS_OF[err.kind]);
      if (isBusy(err)) return c.json({ error: "The database is busy with another write. Try again in a moment.", code: "busy" as const }, 503);
      ops("server").error(`500 ${c.req.method} ${c.req.path}`, errFields(err, true));
      return c.json({ error: "server error", code: "server" as const }, 500);
    })
    .use("*", async (c, next) => {
      const origin = c.req.header("origin");
      const originHost = origin ? hostOf(origin) : null;
      if (!allowed(new URL(c.req.url).hostname) || (origin && (!originHost || !allowed(originHost)))) return c.json({ error: "forbidden host", code: "forbidden" as const }, 403);
      await next();
    })
    .route("/", overview(ctx.overview))
    .route("/", liveRoutes(ctx.live))
    .route("/", projects(ctx.projects))
    .route("/", instance(ctx.instance))
    .route("/", mail(ctx.mail))
    .route("/", sendRoutes(ctx.send))
    .route("/", agent(ctx.agent))
    .route("/", terminalRoutes(ctx.terminal))
    .route("/", localRoutes(ctx.local))
    .route("/", messengers(ctx.messengers));
}

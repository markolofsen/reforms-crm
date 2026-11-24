import { Hono } from "hono";
import { ALLOWED_HOSTNAMES } from "@hub/config";
import { isBusy } from "@hub/db";
import { HubError, STATUS_OF, type ErrorKind } from "@hub/config/errors";
import type { ApiErrorCode } from "@hub/contract/errors";
import { ACTION_HEADER, isActionId, newActionId } from "@hub/config/action-id";
import { errFields, ops, withAction } from "@hub/log/ops";
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

/** A request slower than this is a `warn` line (P137 verdict 3); the live stream and the terminal socket stay open on purpose. */
export const SLOW_REQUEST_MS = 2000;
const LONG_LIVED = /^\/api\/(live|terminal\/socket)/;

/** The request's own line, when it has one: a 5xx (not the 500 the mapper logged) or a slow answer. */
function requestLine(method: string, path: string, status: number, ms: number): void {
  if (status >= 500 && status !== 500) ops("server").warn(`${status} ${method} ${path}`, { status, ms });
  else if (ms > SLOW_REQUEST_MS && !LONG_LIVED.test(path)) ops("server").warn(`slow request ${method} ${path}`, { status, ms });
}

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
      // P137 L1: the request runs as one action (the admin's id, else a fresh one); every ops line inside carries it.
      const sent = c.req.header(ACTION_HEADER);
      const action = isActionId(sent) ? sent : newActionId("r");
      const t0 = Date.now();
      await withAction(action, () => next());
      c.header(ACTION_HEADER, action);
      // P137 L2: a slow request and a 5xx other than the mapper's own 500 (logged there with its stack) are one line each.
      await withAction(action, async () => requestLine(c.req.method, c.req.path, c.res.status, Date.now() - t0));
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

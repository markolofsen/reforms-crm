import type { MiddlewareHandler } from "hono";
import { ACTION_HEADER, isActionId, newActionId } from "@hub/config/action-id";
import { ops, withAction } from "@hub/log/ops";

/** A request slower than this is a `warn` line (P137 verdict 3); the live stream and the terminal socket stay open on purpose. */
export const SLOW_REQUEST_MS = 2000;
const LONG_LIVED = /^\/api\/(live|terminal\/socket)/;

/** The request's own line, when it has one: a 5xx (not the 500 the error mapper logged with its stack) or a slow answer. */
function requestLine(method: string, path: string, status: number, ms: number): void {
  if (status >= 500 && status !== 500) ops("server").warn(`${status} ${method} ${path}`, { status, ms });
  else if (ms > SLOW_REQUEST_MS && !LONG_LIVED.test(path)) ops("server").warn(`slow request ${method} ${path}`, { status, ms });
}

/**
 * P137 L1-L2: the request runs as one action, the admin's `x-hub-action` when it is a valid id, else a fresh one; every ops line
 * written inside carries it, and the reply names it. Then a slow request or a 5xx leaves its one line, under the same action.
 */
export const actionOfRequest: MiddlewareHandler = async (c, next) => {
  const sent = c.req.header(ACTION_HEADER);
  const action = isActionId(sent) ? sent : newActionId("r");
  const t0 = Date.now();
  await withAction(action, () => next());
  c.header(ACTION_HEADER, action);
  withAction(action, () => requestLine(c.req.method, c.req.path, c.res.status, Date.now() - t0));
};

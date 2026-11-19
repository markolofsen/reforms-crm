import { Hono } from "hono";
import { sentenceOf } from "@hub/contract/errors";
import { isLocalAction, isServerAction, LOCAL_ACTIONS, localOpenedDto } from "@hub/contract/local";
import { isRefusal, LOCAL_OPEN_UNAVAILABLE, openTarget, resolveTarget, type OpenRun, type ResolveDeps } from "@hub/projects/local-open";
import { gateRefusal } from "../admin-gate";

/** What the server needs to run an Open (P61): the key resolver's deps, the opener, and whether this machine can open at all. */
export interface LocalService {
  deps: ResolveDeps;
  run: OpenRun;
  available: boolean;
  now?: () => number;
}

/** At most one open per action and key in this window: a held key or a double click must not stack Finder windows. */
const REPEAT_MS = 500;

/**
 * `POST /api/local/:action` (P61): the `server` actions of `@hub/contract/local` only (an `href` id is 404: the browser
 * opens those itself). The body is that action's strict schema: a project and a KEY, never a path; the path is resolved
 * here inside the key's own root and never leaves the server. An open takes the owner's screen, so the door is the
 * focus door's (exact admin Origin, loopback Host, `Sec-Fetch-Site: same-origin`): another loopback page cannot pop
 * Finder windows. No ticket: nothing is written or sent.
 */
export function localRoutes(local: LocalService | undefined, adminPort: number) {
  const last = new Map<string, number>();
  return new Hono().post("/api/local/:action", async (c) => {
    const why = gateRefusal({ origin: c.req.header("origin"), host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site") }, adminPort, { sameSite: true });
    if (why) return c.json({ error: `Refused: ${why}.`, code: "forbidden" as const }, 403);
    const id = c.req.param("action");
    if (!local || !isLocalAction(id) || !isServerAction(id)) return c.json({ error: "No such local action on the server.", code: "not_found" as const }, 404);
    const def = LOCAL_ACTIONS[id];
    const parsed = def.args.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: sentenceOf(parsed.error), code: "invalid" as const }, 400);
    if ("offered" in def && def.offered === false) return c.json({ error: `${def.refusal}.`, code: "server" as const }, 501);
    if (!local.available) return c.json({ error: `${LOCAL_OPEN_UNAVAILABLE}.`, code: "server" as const }, 501);
    const args = parsed.data as { project: string; key: string };
    const at = (local.now ?? Date.now)();
    const k = `${id}|${args.project}|${args.key}`;
    if (at - (last.get(k) ?? -Infinity) < REPEAT_MS) return c.json({ error: "Already opening that: wait a moment.", code: "busy" as const }, 429);
    last.set(k, at);
    if (last.size > 256) last.delete(last.keys().next().value as string);
    const target = await resolveTarget(id, parsed.data, local.deps);
    if (isRefusal(target)) return c.json({ error: `Not opened: ${target.refused}.`, code: target.status === 404 ? ("not_found" as const) : ("invalid" as const) }, target.status === 501 ? 400 : target.status);
    try {
      await openTarget(target, local.run);
    } catch {
      // The opener's own words may hold the path: they stay in the server.
      return c.json({ error: "Not opened: macOS could not open it.", code: "server" as const }, 500);
    }
    return c.json(localOpenedDto.parse({ ok: true, opened: target.label }));
  });
}

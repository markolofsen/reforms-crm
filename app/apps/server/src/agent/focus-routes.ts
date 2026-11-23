import { Hono } from "hono";
import { sentenceOf } from "@hub/contract/errors";
import { focusInput } from "@hub/contract/focus";
import { okDto } from "@hub/contract/review";
import { gateRefusal } from "../http/admin-gate";
import type { AgentContext } from "./context";

/**
 * `POST /api/focus` (P51): the admin tab publishes what it shows. No GET: the admin knows its own focus, and the agent reads
 * the file through `hub focus` and `hub mcp`. As strict as the send and terminal tickets (exact admin Origin, loopback Host,
 * `Sec-Fetch-Site: same-origin`, strict body), because a forged focus steers the agent: "answer this client" would revise
 * another client's draft. The agent's sandbox has no loopback; the agent never writes the focus.
 */
export function focusRoutes({ focus: store, adminPort }: AgentContext) {
  return new Hono().post("/api/focus", async (c) => {
    if (!store) return c.json({ error: "focus not found", code: "not_found" as const }, 404);
    const why = gateRefusal({ origin: c.req.header("origin"), host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site") }, adminPort, { sameSite: true });
    if (why) return c.json({ error: `Refused: ${why}.`, code: "forbidden" as const }, 403);
    const parsed = focusInput.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: sentenceOf(parsed.error), code: "invalid" as const }, 400);
    store.post(parsed.data);
    return c.json(okDto.parse({ ok: true }));
  });
}

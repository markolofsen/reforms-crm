import { Hono, type Context } from "hono";
import { okDto } from "@hub/contract/responses";
import { createSessionBody, ensureSessionBody, ensureSessionDto, terminalSessionDto, terminalStateDto, terminalTicketBody, terminalTicketDto } from "@hub/contract/terminal";
import { gateRefusal } from "../admin-gate";
import { notFound, v } from "../http";
import { TerminalRefusal, type TerminalService } from "../terminal";

/**
 * `/api/terminal` (P49). Off: the state says `{enabled: false}` and every other route is 404, so nothing is advertised.
 * A ticket, a new session and `ensure` need the admin's exact origin and a same-origin fetch (S4, S5); no route takes a command or a path (S7).
 */
export function terminalRoutes(t: TerminalService | undefined, adminPort: number) {
  const off = (c: Context) => c.json({ error: "terminal not found", code: "not_found" as const }, 404);
  /** The exact admin Origin and a same-origin fetch: a tab starts without a click on a `+` item (P57 2f), so both start doors take it. */
  const strict = (c: Context) => {
    const why = gateRefusal({ origin: c.req.header("origin"), host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site") }, adminPort, { sameSite: true });
    return why ? c.json({ error: `Refused: ${why}.`, code: "forbidden" as const }, 403) : null;
  };
  const refusal = (c: Context, e: unknown) => {
    if (!(e instanceof TerminalRefusal)) throw e;
    const code = e.status === 404 ? ("not_found" as const) : e.status === 409 ? ("wrong_state" as const) : ("invalid" as const);
    return c.json({ error: e.message, code }, e.status);
  };
  return new Hono()
    .get("/api/terminal", (c) => c.json(terminalStateDto.parse(t?.enabled() ? t.state() : { enabled: false })))
    .post("/api/terminal/sessions", v("json", createSessionBody), async (c) => {
      if (!t?.enabled()) return off(c);
      const no = strict(c);
      if (no) return no;
      const { preset, project, theme } = c.req.valid("json");
      try {
        return c.json(terminalSessionDto.parse(await t.create(preset, project, theme)), 201);
      } catch (e) {
        return refusal(c, e);
      }
    })
    .post("/api/terminal/ensure", v("json", ensureSessionBody), async (c) => {
      if (!t?.enabled()) return off(c);
      const no = strict(c);
      if (no) return no;
      const { project, theme } = c.req.valid("json");
      try {
        const r = await t.ensure(project, theme);
        return c.json(ensureSessionDto.parse(r), r.created ? 201 : 200);
      } catch (e) {
        return refusal(c, e);
      }
    })
    .delete("/api/terminal/sessions/:id", (c) => {
      if (!t?.enabled()) return off(c);
      return t.close(c.req.param("id")) ? c.json(okDto.parse({ ok: true })) : notFound(c, "terminal session");
    })
    .post("/api/terminal/tickets", v("json", terminalTicketBody), (c) => {
      if (!t?.enabled()) return off(c);
      const no = strict(c);
      if (no) return no;
      const id = c.req.valid("json").session;
      if (!t.has(id)) return notFound(c, "terminal session");
      return c.json(terminalTicketDto.parse(t.ticket(id)));
    });
}

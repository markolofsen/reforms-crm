import { Hono, type Context } from "hono";
import { inboundMoveBody, inboundMoveParam, inboundMovedDto } from "@hub/contract/lead-pass";
import { AGENT_SEND_HEADER, tokenMatches } from "@hub/agent/send-token";
import type { SendDeps } from "@hub/send/assess";
import { gateRefusal } from "../http/admin-gate";
import { v } from "../http/http";
import type { ProjectsContext } from "../projects/context";
import { moveInbound, type MoveResult } from "./mail-junk";

// P147 3n: one inbound message to Mail's Junk or Trash. The owner's door (the pane's Spam and Delete, the list's selection) takes
// the admin's exact Origin and is never refused for who sent it; the agent's (`mail_junk`, a loopback call with the agent send
// token, decision 0046) is refused for someone we know. Both recoverable in Mail. Nothing is sent.

export function mailMoveRoutes(o: { repos: ProjectsContext["repos"]; deps: SendDeps | undefined; adminPort: number | undefined; agentToken?: string | undefined }) {
  const answer = (c: Context, to: "junk" | "trash", r: MoveResult) =>
    r.ok ? c.json(inboundMovedDto.parse({ ok: true, to, closed: r.closed.length })) : c.json({ error: r.error, code: r.code === "refused" ? ("forbidden" as const) : r.code }, r.code === "not_found" ? 404 : r.code === "refused" ? 403 : 409);
  const body = async (c: Context) => inboundMoveBody.safeParse(await c.req.json().catch(() => ({})));
  return new Hono()
    .post("/api/projects/:slug/mail/inbound/:id/move", v("param", inboundMoveParam), v("json", inboundMoveBody), async (c) => {
      const why = o.adminPort === undefined ? "no admin port" : gateRefusal({ origin: c.req.header("origin"), host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site") }, o.adminPort, { sameSite: true });
      if (why) return c.json({ error: `Not moved: ${why}.`, code: "forbidden" as const }, 403);
      if (!o.deps) return c.json({ error: "Mail is not set up on this server.", code: "wrong_state" as const }, 409);
      const { slug, id } = c.req.valid("param");
      const { to } = c.req.valid("json");
      return answer(c, to, await moveInbound({ repos: o.repos, mailer: o.deps.mailer }, slug, id, { to, by: "owner", at: o.deps.now?.() ?? new Date() }));
    })
    .post("/api/projects/:slug/mail/inbound/:id/agent-junk", v("param", inboundMoveParam), async (c) => {
      if (!o.agentToken || !tokenMatches(c.req.header(AGENT_SEND_HEADER), o.agentToken)) return c.json({ error: "Refused: only the hub's own MCP server may ask this.", code: "forbidden" as const }, 403);
      if (!o.deps) return c.json({ error: "Mail is not set up on this server.", code: "wrong_state" as const }, 409);
      const { slug, id } = c.req.valid("param");
      const b = await body(c);
      if (!b.success) return c.json({ error: "to is junk or trash.", code: "invalid" as const }, 400);
      return answer(c, b.data.to, await moveInbound({ repos: o.repos, mailer: o.deps.mailer }, slug, id, { to: b.data.to, by: "attended", at: o.deps.now?.() ?? new Date() }));
    });
}

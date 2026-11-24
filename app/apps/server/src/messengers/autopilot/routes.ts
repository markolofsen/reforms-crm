import { Hono, type Context } from "hono";
import { autopilotChatKey } from "@hub/config/autopilot";
import { autopilotInstanceDto, autopilotProjectDto, autopilotScope, autopilotTicketBody, setAutopilotInstanceBody, setAutopilotProjectBody, type SetAutopilotProjectBody } from "@hub/contract/autopilot";
import { slugParam } from "@hub/contract/requests";
import { sendTicketDto } from "@hub/contract/sending";
import { ops } from "@hub/log/ops";
import type { AutopilotChange } from "@hub/projects/autopilot";
import { gateRefusal, ticketStore } from "../../http/admin-gate";
import { notFound, v } from "../../http/http";
import type { MessengersContext } from "../context";

// The owner's autopilot routes (decision 0048 point 2, P139 A1, verdict 5). Reads are behind the general guard. Every write is
// the owner's door: the admin's exact Origin, a loopback Host and `Sec-Fetch-Site: same-origin` (as the send ticket), and a
// single-use 60 s ticket bound to `autopilot:<scope>`. The agent has no tool for any of this, `hub mcp` holds no ticket, and the
// two files are protected paths, so a session can neither call these nor write what they write. Switching off cancels the
// waiting and running turns at once; switching a chat on clears its pause (the owner switched it on again, verdict 15).

/** A ticket lives 60 s: the owner flipped the switch; the write follows at once. */
const TICKET_TTL_MS = 60_000;
const log = ops("autopilot");

const changeOf = (b: SetAutopilotProjectBody, chat: string | null): AutopilotChange | null => {
  switch (b.kind) {
    case "mode":
      return { kind: "mode", mode: b.mode };
    case "chat":
      return chat === null ? null : { kind: "chat", chat, on: b.on };
    case "disclose":
      return { kind: "disclose", disclose: b.disclose };
    case "quiet":
      return { kind: "quiet", quiet: b.quiet };
    default:
      return null;
  }
};

export function autopilotRoutes(ctx: MessengersContext) {
  const tickets = ctx.autopilotTickets ?? ticketStore({ ttlMs: TICKET_TTL_MS });
  const now = ctx.now ?? (() => new Date());
  const refusal = (c: Context): string | null =>
    gateRefusal({ origin: c.req.header("origin"), host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site") }, ctx.adminPort, { sameSite: true });
  const forbidden = (c: Context, why: string) => c.json({ error: `Not switched: ${why}.`, code: "forbidden" as const }, 403);
  const off = (c: Context) => c.json({ error: "No autopilot on this server.", code: "not_found" as const }, 404);
  const known = (slug: string): boolean => {
    try {
      ctx.autopilot?.switches.project(slug);
      return true;
    } catch {
      return false;
    }
  };

  return new Hono()
    .post("/api/autopilot/tickets", v("json", autopilotTicketBody), (c) => {
      const why = refusal(c);
      if (why) return forbidden(c, why);
      if (!ctx.autopilot) return off(c);
      const body = c.req.valid("json");
      if (body.scope === "project" && !known(body.project)) return notFound(c, "project");
      return c.json(sendTicketDto.parse(tickets.mint(autopilotScope(body))));
    })
    .get("/api/autopilot", (c) => {
      if (!ctx.autopilot) return off(c);
      const st = ctx.autopilot.switches.instance();
      return c.json(autopilotInstanceDto.parse({ on: st.value.on, updatedAt: st.value.updatedAt || null, by: st.source === "file" ? st.value.by : null, error: st.error ?? null }));
    })
    .put("/api/autopilot", v("json", setAutopilotInstanceBody), (c) => {
      const why = refusal(c);
      if (why) return forbidden(c, why);
      if (!ctx.autopilot) return off(c);
      const { on, ticket } = c.req.valid("json");
      if (!tickets.take(ticket, "autopilot:instance")) return forbidden(c, "the switch needs a fresh ticket from the admin page");
      const written = ctx.autopilot.switches.setInstance(on, "owner", now());
      if (!on) ctx.autopilot.scheduler.cancel(() => true);
      log.info(`instance switch ${on ? "on" : "off"}`, { on });
      return c.json(autopilotInstanceDto.parse({ on: written.on, updatedAt: written.updatedAt, by: written.by, error: null }));
    })
    .get("/api/projects/:slug/autopilot", v("param", slugParam), async (c) => {
      if (!ctx.autopilot) return off(c);
      const { slug } = c.req.valid("param");
      if (!known(slug)) return notFound(c, "project");
      return c.json(autopilotProjectDto.parse(await ctx.autopilot.switches.view(slug)));
    })
    .put("/api/projects/:slug/autopilot", v("param", slugParam), v("json", setAutopilotProjectBody), async (c) => {
      const why = refusal(c);
      if (why) return forbidden(c, why);
      const ap = ctx.autopilot;
      if (!ap) return off(c);
      const { slug } = c.req.valid("param");
      const body = c.req.valid("json");
      if (!known(slug)) return notFound(c, "project");
      if (!tickets.take(body.ticket, `autopilot:project:${slug}`)) return forbidden(c, "the switch needs a fresh ticket from the admin page");
      const row = body.kind === "chat" ? await ctx.repos.messengers.chatById(slug, body.chat) : null;
      if (body.kind === "chat" && !row) return notFound(c, "chat");
      const change = changeOf(body, row ? autopilotChatKey(row.channel, row.chatId) : null);
      if (!change) return notFound(c, "chat");
      try {
        ap.switches.setProject(slug, change, "owner", now());
      } catch (e) {
        return c.json({ error: `Not switched: ${e instanceof Error ? e.message : String(e)}`, code: "wrong_state" as const }, 409);
      }
      if (row && body.kind === "chat") {
        if (body.on) await ctx.repos.messengers.setAutopilotPause(slug, row.channel, row.chatId, null);
        else ap.scheduler.cancel((x) => x.project === slug && x.channel === row.channel && x.chatId === row.chatId);
      }
      if (body.kind === "mode" && body.mode === "off") ap.scheduler.cancel((x) => x.project === slug);
      log.info(`project switch: ${body.kind}`, { project: slug, ...(row ? { chat: row.id } : {}), ...(body.kind === "mode" ? { mode: body.mode } : body.kind === "chat" ? { on: body.on } : {}) });
      return c.json(autopilotProjectDto.parse(await ap.switches.view(slug)));
    });
}

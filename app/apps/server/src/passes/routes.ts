import { Hono, type Context } from "hono";
import { leadPageParam, leadPassDto, leadRedoneDto, runLeadPassBody } from "@hub/contract/lead-pass";
import { slugParam } from "@hub/contract/requests";
import { LEAD_PASS_DEFAULT_AT, LEAD_PASS_DEFAULT_SCHEDULE, MAIL_PASS_DEFAULT_AT } from "@hub/config/lead-pass";
import { AGENT_SEND_HEADER, tokenMatches } from "@hub/agent/send-token";
import { gateRefusal } from "../http/admin-gate";
import { notFound, v } from "../http/http";
import type { ProjectsContext } from "../projects/context";

// The lead pass routes (decision 0055, P147 L4). The read is behind the general guard. The owner's writes (Run lead pass now,
// Redo) take the admin's exact Origin, a loopback Host and `Sec-Fetch-Site: same-origin`; no ticket, since they only start a pass
// or clear one decision. A pass runs in the background: the POST answers at once.

const DAY_MS = 86_400_000;

export function leadPassRoutes(ctx: ProjectsContext) {
  const { repos, now } = ctx;
  const known = async (slug: string) => (await repos.projects.list()).includes(slug);
  const door = (c: Context): Response | null => {
    const why = ctx.adminPort === undefined ? "no admin port" : gateRefusal({ origin: c.req.header("origin"), host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site") }, ctx.adminPort, { sameSite: true });
    return why ? c.json({ error: `Not changed: ${why}.`, code: "forbidden" as const }, 403) : null;
  };

  return new Hono()
    .get("/api/projects/:slug/lead-pass", v("param", slugParam), async (c) => {
      const { slug } = c.req.valid("param");
      if (!(await known(slug))) return notFound(c, "project");
      const at = now();
      const cfg = ctx.projects.find(slug)?.leads;
      const settings = { schedule: cfg?.pass ?? LEAD_PASS_DEFAULT_SCHEDULE, at: cfg?.passAt ?? LEAD_PASS_DEFAULT_AT };
      const from = new Date(at.getTime() - (cfg?.windowDays ?? 14) * DAY_MS).toISOString();
      const rows = await repos.leadPass.decided(slug, from);
      const today = { drafted: 0, spam: 0, notNow: 0, forYou: 0, sent: 0, excluded: 0 };
      for (const r of rows) {
        if (r.display === "drafted") today.drafted++;
        else if (r.display === "proposed") today[r.passDecision === "spam" ? "spam" : "notNow"]++;
        else if (r.display === "for_you") today.forYou++;
        else if (r.display === "sent") today.sent++;
        else if (r.display === "excluded") today.excluded++;
      }
      const sch = ctx.leadPass?.schedule;
      const last = await repos.leadPass.lastPass(slug);
      const batchId = await repos.leadPass.openBatch(slug);
      const waits = (d: string) => d === "drafted" || d === "for_you";
      // P145 B4: a fixed bug's note in the day's list counts as one more reply waiting, while its draft is unsent.
      const notes = async (id: number) => {
        let n = 0;
        for (const x of await repos.bugNotes.ofBatch(slug, id)) if (x.toldAt === null && x.draftId !== null && (await repos.drafts.get(x.draftId))?.status === "ready") n++;
        return n;
      };
      const drafts = batchId === null ? 0 : (await repos.leadPass.ofBatch(slug, batchId)).filter((r) => waits(r.display)).length + (await repos.mailPass.ofBatch(slug, batchId)).filter((r) => waits(r.display)).length + (await notes(batchId));
      // P147 3h: the mail pass's line, on the same runner.
      const mcfg = ctx.projects.find(slug)?.mail;
      const mset = { schedule: mcfg?.pass ?? LEAD_PASS_DEFAULT_SCHEDULE, at: mcfg?.passAt ?? MAIL_PASS_DEFAULT_AT };
      const mrows = await repos.mailPass.decided(slug, new Date(at.getTime() - (mcfg?.passWindowDays ?? 3) * DAY_MS).toISOString());
      const mtoday = { drafted: mrows.filter((r) => r.display === "drafted").length, proposed: mrows.filter((r) => r.display === "proposed").length, forYou: mrows.filter((r) => r.display === "for_you").length };
      const mlast = await repos.leadPass.lastPass(slug, "mail");
      return c.json(
        leadPassDto.parse({
          today,
          pass: {
            ...settings,
            last,
            next: sch ? await sch.next(slug, settings) : null,
            running: sch?.isRunning(slug) ?? false,
            runNowOff: sch ? await sch.runNowOff(slug) : "this server has no lead pass model",
            stopped: last?.error ?? null,
          },
          review: { batchId: drafts > 0 || today.spam + today.notNow + mtoday.proposed > 0 ? batchId : null, drafts, proposals: today.spam + today.notNow + mtoday.proposed },
          mail: { ...mset, last: mlast, next: sch ? await sch.next(slug, mset, "mail") : null, running: sch?.isRunning(slug, "mail") ?? false, runNowOff: sch ? await sch.runNowOff(slug, "mail") : "this server has no pass model", stopped: mlast?.error ?? null, today: mtoday },
        }),
      );
    })
    .post("/api/projects/:slug/lead-pass", v("param", slugParam), v("json", runLeadPassBody), async (c) => {
      const refused = door(c);
      if (refused) return refused;
      const { slug } = c.req.valid("param");
      const { pass } = c.req.valid("json");
      if (!(await known(slug))) return notFound(c, "project");
      const sch = ctx.leadPass?.schedule;
      if (!sch) return c.json({ error: "This server has no lead pass model: nothing runs here.", code: "wrong_state" as const }, 409);
      const r = await sch.runNow(slug, "button", pass ?? "lead");
      if ("refused" in r) return c.json({ error: `${r.refused}.`, code: "wrong_state" as const }, 409);
      return c.json({ ok: true as const, joined: r.joined }, 202);
    })
    // F3 of 3d: `hub mcp`'s `lead_pass_start` (the dock's "process the leads"), a loopback call with the agent send token (decision
    // 0046), never the admin's Origin. It starts the same pass as the button (trigger dock, the same 3 a day) and answers at once.
    .post("/api/projects/:slug/lead-pass/agent-run", v("param", slugParam), v("json", runLeadPassBody), async (c) => {
      if (!ctx.agentToken || !tokenMatches(c.req.header(AGENT_SEND_HEADER), ctx.agentToken)) return c.json({ error: "Refused: only the hub's own MCP server may ask this.", code: "forbidden" as const }, 403);
      const { slug } = c.req.valid("param");
      if (!(await known(slug))) return notFound(c, "project");
      const sch = ctx.leadPass?.schedule;
      if (!sch) return c.json({ error: "This server has no lead pass model: nothing runs here.", code: "wrong_state" as const }, 409);
      const r = await sch.runNow(slug, "dock", c.req.valid("json").pass ?? "lead");
      if ("refused" in r) return c.json({ error: `${r.refused}.`, code: "wrong_state" as const }, 409);
      return c.json({ ok: true as const, joined: r.joined }, 202);
    })
    // Redo (verdict 3): the lead's decision is cleared, so the next pass decides it again. Its draft, if any, stays in Mail.
    .post("/api/projects/:slug/leads/:pageId/redo", v("param", leadPageParam), async (c) => {
      const refused = door(c);
      if (refused) return refused;
      const { slug, pageId } = c.req.valid("param");
      const id = pageId.replace(/-/g, "").toLowerCase();
      if (!(await repos.leadPass.redo(slug, id))) return notFound(c, "lead");
      return c.json(leadRedoneDto.parse({ ok: true, pageId: id }));
    });
}

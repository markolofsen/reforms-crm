import { Hono, type Context } from "hono";
import { followUpChangedDto, followUpParam, followUpsDto, runFollowUpsBody, setFollowUpBody, type FollowUpDto } from "@hub/contract/follow-ups";
import { slugParam } from "@hub/contract/requests";
import { gateRefusal } from "../http/admin-gate";
import { notFound, v } from "../http/http";
import type { ProjectsContext } from "../projects/context";
import { nextRun } from "./schedule";

// The follow-up routes (decision 0050 point 9, P142 F4 and F6). The read is behind the general guard. The owner's writes (Run
// follow-ups now, Change date, Stop, Resume) take the admin's exact Origin, a loopback Host and `Sec-Fetch-Site: same-origin`; no
// ticket, since they only start a sweep, delay or stop (verdict 15). A sweep runs in the background: the POST answers at once.

type FollowUpItem = Awaited<ReturnType<ProjectsContext["repos"]["followUps"]["list"]>>[number];

const dto = (p: FollowUpItem): FollowUpDto => ({ clientId: p.clientId, name: p.clientName, state: p.state, display: p.display, nextAt: p.nextAt, waitingOn: p.waitingOn, nudgesSent: p.nudgesSent, lastNudgeAt: p.lastNudgeAt, channel: p.channel, reason: p.reason, stopReason: p.stopReason, line: p.line, decidedBy: p.decidedBy, decidedAt: p.decidedAt });

export function followUpRoutes(ctx: ProjectsContext) {
  const { repos, now } = ctx;
  const known = async (slug: string) => (await repos.projects.list()).includes(slug);
  const door = (c: Context): Response | null => {
    const why = ctx.adminPort === undefined ? "no admin port" : gateRefusal({ origin: c.req.header("origin"), host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site") }, ctx.adminPort, { sameSite: true });
    return why ? c.json({ error: `Not changed: ${why}.`, code: "forbidden" as const }, 403) : null;
  };

  return new Hono()
    .get("/api/projects/:slug/follow-ups", v("param", slugParam), async (c) => {
      const { slug } = c.req.valid("param");
      if (!(await known(slug))) return notFound(c, "project");
      const at = now();
      const rows = await repos.followUps.list(slug, at);
      const cfg = ctx.projects.find(slug)?.followUps ?? { schedule: "daily" as const, at: "09:00" };
      const sch = ctx.followUps?.schedule;
      const last = await repos.followUps.lastSweep(slug);
      const swept = sch ? await sch.sweptToday(slug) : false;
      const today = { ready: 0, waiting: 0, due: 0, stopped: 0, forYou: 0 };
      for (const r of rows) {
        if (r.display === "ready") today.ready++;
        else if (r.display === "due") today.due++;
        else if (r.display === "waiting") today.waiting++;
        else if (r.display === "stopped") today.stopped++;
        else if (r.display === "handed_over") today.forYou++;
      }
      return c.json(
        followUpsDto.parse({
          rows: rows.map(dto),
          today,
          sweep: {
            schedule: cfg.schedule,
            at: cfg.at,
            last,
            next: sch && cfg.schedule === "daily" ? nextRun(at, cfg.at, swept).toISOString() : null,
            running: sch?.isRunning(slug) ?? false,
            runNowOff: sch ? await sch.runNowOff(slug) : "this server has no follow-up model",
            stopped: last?.error ?? null,
          },
        }),
      );
    })
    .post("/api/projects/:slug/follow-ups/sweep", v("param", slugParam), v("json", runFollowUpsBody), async (c) => {
      const refused = door(c);
      if (refused) return refused;
      const { slug } = c.req.valid("param");
      if (!(await known(slug))) return notFound(c, "project");
      const sch = ctx.followUps?.schedule;
      if (!sch) return c.json({ error: "This server has no follow-up model: nothing runs here.", code: "wrong_state" as const }, 409);
      const r = await sch.runNow(slug);
      if ("refused" in r) return c.json({ error: `${r.refused}.`, code: "wrong_state" as const }, 409);
      return c.json({ ok: true as const, joined: r.joined, sweep: null }, 202);
    })
    .put("/api/projects/:slug/follow-ups/:clientId", v("param", followUpParam), v("json", setFollowUpBody), async (c) => {
      const refused = door(c);
      if (refused) return refused;
      const { slug, clientId } = c.req.valid("param");
      if (!(await repos.clients.get(slug, clientId))) return notFound(c, "client");
      const b = c.req.valid("json");
      const at = now().toISOString();
      if (b.action === "date") await repos.followUps.ownerDate(slug, clientId, b.nextAt, at);
      else if (b.action === "stop") await repos.followUps.ownerStop(slug, clientId, at);
      else await repos.followUps.ownerResume(slug, clientId, at);
      const item = await repos.followUps.one(slug, clientId, now());
      return item ? c.json(followUpChangedDto.parse({ ok: true, followUp: dto(item) })) : notFound(c, "follow-up");
    });
}

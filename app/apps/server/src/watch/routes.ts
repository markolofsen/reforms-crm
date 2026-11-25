import { Hono, type Context } from "hono";
import { watchDto, watchJoinDto, watchJoinParam, watchProjectsDto, watchQuery, type WatchDto } from "@hub/contract/watch";
import { slugParam } from "@hub/contract/requests";
import { ANALYSE_AFTER_MESSAGES, ANALYSE_EVERY_MS } from "@hub/watch/analyse";
import { ACCESS_WORDS, type WatchStore } from "@hub/watch/store";
import { gateRefusal } from "../http/admin-gate";
import { notFound, v } from "../http/http";
import type { WatchProject } from "./start";
import type { WatchContext } from "./context";

// P144 W6: the Watch section's reads and the owner's Join. Reads are behind the general guard; Join takes the admin's exact
// Origin, a loopback Host and `Sec-Fetch-Site: same-origin` (it asks Telegram to join one group, on the owner's word only). No
// route writes to a watched group, contacts a watched person or makes a client row.

const DAY = 86_400_000;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function nextAnalysis(store: WatchStore, now: number): string | null {
  let next: number | null = null;
  for (const g of store.groups()) {
    if (g.newSinceAnalysis === 0) continue;
    const at = g.newSinceAnalysis >= ANALYSE_AFTER_MESSAGES ? now : Date.parse(g.lastAnalysisAt ?? g.addedAt) + ANALYSE_EVERY_MS;
    next = next === null ? at : Math.min(next, at);
  }
  return next === null ? null : new Date(Math.max(next, now)).toISOString();
}

export async function watchBody(ctx: WatchContext, p: Extract<WatchProject, { state: "ready" }>, q: { days?: number | undefined; trigger?: string | undefined; minIntensity?: number | undefined; group?: string | undefined }): Promise<WatchDto> {
  const now = ctx.now().getTime();
  const days = q.days ?? 30;
  const since = new Date(now - days * DAY).toISOString();
  const s = p.store;
  const dayList = Array.from({ length: days }, (_, k) => dayOf(now - (days - 1 - k) * DAY));
  const trend = s.trend(since);
  const series = [...new Set(trend.map((t) => t.trigger))].sort().map((trigger) => ({ trigger, counts: dayList.map((d) => trend.find((t) => t.trigger === trigger && t.day === d)?.moments ?? 0) }));
  const listed = new Set(p.config.groups);
  const groups = s.groupStats(since).filter((g) => listed.has(g.username));
  const meta = new Map(s.groups().map((g) => [g.username, g]));
  return {
    slug: p.slug,
    lens: { id: p.lens.id, title: p.lens.title },
    standing: ctx.domain?.standing(p) ?? { state: "off", reason: null, until: null },
    labels: Object.fromEntries(p.lens.triggers.map((t) => [t, p.lens.labels[t] ?? t])),
    days,
    spend: { monthMicroUsd: await ctx.monthCost(p.lens.task.name), budgetMicroUsd: Math.round((p.lens.task.budget?.monthlyUsd ?? 0) * 1e6) },
    nextAnalysis: p.config.on ? nextAnalysis(s, now) : null,
    triggers: s.triggers(since).map((t) => ({ ...t, daily: series.find((x) => x.trigger === t.trigger)?.counts ?? dayList.map(() => 0) })),
    topics: s.topics(since),
    moods: groups.flatMap((g) => (g.lastMood ? [{ group: g.username, mood: g.lastMood }] : [])),
    moments: s.moments({ since, ...(q.trigger ? { trigger: q.trigger } : {}), ...(q.minIntensity ? { minIntensity: q.minIntensity } : {}), ...(q.group ? { group: q.group } : {}), limit: 200 }).map((m) => ({
      group: m.groupUsername,
      messageId: m.messageId,
      trigger: m.trigger,
      triggerOther: m.triggerOther,
      intensity: m.intensity,
      quote: m.quote,
      author: m.authorHandle ?? (m.authorId ? `user${m.authorId}` : null),
      reactors: m.reactors,
      context: m.context,
      why: m.why,
      at: m.at,
      link: `https://t.me/${m.groupUsername}/${m.messageId}`,
    })),
    people: s.people(since).map((x) => ({ author: x.handle ?? `user${x.authorId}`, moments: x.moments, intensitySum: x.intensitySum, triggers: x.triggers, groups: x.groups, lastAt: x.lastAt })),
    groups: groups.map((g) => {
      const row = meta.get(g.username);
      const access = row?.access ?? "unknown";
      return {
        username: g.username,
        title: row?.title ?? null,
        access,
        accessLine: ACCESS_WORDS[access],
        perDay: g.days > 0 ? Math.round((g.messages / g.days) * 10) / 10 : 0,
        density: g.messages > 0 ? Math.round((g.moments / g.messages) * 1000) / 10 : 0,
        moments: g.moments,
        costMicroUsd: g.costMicroUsd,
        lastPolledAt: row?.lastPolledAt ?? null,
        canJoin: access === "join_required",
      };
    }),
    trend: { days: dayList, series },
  };
}

export function watchRoutes(ctx: WatchContext) {
  const door = (c: Context): Response | null => {
    const why = ctx.adminPort === undefined ? "no admin port" : gateRefusal({ origin: c.req.header("origin"), host: c.req.header("host") ?? new URL(c.req.url).host, secFetchSite: c.req.header("sec-fetch-site") }, ctx.adminPort, { sameSite: true });
    return why ? c.json({ error: `Not joined: ${why}.`, code: "forbidden" as const }, 403) : null;
  };
  return new Hono()
    .get("/api/watch", (c) => {
      const list = ctx.domain?.projects() ?? [];
      return c.json(watchProjectsDto.parse({ projects: list.map((p) => ({ slug: p.slug, lens: p.state === "ready" ? p.lens.title : null, standing: ctx.domain?.standing(p) ?? { state: "off", reason: null, until: null } })) }));
    })
    .get("/api/projects/:slug/watch", v("param", slugParam), v("query", watchQuery), async (c) => {
      const p = ctx.domain?.project(c.req.valid("param").slug);
      if (!p) return notFound(c, "watch list");
      if (p.state !== "ready") return c.json({ error: p.reason, code: "unavailable" as const }, 503);
      return c.json(watchDto.parse(await watchBody(ctx, p, c.req.valid("query"))));
    })
    .post("/api/projects/:slug/watch/groups/:username/join", v("param", watchJoinParam), async (c) => {
      const refused = door(c);
      if (refused) return refused;
      const { slug, username } = c.req.valid("param");
      const p = ctx.domain?.project(slug);
      if (!p || p.state !== "ready") return notFound(c, "watch list");
      const r = await p.watcher.join(username);
      if (!r.ok) return c.json({ error: r.reason, code: "wrong_state" as const }, 409);
      return c.json(watchJoinDto.parse({ access: r.access }));
    });
}

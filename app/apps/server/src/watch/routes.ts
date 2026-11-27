import { Hono, type Context } from "hono";
import { watchDto, watchJoinDto, watchJoinParam, watchProjectsDto, watchQuery, watchContextDto, watchContextQuery, type WatchDto } from "@hub/contract/watch";
import { slugParam } from "@hub/contract/requests";
import { ANALYSE_AFTER_MESSAGES } from "@hub/watch/analyse";
import { ACCESS_WORDS, type WatchStore } from "@hub/watch/store";
import { gateRefusal } from "../http/admin-gate";
import { notFound, v } from "../http/http";
import type { WatchProject } from "./start";
import type { WatchContext } from "./context";
import { directionInfo, selectDirection } from "./directions";
import { membershipView } from "./membership/read";

// P144 W6: the Watch section's reads and the owner's Join. Reads are behind the general guard; Join takes the admin's exact
// Origin, a loopback Host and `Sec-Fetch-Site: same-origin` (it asks Telegram to join one group, on the owner's word only). No
// route writes to a watched group, contacts a watched person or makes a client row.

const DAY = 86_400_000;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function nextAnalysis(store: WatchStore, now: number, groups: string[], minutes: number): string | null {
  let next: number | null = null;
  for (const g of store.analysisGroups()) {
    if (g.newSinceAnalysis === 0 || !groups.includes(g.username)) continue;
    const at = g.newSinceAnalysis >= ANALYSE_AFTER_MESSAGES ? now : Date.parse(g.lastAnalysisAt ?? g.addedAt) + minutes * 60_000;
    next = next === null ? at : Math.min(next, at);
  }
  return next === null ? null : new Date(Math.max(next, now)).toISOString();
}

export async function watchBody(ctx: WatchContext, p: Extract<WatchProject, { state: "ready" }>, q: { days?: number | undefined; trigger?: string | undefined; minIntensity?: number | undefined; group?: string | undefined; direction?: string | undefined }): Promise<WatchDto> {
  const now = ctx.now().getTime();
  const days = q.days ?? 30;
  const since = new Date(now - days * DAY).toISOString();
  const selected = selectDirection(p, q.direction);
  if (!selected.ok) throw new Error(selected.reason);
  const { store: s, lens } = selected;
  const dayList = Array.from({ length: days }, (_, k) => dayOf(now - (days - 1 - k) * DAY));
  const trend = s.trend(since);
  const series = [...new Set(trend.map((t) => t.trigger))].sort().map((trigger) => ({ trigger, counts: dayList.map((d) => trend.find((t) => t.trigger === trigger && t.day === d)?.moments ?? 0) }));
  const listed = new Set(selected.groups);
  const groups = s.groupStats(since).filter((g) => listed.has(g.username));
  const meta = new Map(s.groups().map((g) => [g.username, g]));
  const analysis = s.analysisGroups().filter((g) => listed.has(g.username));
  const lastAnalyses = analysis.flatMap((g) => g.lastAnalysisAt ? [g.lastAnalysisAt] : []).sort();
  const membership = membershipView(ctx.domain, p, selected.id, selected.groups, selected.on);
  return {
    slug: p.slug,
    direction: selected.id,
    directions: directionInfo(p),
    freshness: { lastMessageAt: s.latestMessageAt(selected.groups), lastStoredAt: s.latestMessageAt(selected.groups, "stored"), pendingMessages: analysis.reduce((n, g) => n + g.newSinceAnalysis, 0), lastAnalysisAt: lastAnalyses.at(-1) ?? null },
    lens: { id: lens.id, title: lens.title, version: lens.task.version },
    membership: membership.summary,
    standing: selected.on ? ctx.domain?.standing(p) ?? { state: "off", reason: null, until: null } : { state: "off", reason: "This watch direction is off.", until: null },
    notice: selected.notice ?? p.notice,
    labels: Object.fromEntries(lens.triggers.map((t) => [t, lens.labels[t] ?? t])),
    days,
    spend: { monthMicroUsd: await ctx.monthCost(lens.task.name), budgetMicroUsd: Math.round((lens.task.budget?.monthlyUsd ?? 0) * 1e6) },
    nextAnalysis: selected.on ? nextAnalysis(s, now, selected.groups, selected.analysisMinutes) : null,
    triggers: s.triggers(since).map((t) => ({ ...t, daily: series.find((x) => x.trigger === t.trigger)?.counts ?? dayList.map(() => 0) })),
    topics: s.topics(since),
    moods: groups.flatMap((g) => (g.lastMood ? [{ group: g.username, mood: g.lastMood }] : [])),
    moments: s.moments({ since, groups: selected.groups, ...(q.trigger ? { trigger: q.trigger } : {}), ...(q.minIntensity ? { minIntensity: q.minIntensity } : {}), ...(q.group ? { group: q.group } : {}), limit: 200 }).map((m) => ({
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
        // A group backed off after a failed read says why and when it is tried again (P144, saas 2026-11-25).
        accessLine: row?.parkedUntil && Date.parse(row.parkedUntil) > now ? `${ACCESS_WORDS[access]}; ${row.parkReason ?? "could not be read"}, next try ${row.parkedUntil.slice(11, 16)} UTC` : ACCESS_WORDS[access],
        perDay: g.days > 0 ? Math.round((g.messages / g.days) * 10) / 10 : 0,
        density: g.messages > 0 ? Math.round((g.moments / g.messages) * 1000) / 10 : 0,
        moments: g.moments,
        costMicroUsd: g.costMicroUsd,
        lastPolledAt: row?.lastPolledAt ?? null,
        ...membership.group(g.username, access),
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
      const selected = selectDirection(p, c.req.valid("query").direction);
      if (!selected.ok) return selected.state === "unknown" ? notFound(c, "watch direction") : c.json({ error: selected.reason, code: "unavailable" as const }, 503);
      return c.json(watchDto.parse(await watchBody(ctx, p, c.req.valid("query"))));
    })
    .get("/api/projects/:slug/watch/context", v("param", slugParam), v("query", watchContextQuery), (c) => {
      const { slug } = c.req.valid("param");
      const q = c.req.valid("query");
      const p = ctx.domain?.project(slug);
      if (!p) return notFound(c, "watch list");
      if (p.state !== "ready") return c.json({ error: p.reason, code: "unavailable" as const }, 503);
      const selected = selectDirection(p, q.direction);
      if (!selected.ok) return selected.state === "unknown" ? notFound(c, "watch direction") : c.json({ error: selected.reason, code: "unavailable" as const }, 503);
      if (!selected.groups.includes(q.group)) return notFound(c, "watched group");
      const messages = selected.store.messageContext(q.group, q.messageId);
      if (messages.length === 0) return notFound(c, "cached source message");
      return c.json(watchContextDto.parse({ slug, direction: selected.id, group: q.group, messageId: q.messageId,
        contextKind: "chronological", lastPolledAt: selected.store.group(q.group)?.lastPolledAt ?? null,
        sourceLink: `https://t.me/${q.group}/${q.messageId}`, messages: messages.map((m) => ({ messageId: m.messageId, text: m.text, sentAt: m.sentAt,
          author: m.senderHandle, replyToMessageId: m.replyToMessageId, threadId: m.threadId })) }));
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

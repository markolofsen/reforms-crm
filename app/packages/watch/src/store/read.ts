import type { SqliteClient } from "@hub/db";
import { z } from "zod";
import { MomentRow, parseRows, WindowRow, type WatchMoment } from "./rows";

/**
 * The Watch page's reads (P144 section 5), over one project's watch file. Aggregates are computed from the kept moments and the
 * windows, which outlive the 30-day message cache; a moment's author is null once blanked.
 */

export interface TriggerStat {
  trigger: string;
  /** For `other`: the free text, merged case-insensitively; empty otherwise. */
  triggerOther: string;
  moments: number;
  avgIntensity: number;
  /** Moments of intensity 4 or more. */
  strong: number;
}

export interface TopicStat {
  topic: string;
  windows: number;
}

export interface PersonStat {
  authorId: string;
  handle: string | null;
  moments: number;
  intensitySum: number;
  triggers: string[];
  groups: string[];
  lastAt: string;
}

export interface GroupStat {
  username: string;
  messages: number;
  days: number;
  moments: number;
  costMicroUsd: number;
  lastMood: string | null;
}

export interface TrendDay {
  day: string;
  trigger: string;
  moments: number;
}

export interface MomentFilter {
  since?: string;
  trigger?: string;
  minIntensity?: number;
  group?: string;
  groups?: readonly string[];
  limit?: number;
}

export interface WatchReads {
  triggers(since: string): TriggerStat[];
  topics(since: string, limit?: number): TopicStat[];
  moments(f: MomentFilter): WatchMoment[];
  people(since: string, limit?: number): PersonStat[];
  groupStats(since: string): GroupStat[];
  trend(since: string): TrendDay[];
  /** Micro-dollars the windows analysed since then cost. */
  spend(since: string): number;
  windowCount(since: string): number;
}

const Triggers = z.object({ trigger: z.string(), other: z.string(), n: z.number(), avg: z.number().nullable(), strong: z.number() });
const People = z.object({ author_id: z.string(), handle: z.string().nullable(), n: z.number(), s: z.number(), triggers: z.string(), groups: z.string(), last_at: z.string() });
const Groups = z.object({ username: z.string(), messages: z.number().nullable(), days: z.number(), moments: z.number(), cost: z.number().nullable() });
const Trend = z.object({ day: z.string(), trigger: z.string(), n: z.number() });
const Total = z.object({ n: z.number().nullable() });
const Mood = z.object({ group_username: z.string(), mood: z.string().nullable() });

const split = (s: string): string[] => [...new Set(s.split("\u001f").filter(Boolean))].sort();

export function createReads(c: SqliteClient, p: string, direction = "default", groups?: readonly string[]): WatchReads {
  const groupArgs = groups ?? [];
  const inGroups = (column = "group_username") => groups === undefined ? "" : groups.length === 0 ? " AND 0" : ` AND ${column} IN (${groups.map(() => "?").join(",")})`;
  return {
    triggers(since) {
      const rows = c
        .prepare(
          `SELECT trigger, CASE WHEN trigger = 'other' THEN lower(trim(trigger_other)) ELSE '' END AS other, count(*) AS n, avg(intensity) AS avg, sum(intensity >= 4) AS strong FROM moments WHERE project = ? AND direction = ? AND at >= ?${inGroups()} GROUP BY 1, 2 ORDER BY n DESC, trigger`,
        )
        .all(p, direction, since, ...groupArgs);
      return parseRows(Triggers, rows).map((r) => ({ trigger: r.trigger, triggerOther: r.other, moments: r.n, avgIntensity: Math.round((r.avg ?? 0) * 10) / 10, strong: r.strong }));
    },
    topics(since, limit = 30) {
      const counts = new Map<string, { topic: string; windows: number }>();
      for (const w of parseRows(WindowRow, c.prepare(`SELECT * FROM windows WHERE project = ? AND direction = ? AND last_at >= ?${inGroups()}`).all(p, direction, since, ...groupArgs))) {
        for (const t of new Set(w.topics.map((x) => x.trim()).filter(Boolean))) {
          const k = t.toLowerCase();
          const cur = counts.get(k) ?? { topic: t, windows: 0 };
          cur.windows += 1;
          counts.set(k, cur);
        }
      }
      return [...counts.values()].sort((a, b) => b.windows - a.windows || a.topic.localeCompare(b.topic)).slice(0, limit);
    },
    moments(f) {
      if (f.groups?.length === 0) return [];
      const where = ["project = ?", "direction = ?", `at >= ?${inGroups()}`];
      const args: Array<string | number> = [p, direction, f.since ?? "", ...groupArgs];
      if (f.trigger) (where.push("trigger = ?"), args.push(f.trigger));
      if (f.minIntensity) (where.push("intensity >= ?"), args.push(f.minIntensity));
      if (f.group) (where.push("group_username = ?"), args.push(f.group));
      if (f.groups) { where.push(`group_username IN (${f.groups.map(() => "?").join(",")})`); args.push(...f.groups); }
      return parseRows(MomentRow, c.prepare(`SELECT * FROM moments WHERE ${where.join(" AND ")} ORDER BY at DESC, message_id DESC LIMIT ?`).all(...args, Math.min(500, f.limit ?? 100)));
    },
    people(since, limit = 50) {
      const rows = c
        .prepare(
          `SELECT author_id, max(author_handle) AS handle, count(*) AS n, sum(intensity) AS s, group_concat(trigger, char(31)) AS triggers, group_concat(group_username, char(31)) AS groups, max(at) AS last_at FROM moments WHERE project = ? AND direction = ? AND at >= ? AND author_id IS NOT NULL${inGroups()} GROUP BY author_id ORDER BY s DESC, n DESC LIMIT ?`,
        )
        .all(p, direction, since, ...groupArgs, limit);
      return parseRows(People, rows).map((r) => ({ authorId: r.author_id, handle: r.handle, moments: r.n, intensitySum: r.s, triggers: split(r.triggers), groups: split(r.groups), lastAt: r.last_at }));
    },
    groupStats(since) {
      const day = since.slice(0, 10);
      const rows = c
        .prepare(
          `SELECT g.username AS username,
             (SELECT sum(messages) FROM group_days d WHERE d.project = g.project AND d.group_username = g.username AND d.day >= ?) AS messages,
             (SELECT count(*) FROM group_days d WHERE d.project = g.project AND d.group_username = g.username AND d.day >= ?) AS days,
             (SELECT count(*) FROM moments m WHERE m.project = g.project AND m.group_username = g.username AND m.direction = ? AND m.at >= ?) AS moments,
             (SELECT sum(cost_micro_usd) FROM windows w WHERE w.project = g.project AND w.group_username = g.username AND w.direction = ? AND w.last_at >= ?) AS cost
           FROM groups g WHERE g.project = ?${inGroups("g.username")} ORDER BY g.added_at, g.username`,
        )
        .all(day, day, direction, since, direction, since, p, ...groupArgs);
      const moods = new Map(parseRows(Mood, c.prepare(`SELECT group_username, mood FROM windows w WHERE project = ? AND direction = ?${inGroups("w.group_username")} AND last_at = (SELECT max(last_at) FROM windows x WHERE x.project = w.project AND x.direction = w.direction AND x.group_username = w.group_username)`).all(p, direction, ...groupArgs)).map((m) => [m.group_username, m.mood]));
      return parseRows(Groups, rows).map((r) => ({ username: r.username, messages: r.messages ?? 0, days: r.days, moments: r.moments, costMicroUsd: r.cost ?? 0, lastMood: moods.get(r.username) ?? null }));
    },
    trend(since) {
      return parseRows(Trend, c.prepare(`SELECT substr(at, 1, 10) AS day, trigger, count(*) AS n FROM moments WHERE project = ? AND direction = ? AND at >= ?${inGroups()} GROUP BY 1, 2 ORDER BY 1, 2`).all(p, direction, since, ...groupArgs)).map((r) => ({ day: r.day, trigger: r.trigger, moments: r.n }));
    },
    spend: (since) => Total.parse(c.prepare(`SELECT sum(cost_micro_usd) AS n FROM windows WHERE project = ? AND direction = ? AND analysed_at >= ?${inGroups()}`).get(p, direction, since, ...groupArgs)).n ?? 0,
    windowCount: (since) => Total.parse(c.prepare(`SELECT count(*) AS n FROM windows WHERE project = ? AND direction = ? AND analysed_at >= ?${inGroups()}`).get(p, direction, since, ...groupArgs)).n ?? 0,
  };
}

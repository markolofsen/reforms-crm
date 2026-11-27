import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/** A legacy list is the default direction. Additional directions share its account and reader. */
export const WATCH_FILE = "watch.md";
export const DEFAULT_DIRECTION = "default";
export const WATCH_GROUP_CAP = 15;
export const WATCH_MAX_SOURCES = 60;
const USERNAME = /^@?([A-Za-z][A-Za-z0-9_]{3,31})$/;
export const DIRECTION_ID = /^[a-z][a-z0-9-]{0,62}$/;

export interface WatchDirectionConfig {
  id: string;
  title: string | null;
  lens: string;
  on: boolean;
  groups: string[];
  analysisMinutes?: number;
}

export interface WatchConfig {
  lens: string;
  /** Master reading switch, including all named directions. */
  on: boolean;
  account: string;
  pollMinutes: number;
  analysisMinutes?: number;
  groups: string[];
  sourceCap?: number;
  /** Absent on the legacy format; its existing groups and lens remain the default direction. */
  directions?: WatchDirectionConfig[];
}

export type WatchConfigRead = { state: "none" } | { state: "ok"; config: WatchConfig } | { state: "invalid"; reason: string };
const LensName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "a package folder name under packages/");
const Settings = z.object({
  lens: LensName,
  on: z.enum(["yes", "no"]).default("no"),
  account: z.string().regex(/^(default|[0-9]{3,20})$/, "default, or a connected account's id").default("default"),
  poll_minutes: z.coerce.number().int().min(5, "at least 5 minutes").max(1440).default(5),
  analysis_minutes: z.coerce.number().int().min(5).max(1440).optional(),
  source_cap: z.coerce.number().int().min(1).max(WATCH_MAX_SOURCES).optional(),
});
const DirectionSettings = z.strictObject({
  lens: LensName,
  title: z.string().min(1).max(80).optional(),
  on: z.enum(["yes", "no"]).default("no"),
  analysis_minutes: z.coerce.number().int().min(5).max(1440).optional(),
});

/** One fetched source may be analysed by several directions; account and pacing remain project-wide. */
export const watchDirections = (c: WatchConfig): WatchDirectionConfig[] => [
  { id: DEFAULT_DIRECTION, title: null, lens: c.lens, on: c.on, groups: c.groups, ...(c.analysisMinutes !== undefined ? { analysisMinutes: c.analysisMinutes } : {}) },
  ...(c.directions ?? []).map((d) => ({ ...d, on: c.on && d.on })),
];
export const watchGroups = (c: WatchConfig): string[] => [...new Set(watchDirections(c).flatMap((d) => d.groups))];

interface Block { id: string; settings: Record<string, string>; groups: string[] }
const failure = (reason: string): WatchConfigRead => ({ state: "invalid", reason });

/** Named blocks: a Direction heading, a lens/on/title table, then a Groups subheading. */
export function parseWatch(text: string): WatchConfigRead {
  const legacy: Block = { id: DEFAULT_DIRECTION, settings: {}, groups: [] };
  const blocks: Block[] = [];
  let block = legacy;
  let section: "settings" | "groups" | "other" = "settings";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const direction = /^##\s+direction\s+(\S+)\s*$/i.exec(line);
    if (direction) {
      const id = direction[1] ?? "";
      if (!DIRECTION_ID.test(id) || id === DEFAULT_DIRECTION || blocks.some((b) => b.id === id)) return failure(`invalid or repeated direction "${id}"`);
      block = { id, settings: {}, groups: [] };
      blocks.push(block);
      section = "settings";
      continue;
    }
    if (/^#{2,3}\s+/.test(line)) {
      section = /^#{2,3}\s+groups\s*$/i.test(line) ? "groups" : "other";
      continue;
    }
    if (section === "settings") {
      const m = /^\|\s*([a-z_]+)\s*\|\s*([^|]*?)\s*\|$/.exec(line);
      if (m?.[1] && m[1] !== "setting") block.settings[m[1]] = m[2] ?? "";
    } else if (section === "groups") {
      const m = /^[-*]\s+(\S+)/.exec(line);
      if (!m?.[1]) continue;
      const username = USERNAME.exec(m[1])?.[1]?.toLowerCase();
      if (!username) return failure(`"${m[1]}" is not a public group username`);
      if (!block.groups.includes(username)) block.groups.push(username);
    }
  }
  const union = new Set([legacy, ...blocks].flatMap((b) => b.groups));
  const base = Settings.safeParse(legacy.settings);
  if (!base.success) return failure(base.error.issues.map((i) => `${i.path.join(".") || "settings"}: ${i.message}`).join("; "));
  const cap = base.data.source_cap ?? WATCH_GROUP_CAP;
  if (union.size > cap) return failure(`${union.size} groups listed; a watch list holds at most ${cap} distinct groups across directions`);
  const directions: WatchDirectionConfig[] = [];
  for (const b of blocks) {
    const parsed = DirectionSettings.safeParse(b.settings);
    if (!parsed.success) return failure(`direction ${b.id}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "settings"}: ${i.message}`).join("; ")}`);
    directions.push({ id: b.id, title: parsed.data.title ?? null, lens: parsed.data.lens, on: parsed.data.on === "yes", groups: b.groups, ...(parsed.data.analysis_minutes !== undefined ? { analysisMinutes: parsed.data.analysis_minutes } : {}) });
  }
  return { state: "ok", config: { lens: base.data.lens, on: base.data.on === "yes", account: base.data.account, pollMinutes: base.data.poll_minutes, groups: legacy.groups, ...(base.data.analysis_minutes !== undefined ? { analysisMinutes: base.data.analysis_minutes } : {}), ...(base.data.source_cap !== undefined ? { sourceCap: base.data.source_cap } : {}), ...(directions.length ? { directions } : {}) } };
}

export function readWatch(projectDir: string): WatchConfigRead {
  const file = join(projectDir, WATCH_FILE);
  if (!existsSync(file)) return { state: "none" };
  try { return parseWatch(readFileSync(file, "utf8")); }
  catch (e) { return failure(e instanceof Error ? e.message.slice(0, 200) : "unreadable"); }
}

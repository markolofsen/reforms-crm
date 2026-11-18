import { join } from "node:path";
import { doctorProject, loadProjects, ProjectBase, type ProjectConfig } from "@hub/projects";
import type { ProjectRow, Repos } from "@hub/db";
import { countMarkdown } from "./project-doctor";

/** The Overview's local facts: SQLite and the project folders only, read inside the request, no network. */

/** A `sending` row older than this was left by a crash. */
export const STUCK_MINUTES = 10;

const HOUR = 3_600_000;

const wall = (t: number, tz: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(t)).map((x) => [x.type, Number(x.value)]));
  return { y: p.year ?? 1970, m: p.month ?? 1, d: p.day ?? 1, ms: Date.UTC(p.year ?? 1970, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0, p.second ?? 0) };
};

/** The instant local midnight of `now`'s day in `tz` falls on (DST aware: the day may be 23 or 25 hours long). */
export function startOfLocalDay(now: Date, tz: string): Date {
  const t = Math.floor(now.getTime() / 1000) * 1000;
  const { y, m, d } = wall(t, tz);
  const guess = Date.UTC(y, m - 1, d);
  const offset = (at: number) => wall(at, tz).ms - at;
  const o1 = offset(guess);
  let r = guess - o1;
  const o2 = offset(r);
  if (o2 !== o1) r = guess - o2;
  return new Date(r);
}

/** `YYYY-MM-DD` of `now` in `tz`. */
export function localDate(now: Date, tz: string): string {
  const { y, m, d } = wall(now.getTime(), tz);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export const hostTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

const DEFAULT_CONFIG = ProjectBase.parse({ schema: 1, slug: "x", kind: "x", name: "x" });

/** The parsed settings of a registry row; a row whose JSON no longer parses gets the defaults (and shows as it is). */
export function configOf(row: ProjectRow): ProjectConfig {
  try {
    const r = ProjectBase.safeParse(JSON.parse(row.settingsJson));
    return r.success ? r.data : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

/** What one project's status is judged from: SQLite and its folder, read inside the request. Counts only, never a client fact. */
export interface ProjectFacts {
  slug: string;
  name: string;
  /** The project's own status word (`draft`, `active`, `paused`, `archived`). */
  status: string;
  archived: boolean;
  toReview: number;
  sentToday: number;
  owed: number;
  lastTriageAt: string | null;
  setupQuestion: boolean;
  injectionHeld: number;
  failed24h: number;
  stuck: number;
  stopped: boolean;
  auto: { mode: string; cap: number; used24h: number };
  recipients: "test" | "listed" | "any";
  /** Names of the failing setup checks (names only, never a detail that could hold a value). */
  doctorFailed: string[];
  knowledgeExpired: number;
  /** `context.required` of the project; null: the default (warn until CONTEXT_BLOCK_FROM). */
  contextRequired: "warn" | "block" | null;
}

export interface FactsInput {
  repos: Repos;
  root: string;
  /** Where send-policy.json lives; without it the safe defaults show (drafts only, the test list). */
  policyDir?: string;
  now: Date;
  hostZone: string;
  rows: ProjectRow[];
}

/** Facts for every registered project that is not a scratch one (`_` prefix). */
export async function gatherFacts(i: FactsInput): Promise<ProjectFacts[]> {
  const folders = loadProjects(i.root, i.policyDir ? { policyDir: i.policyDir } : {});
  const out: ProjectFacts[] = [];
  for (const row of i.rows) {
    if (row.slug.startsWith("_")) continue;
    const c = configOf(row);
    const tz = c.timezone ?? i.hostZone;
    const day = new Date(i.now.getTime() - 24 * HOUR);
    const stuckBefore = new Date(i.now.getTime() - STUCK_MINUTES * 60_000);
    const s = await i.repos.sends.summarySince(row.slug, { today: startOfLocalDay(i.now, tz).toISOString(), day: day.toISOString(), stuckBefore: stuckBefore.toISOString() });
    const loaded = folders.find((f) => f.slug === row.slug);
    // send.* and draft.recipients come from the policy file (P49 S11), never from the registry's copy of project.md.
    const policy = loaded?.policy ? loaded.parsed.config : c;
    let doctorFailed: string[] = [];
    if (loaded) {
      try {
        const checks = await doctorProject({ project: loaded, all: folders, knowledgeDocs: await i.repos.knowledge.count(row.slug), knowledgeFiles: countMarkdown(join(loaded.folder, "knowledge")) });
        doctorFailed = checks.filter((k) => k.outcome === "fail").map((k) => k.name);
      } catch {
        doctorFailed = ["project doctor"];
      }
    }
    out.push({
      slug: row.slug,
      name: row.name,
      status: row.status,
      archived: row.archived,
      toReview: (await i.repos.drafts.countsByStatus(row.slug)).ready,
      sentToday: s.sentToday,
      owed: (await i.repos.inbox.counts(row.slug)).owed,
      lastTriageAt: await i.repos.inbox.lastTriageAt(row.slug),
      setupQuestion: (await i.repos.projects.questions(row.slug, "open")).length > 0,
      injectionHeld: await i.repos.drafts.injectionHeld(row.slug),
      failed24h: s.failed,
      stuck: s.stuck,
      stopped: await i.repos.sends.isStopped(row.slug),
      auto: { mode: policy.send.mode, cap: policy.send.dailyCap, used24h: await i.repos.sends.autoCountSince(row.slug, day.toISOString()) },
      recipients: policy.draft.recipients === "test" ? "test" : policy.draft.recipients === "any" ? "any" : "listed",
      doctorFailed,
      knowledgeExpired: await i.repos.knowledge.expiredCount(row.slug, localDate(i.now, tz)),
      contextRequired: c.context.required,
    });
  }
  return out;
}

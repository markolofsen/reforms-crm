import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { doctorProject, loadProjects, ProjectBase, type ProjectConfig } from "@hub/projects";
import { classifyMessage, parseRulesFile } from "@hub/mail-filters";
import type { ProjectRow, Repos } from "@hub/db";
import type { ProjectCardDto } from "@hub/contract/overview";
import { countMarkdown } from "./project-doctor";
import type { ProjectExtra } from "./overview-attention";
import type { RefreshPlan } from "./overview-live";

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

export interface ProjectFacts {
  /** The card without its live blocks. */
  card: Omit<ProjectCardDto, "mailboxes" | "notion">;
  extra: ProjectExtra;
  plan: Omit<RefreshPlan, "sources">;
  accounts: string[];
  notionIds: { clients: string | null; leads: string | null };
}

const excludedOf = (file: string): RefreshPlan["excluded"] => {
  if (!existsSync(file)) return undefined;
  try {
    const rules = parseRulesFile(readFileSync(file, "utf8")).file;
    return (m) => {
      const c = classifyMessage(rules, m);
      return c !== null && c.category !== "client";
    };
  } catch {
    return undefined;
  }
};

export interface FactsInput {
  repos: Repos;
  root: string;
  now: Date;
  hostZone: string;
  rows: ProjectRow[];
}

/** Facts for every registered project that is not a scratch one (`_` prefix). */
export async function gatherFacts(i: FactsInput): Promise<ProjectFacts[]> {
  const folders = loadProjects(i.root);
  const out: ProjectFacts[] = [];
  for (const row of i.rows) {
    if (row.slug.startsWith("_")) continue;
    const c = configOf(row);
    const tz = c.timezone ?? i.hostZone;
    const today = startOfLocalDay(i.now, tz);
    const day = new Date(i.now.getTime() - 24 * HOUR);
    const stuckBefore = new Date(i.now.getTime() - STUCK_MINUTES * 60_000);
    const s = await i.repos.sends.summarySince(row.slug, { today: today.toISOString(), day: day.toISOString(), stuckBefore: stuckBefore.toISOString() });
    const open = await i.repos.projects.questions(row.slug, "open");
    const loaded = folders.find((f) => f.slug === row.slug);
    let doctorFailed: string[] = [];
    if (loaded) {
      try {
        const checks = await doctorProject({ project: loaded, all: folders, knowledgeDocs: await i.repos.knowledge.count(row.slug), knowledgeFiles: countMarkdown(join(loaded.folder, "knowledge")) });
        doctorFailed = checks.filter((k) => k.outcome === "fail").map((k) => k.name);
      } catch {
        doctorFailed = ["project doctor"];
      }
    }
    const db = (name: string) => c.notion.databases.find((d) => d.slug === name)?.dataSourceId ?? null;
    const ids = { clients: db("clients"), leads: db("leads") };
    const triageAt = await i.repos.runs.lastStart(row.slug, ["triage-mail"]);
    const excluded = excludedOf(join(i.root, row.slug, "mail-filters.md"));
    out.push({
      card: {
        slug: row.slug,
        name: row.name,
        status: row.status,
        kind: row.kind,
        archived: row.archived,
        lastTriageAt: triageAt,
        owe: { state: "off", message: "Not recorded yet." },
        drafts: await i.repos.drafts.countsByStatus(row.slug),
        injectionHeld: await i.repos.drafts.injectionHeld(row.slug),
        sends: {
          today: s.sentToday,
          since: today.toISOString(),
          failed24h: s.failed,
          stuck: s.stuck,
          stopped: await i.repos.sends.isStopped(row.slug),
          auto: { mode: c.send.mode, cap: c.send.dailyCap, used24h: await i.repos.sends.autoCountSince(row.slug, day.toISOString()) },
        },
        recipients: c.draft.recipients === "test" ? "test" : c.draft.recipients === "any" ? "any" : "listed",
        setupQuestion: open.length > 0,
      },
      extra: { doctorFailed, knowledgeExpired: await i.repos.knowledge.expiredCount(row.slug, localDate(i.now, tz)), contextRequired: c.context.required },
      plan: {
        project: row.slug,
        accounts: c.mail.accounts,
        addresses: [...c.mail.addresses, ...c.mail.aliases],
        ...(excluded ? { excluded } : {}),
        triageAt: triageAt ? new Date(triageAt) : null,
        notion: { tokenFile: c.notion.tokenFile, sources: (["clients", "leads"] as const).flatMap((name) => (ids[name] ? [{ name, id: ids[name] }] : [])) },
      },
      accounts: c.mail.accounts,
      notionIds: ids,
    });
  }
  return out;
}

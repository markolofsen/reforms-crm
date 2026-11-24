import type { Repos } from "@hub/db";
import type { HealthDto } from "@hub/contract/health";
import { overviewDto, type OverviewDto } from "@hub/contract/overview";
import { gatherFacts, hostTimeZone } from "./facts";
import { overviewSentence, statusOf } from "./status";
import { projectReadOf } from "../mail/inbound";
import type { ProjectStore } from "@hub/projects/store";

/**
 * The Overview (contract v5): one row per registered project, from local facts only (SQLite, the project folders, the
 * server's own loops), read inside the request. No Mail or Notion read, so no freshness stamp and no refresh. Nothing here
 * writes. A one-project instance shows the row's `status` as the Mail status line.
 */
export interface OverviewService {
  get(): Promise<OverviewDto>;
}

export interface OverviewOptions {
  repos: Repos;
  /** P126 P3: each project's config with its send policy (P49 S11), from project.md. */
  projects: ProjectStore;
  health: () => HealthDto;
  dataVersion: () => number;
  now: () => Date;
  timeZone?: string;
}

export function createOverview(o: OverviewOptions): OverviewService {
  const zone = o.timeZone ?? hostTimeZone();
  return {
    async get() {
      const now = o.now();
      const system = o.health();
      const { projects } = await o.repos.projects.registry();
      const facts = await gatherFacts({ repos: o.repos, projects: o.projects, now, hostZone: zone, rows: projects });
      const rows = facts.map((f) => {
        const sys = { sentError: system.sent.state === "error" && system.sent.projects.includes(f.slug), fakeMailer: system.mailer === "fake", mailRead: projectReadOf(system.inbound, f.slug) };
        return { slug: f.slug, name: f.name, projectStatus: f.status, archived: f.archived, toReview: f.toReview, sentToday: f.sentToday, status: statusOf(f, sys) };
      });
      return overviewDto.parse({
        serverTime: now.toISOString(),
        timeZone: zone,
        dataVersion: o.dataVersion(),
        sentence: overviewSentence(rows.map((r) => r.status)),
        projects: rows,
        system,
      });
    },
  };
}

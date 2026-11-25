import { fakeLeadPassBrain, leadPassClaudeBrain } from "@hub/agent/lead-pass";
import { LEAD_PASS_DEFAULT_AT, type LeadPassBrain } from "@hub/config/lead-pass";
import { throwawayDb, type HubPaths } from "@hub/config/paths";
import type { Repos } from "@hub/db";
import { ops } from "@hub/log/ops";
import type { DirectoryEntry } from "@hub/messengers";
import type { ProjectStore } from "@hub/projects/store";
import type { LeadsHandle } from "../clients/leads-reader";
import type { AutopilotHandle } from "../messengers/autopilot/wake";
import type { Clock } from "../messengers/autopilot/scheduler";
import { leadPassSchedule, type LeadPassScheduleHandle } from "./schedule";

// The lead pass in the server (decision 0055, P147 L4): the brain chosen once and the timer. A test or an e2e run never spawns a
// model: `HUB_LEAD_BRAIN=fake` gives the scripted fake, only with a throwaway `HUB_DB`; a throwaway database without it, or
// VITEST, gives no brain, and then no timer runs and Run now says so.

export interface LeadPassRuntime {
  brain: LeadPassBrain | undefined;
  schedule: LeadPassScheduleHandle | undefined;
  stop(): Promise<void>;
}

export function leadPassBrainOf(o: { env: NodeJS.ProcessEnv; paths: HubPaths; repos: Repos; nodeBin?: string }): LeadPassBrain | undefined {
  const throwaway = throwawayDb(o.paths);
  if (o.env.HUB_LEAD_BRAIN === "fake") {
    if (throwaway) return fakeLeadPassBrain({ repos: o.repos });
    ops("lead-pass").error("HUB_LEAD_BRAIN=fake is refused without a throwaway HUB_DB: this server's lead pass has no brain");
    return undefined;
  }
  if (throwaway || o.env.VITEST) return undefined;
  return leadPassClaudeBrain({ paths: o.paths, nodeBin: o.nodeBin ?? process.execPath });
}

export function startLeadPass(o: {
  repos: Repos;
  projects: ProjectStore;
  brain: LeadPassBrain | undefined;
  autopilot?: AutopilotHandle | undefined;
  leads?: LeadsHandle | undefined;
  directory?: { project: string | null; all: () => readonly DirectoryEntry[] | undefined } | undefined;
  clock?: Clock;
}): LeadPassRuntime {
  const log = ops("lead-pass");
  if (!o.brain) {
    log.info("lead pass: no brain on this server; no timer runs");
    return { brain: undefined, schedule: undefined, stop: async () => {} };
  }
  const schedule = leadPassSchedule({
    repos: o.repos,
    brain: o.brain,
    autopilot: o.autopilot,
    ...(o.clock ? { clock: o.clock } : {}),
    windowDays: (slug) => o.projects.find(slug)?.leads.windowDays ?? 14,
    prefetch: {
      project: (slug) => o.projects.find(slug) ?? undefined,
      page: o.leads ? (slug, pageId) => (o.leads as LeadsHandle).page(slug, pageId) : undefined,
      relationship: (slug, email) => (o.directory && o.directory.project === slug ? (o.directory.all()?.find((e) => e.email?.trim().toLowerCase() === email)?.relationship ?? null) : null),
    },
    projects: async () =>
      (await o.repos.projects.registry()).projects
        .filter((p) => !p.archived)
        .flatMap((p) => {
          const cfg = o.projects.find(p.slug);
          return cfg && cfg.status === "active" ? [{ slug: p.slug, settings: { schedule: cfg.leads.pass, at: cfg.leads.passAt || LEAD_PASS_DEFAULT_AT, sweepDaily: cfg.followUps.schedule === "daily" } }] : [];
        }),
  });
  schedule.begin();
  log.info(`lead pass: brain ${o.brain.name}${o.brain.name === "fake" ? " (HUB_LEAD_BRAIN=fake): no model" : ""}; the timer looks once a minute`);
  return { brain: o.brain, schedule, stop: () => schedule.stop() };
}

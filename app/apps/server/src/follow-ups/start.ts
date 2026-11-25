import { followUpClaudeBrain, fakeFollowUpBrain } from "@hub/agent/follow-up";
import { FOLLOW_UP_DEFAULT_AT, FOLLOW_UP_DRAFT_AUTHOR, type FollowUpBrain } from "@hub/config/follow-ups";
import { throwawayDb, type HubPaths } from "@hub/config/paths";
import type { Repos } from "@hub/db";
import { ops } from "@hub/log/ops";
import type { DirectoryEntry } from "@hub/messengers";
import type { MessengerDoorDeps } from "@hub/messengers/door";
import type { ProjectStore } from "@hub/projects/store";
import type { ConversationMail } from "../mail/context";
import type { AutopilotHandle } from "../messengers/autopilot/wake";
import type { Clock } from "../messengers/autopilot/scheduler";
import { nudgeSender, type NudgeSender } from "./nudges";
import type { BugReportsPort } from "./bug-notes";
import { followUpSchedule, type FollowUpScheduleHandle } from "./schedule";

// The follow-up sweep in the server (decision 0050, P142 F4 and F5): the brain chosen once, the autopilot nudges held in memory,
// and the timer. A test or an e2e run never spawns a model: `HUB_FOLLOWUP_BRAIN=fake` gives the scripted fake, only with a
// throwaway `HUB_DB`; a throwaway database without it, or VITEST, gives no brain, and then no timer runs.

export interface FollowUpsRuntime {
  brain: FollowUpBrain | undefined;
  schedule: FollowUpScheduleHandle | undefined;
  nudges: NudgeSender | undefined;
  stop(): Promise<void>;
}

export function followUpBrainOf(o: { env: NodeJS.ProcessEnv; paths: HubPaths; repos: Repos; nodeBin?: string }): FollowUpBrain | undefined {
  const throwaway = throwawayDb(o.paths);
  if (o.env.HUB_FOLLOWUP_BRAIN === "fake") {
    if (throwaway) return fakeFollowUpBrain({ repos: o.repos });
    ops("follow-ups").error("HUB_FOLLOWUP_BRAIN=fake is refused without a throwaway HUB_DB: this server's sweep has no brain");
    return undefined;
  }
  if (throwaway || o.env.VITEST) return undefined;
  return followUpClaudeBrain({ paths: o.paths, nodeBin: o.nodeBin ?? process.execPath });
}

/** The Notion facts of a client's card as the directory holds them, as data lines for the turn. */
const factsOf = (all: readonly DirectoryEntry[] | undefined, c: { email: string | null; pageId: string | null }): string[] => {
  const e = all?.find((x) => (c.pageId && x.key === c.pageId) || (c.email && x.email === c.email));
  if (!e) return [];
  return [e.relationship ? `Relationship: ${e.relationship}` : null, e.followUp?.doNotFollowUp ? "Do not follow up: ticked (the CRM's field)" : null, e.followUp?.followUpOn ? `Follow-up on (the CRM's date): ${e.followUp.followUpOn}` : null].filter((x): x is string => x !== null);
};

export function startFollowUps(o: {
  repos: Repos;
  projects: ProjectStore;
  brain: FollowUpBrain | undefined;
  autopilot?: AutopilotHandle | undefined;
  door: () => MessengerDoorDeps | null;
  mail?: ConversationMail | undefined;
  directory?: { project: string | null; all: () => readonly DirectoryEntry[] | undefined } | undefined;
  clock?: Clock;
  /** P145 B4: the Bug reports in Notion, for the fixed bugs' notes. */
  bugReports?: BugReportsPort | undefined;
}): FollowUpsRuntime {
  const log = ops("follow-ups");
  if (!o.brain) {
    log.info("follow-up sweep: no brain on this server; no timer runs");
    return { brain: undefined, schedule: undefined, nudges: undefined, stop: async () => {} };
  }
  const nudges = o.autopilot ? nudgeSender({ repos: o.repos, autopilot: o.autopilot, door: o.door, ...(o.clock ? { clock: o.clock } : {}) }) : undefined;
  const schedule = followUpSchedule({
    repos: o.repos,
    brain: o.brain,
    autopilot: o.autopilot,
    nudges,
    ...(o.clock ? { clock: o.clock } : {}),
    ...(o.bugReports ? { bugReports: o.bugReports } : {}),
    prefetch: {
      project: (slug) => o.projects.find(slug) ?? undefined,
      mail: o.mail,
      notionFacts: (slug, c) => (o.directory && o.directory.project === slug ? factsOf(o.directory.all(), c) : []),
    },
    projects: async () =>
      (await o.repos.projects.registry()).projects
        .filter((p) => !p.archived)
        .flatMap((p) => {
          const cfg = o.projects.find(p.slug);
          return cfg && cfg.status === "active" ? [{ slug: p.slug, settings: { schedule: cfg.followUps.schedule, at: cfg.followUps.at || FOLLOW_UP_DEFAULT_AT } }] : [];
        }),
  });
  schedule.begin();
  void reportDropped(o.repos);
  log.info(`follow-up sweep: brain ${o.brain.name}${o.brain.name === "fake" ? " (HUB_FOLLOWUP_BRAIN=fake): no model" : ""}; the timer looks once a minute`);
  return {
    brain: o.brain,
    schedule,
    nudges,
    stop: async () => {
      nudges?.stop();
      await schedule.stop();
    },
  };
}

/** Verdict 8: a nudge held before a restart was dropped with the process; its draft waits for the owner. One line says so. */
async function reportDropped(repos: Repos): Promise<void> {
  try {
    for (const { slug } of (await repos.projects.registry()).projects) {
      const waiting = (await repos.followUps.list(slug)).filter((p) => p.nudgeReady).length;
      if (waiting) ops("follow-ups").info("follow-up nudges wait as drafts (a held autopilot nudge does not survive a restart)", { project: slug, drafts: waiting, author: FOLLOW_UP_DRAFT_AUTHOR });
    }
  } catch {
    // Best-effort: a line, never a start failure.
  }
}

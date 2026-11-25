import { FOLLOW_UP_DEFAULT_AT, FOLLOW_UP_RUN_NOW_PER_DAY, type FollowUpSchedule, type FollowUpTrigger } from "@hub/config/follow-ups";
import type { FollowUpSweepRow, Repos } from "@hub/db";
import { errFields, ops } from "@hub/log/ops";
import { systemClock, type Clock } from "../messengers/autopilot/scheduler";
import { localDay, runSweep, type SweepDeps } from "./sweep";

// The sweep's timer (decision 0050 point 1, P142 F4): the first timer in the Hub that starts a model. Once a minute (on the injected
// clock) it looks at each active project's `follow_ups.schedule` and `follow_ups.at`: a project whose time of day has passed and
// that has no scheduled or catch-up sweep today runs one (`schedule` within 15 minutes of its time, else `catch_up`: the Mac slept
// or the server was off). The owner's Run follow-ups now runs one at once, at most 3 a day; a click while one runs joins it. One
// sweep at a time per project. No brain on this server (a test, an e2e run without the fake): no timer at all.

export interface FollowUpSettings {
  schedule: FollowUpSchedule;
  at: string;
}

export interface ScheduleDeps extends SweepDeps {
  /** The active projects' slugs and their settings (project.md, read on every tick). */
  projects: () => Promise<Array<{ slug: string; settings: FollowUpSettings }>>;
  tickMs?: number;
}

const log = ops("follow-ups");
const ON_TIME_MS = 15 * 60_000;
const minutesOf = (at: string) => Number(at.slice(0, 2)) * 60 + Number(at.slice(3, 5));
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** The next time `at` comes on this Mac's clock after `now` (today when it has not passed, else tomorrow). */
export function nextRun(now: Date, at: string, sweptToday: boolean): Date {
  const today = new Date(startOfDay(now).getTime() + minutesOf(at) * 60_000);
  return !sweptToday && today.getTime() >= now.getTime() - 60_000 ? today : new Date(today.getTime() + 24 * 3_600_000);
}

export function followUpSchedule(d: ScheduleDeps) {
  const clock: Clock = d.clock ?? systemClock;
  const running = new Map<string, Promise<FollowUpSweepRow | null>>();
  let timer: unknown = null;
  let stopped = false;

  const sweepsToday = async (slug: string) => d.repos.followUps.sweepsSince(slug, startOfDay(new Date(clock.now())).toISOString());

  const start = (slug: string, trigger: FollowUpTrigger): Promise<FollowUpSweepRow | null> => {
    const cur = running.get(slug);
    if (cur) return cur;
    const p = runSweep(d, slug, trigger)
      .catch((e: unknown) => {
        log.error("the follow-up sweep did not run", { project: slug, ...errFields(e) });
        return null;
      })
      .finally(() => running.delete(slug));
    running.set(slug, p);
    return p;
  };

  /** One look at every project: a sweep for each whose time has passed today and that has not been swept by the timer today. */
  const tick = async (): Promise<void> => {
    const now = new Date(clock.now());
    for (const { slug, settings } of await d.projects()) {
      if (settings.schedule !== "daily" || running.has(slug)) continue;
      const due = startOfDay(now).getTime() + minutesOf(settings.at || FOLLOW_UP_DEFAULT_AT) * 60_000;
      if (now.getTime() < due) continue;
      if ((await sweepsToday(slug)).some((s) => s.trigger !== "button")) continue;
      void start(slug, now.getTime() - due <= ON_TIME_MS ? "schedule" : "catch_up");
    }
  };

  const loop = () => {
    if (stopped) return;
    timer = clock.setTimeout(() => {
      void tick()
        .catch((e: unknown) => log.error("the follow-up timer's look failed", errFields(e)))
        .finally(loop);
    }, d.tickMs ?? 60_000);
  };

  return {
    /** Starts the timer with a first look now (the catch-up on start). */
    begin(): void {
      void tick().catch((e: unknown) => log.error("the follow-up timer's first look failed", errFields(e)));
      loop();
    },
    tick,
    /** Run follow-ups now (the owner's button): joins a running sweep; refused after 3 a day. */
    async runNow(slug: string): Promise<{ joined: boolean; sweep: Promise<FollowUpSweepRow | null> } | { refused: string }> {
      const cur = running.get(slug);
      if (cur) return { joined: true, sweep: cur };
      if ((await sweepsToday(slug)).filter((s) => s.trigger === "button").length >= FOLLOW_UP_RUN_NOW_PER_DAY) return { refused: `Run follow-ups now runs at most ${FOLLOW_UP_RUN_NOW_PER_DAY} times a day` };
      return { joined: false, sweep: start(slug, "button") };
    },
    isRunning: (slug: string) => running.has(slug),
    /** Why Run now is not offered today, or null. */
    async runNowOff(slug: string): Promise<string | null> {
      return (await sweepsToday(slug)).filter((s) => s.trigger === "button").length >= FOLLOW_UP_RUN_NOW_PER_DAY ? `used ${FOLLOW_UP_RUN_NOW_PER_DAY} of ${FOLLOW_UP_RUN_NOW_PER_DAY} today` : null;
    },
    async sweptToday(slug: string): Promise<boolean> {
      return (await sweepsToday(slug)).some((s) => s.trigger !== "button");
    },
    today: () => localDay(new Date(clock.now())),
    async stop(): Promise<void> {
      stopped = true;
      if (timer !== null) clock.clearTimeout(timer);
      await Promise.all([...running.values()]);
    },
  };
}

export type FollowUpScheduleHandle = ReturnType<typeof followUpSchedule>;

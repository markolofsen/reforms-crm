import { LEAD_PASS_DEFAULT_AT, LEAD_PASS_RUN_NOW_PER_DAY, LEAD_PASS_SWEEP_WAIT_MS, type LeadPassSchedule, type LeadPassTrigger } from "@hub/config/lead-pass";
import type { LeadPassRow } from "@hub/db";
import { errFields, ops } from "@hub/log/ops";
import { systemClock, type Clock } from "../messengers/autopilot/scheduler";
import { nextRun } from "../follow-ups/schedule";
import { runPass, type PassDeps } from "./pass";

// The lead pass's timer (decision 0055 point 1, P147 L4), beside P142's sweep timer and built on its helpers (`nextRun`). Once a
// minute it looks at each active project's `leads.pass` and `leads.pass_at`: a project whose time of day has passed and that has
// no scheduled or catch-up pass today runs one. D8: it starts only after the day's follow-up sweep finished (a `follow_up_sweeps`
// row of today, not a button's, with `finished_at`), or 30 minutes past its time when no sweep started, so the two never share
// the pool. The owner's Run lead pass now runs one at once, at most 3 a day; a click while one runs joins it. One pass at a time
// per project. No brain on this server: no timer at all.

export interface LeadPassSettings {
  schedule: LeadPassSchedule;
  at: string;
  /** Whether the project's follow-up sweep runs daily (D8 waits for it only then). */
  sweepDaily: boolean;
}

export interface LeadScheduleDeps extends PassDeps {
  projects: () => Promise<Array<{ slug: string; settings: LeadPassSettings }>>;
  tickMs?: number;
}

const log = ops("lead-pass");
const ON_TIME_MS = 15 * 60_000;
const minutesOf = (at: string) => Number(at.slice(0, 2)) * 60 + Number(at.slice(3, 5));
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** D8: whether the scheduled pass may start now: no sweep runs daily, today's sweep finished, or the 30-minute wait is over. */
export function afterSweep(o: { now: number; due: number; sweepDaily: boolean; sweeps: ReadonlyArray<{ trigger: string; finishedAt: string | null }> }): boolean {
  if (!o.sweepDaily) return true;
  const own = o.sweeps.filter((s) => s.trigger !== "button");
  if (own.some((s) => s.finishedAt !== null)) return true;
  return o.now >= o.due + LEAD_PASS_SWEEP_WAIT_MS;
}

export function leadPassSchedule(d: LeadScheduleDeps) {
  const clock: Clock = d.clock ?? systemClock;
  const running = new Map<string, Promise<LeadPassRow | null>>();
  let timer: unknown = null;
  let stopped = false;
  const since = () => startOfDay(new Date(clock.now())).toISOString();
  const passesToday = async (slug: string) => d.repos.leadPass.passesSince(slug, since());

  const start = (slug: string, trigger: LeadPassTrigger): Promise<LeadPassRow | null> => {
    const cur = running.get(slug);
    if (cur) return cur;
    const p = runPass(d, slug, trigger)
      .catch((e: unknown) => {
        log.error("the lead pass did not run", { project: slug, ...errFields(e) });
        return null;
      })
      .finally(() => running.delete(slug));
    running.set(slug, p);
    return p;
  };
  const nowRuns = async (slug: string) => (await passesToday(slug)).filter((s) => s.trigger === "button" || (s.trigger === "dock" && s.turns + s.listed > 0)).length;
  const ranToday = async (slug: string) => (await passesToday(slug)).some((s) => s.trigger === "schedule" || s.trigger === "catch_up");

  const tick = async (): Promise<void> => {
    const now = new Date(clock.now());
    for (const { slug, settings } of await d.projects()) {
      if (settings.schedule !== "daily" || running.has(slug)) continue;
      const due = startOfDay(now).getTime() + minutesOf(settings.at || LEAD_PASS_DEFAULT_AT) * 60_000;
      if (now.getTime() < due || (await ranToday(slug))) continue;
      const sweeps = await d.repos.followUps.sweepsSince(slug, since());
      if (!afterSweep({ now: now.getTime(), due, sweepDaily: settings.sweepDaily, sweeps })) continue;
      void start(slug, now.getTime() - due <= ON_TIME_MS + LEAD_PASS_SWEEP_WAIT_MS ? "schedule" : "catch_up");
    }
  };

  const loop = () => {
    if (stopped) return;
    timer = clock.setTimeout(() => {
      void tick()
        .catch((e: unknown) => log.error("the lead pass timer's look failed", errFields(e)))
        .finally(loop);
    }, d.tickMs ?? 60_000);
  };

  return {
    begin(): void {
      void tick().catch((e: unknown) => log.error("the lead pass timer's first look failed", errFields(e)));
      loop();
    },
    tick,
    /**
     * Run lead pass now (the owner's button, or `lead_pass_start` from the dock, trigger `dock`, F3 of 3d): joins a running pass;
     * the two share 3 a day. The dock's own attended decisions are `dock` rows too, but with no turns: they do not count here.
     */
    async runNow(slug: string, trigger: "button" | "dock" = "button"): Promise<{ joined: boolean; pass: Promise<LeadPassRow | null> } | { refused: string }> {
      const cur = running.get(slug);
      if (cur) return { joined: true, pass: cur };
      if ((await nowRuns(slug)) >= LEAD_PASS_RUN_NOW_PER_DAY) return { refused: `Run lead pass now runs at most ${LEAD_PASS_RUN_NOW_PER_DAY} times a day` };
      return { joined: false, pass: start(slug, trigger) };
    },
    isRunning: (slug: string) => running.has(slug),
    async runNowOff(slug: string): Promise<string | null> {
      return (await nowRuns(slug)) >= LEAD_PASS_RUN_NOW_PER_DAY ? `used ${LEAD_PASS_RUN_NOW_PER_DAY} of ${LEAD_PASS_RUN_NOW_PER_DAY} today` : null;
    },
    /** The next scheduled pass after now (the sweep's wait not counted), or null when the project's pass is off. */
    async next(slug: string, s: Pick<LeadPassSettings, "schedule" | "at">): Promise<string | null> {
      return s.schedule === "daily" ? nextRun(new Date(clock.now()), s.at, await ranToday(slug)).toISOString() : null;
    },
    async stop(): Promise<void> {
      stopped = true;
      if (timer !== null) clock.clearTimeout(timer);
      await Promise.all([...running.values()]);
    },
  };
}

export type LeadPassScheduleHandle = ReturnType<typeof leadPassSchedule>;

import type { Ctx } from "./context";

export type Level = "pass" | "warn" | "fail";
/** `ms`: the check's own wall time, when the runner's clock would mislead (rows started together, as the `Leads` forms are). */
export interface CheckResult { level: Level; detail: string; ms?: number }

/** One installer step. install = check, then apply only when the check fails; doctor = check only. */
export interface Step {
  id: string;
  group: string;
  title: string;
  /** Why the step exists, in the client's words. Goes into @docs/setup/checklist.md. */
  why: string;
  /** What the check proves, in words. Goes into @docs/setup/checklist.md so guide and check cannot drift. */
  verifies: string;
  check(ctx: Ctx): Promise<CheckResult>;
  /** Automatic fix; returns a one-line "what I did". Absent for manual steps. */
  apply?(ctx: Ctx): Promise<string>;
  /** What apply does, for dry-run and the docs. */
  does?: string;
  /**
   * Off by default. `automation`: only the optional extras (Notion token, Telegram poller) need it;
   * `hub setup`, `install` and `doctor` skip it unless `--automation`.
   */
  optional?: "automation";
  /**
   * A health check the doctor judges, not something setup or install can bring about (the backup steps: a fresh instance has none yet).
   * `setup`, `install` and `guide` skip it unless named with `--only`; `doctor` runs it.
   */
  audit?: true;
  /**
   * The doctor replaces this step by the steps it returns, one row each, before it runs (the `Leads` group: one row per form listed in the
   * instance's config). `check` stays the one-row summary that `install` and the docs use.
   */
  expand?(ctx: Ctx): Promise<Step[]>;
  /** Numbered guide for what the installer cannot do. Printed by the guide command, then verified by check. */
  manual?: { steps: string[] };
}

export type Outcome = "ok" | "changed" | "manual" | "skipped" | "failed" | "warn";
export interface StepReport { step: Step; outcome: Outcome; detail: string; /** Wall time of the step, in milliseconds. */ ms?: number }

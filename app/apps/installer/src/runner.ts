import * as p from "@clack/prompts";
import type { Ctx } from "./context";
import { redact } from "@hub/connections";
import type { Outcome, Step, StepReport } from "./types";
import { ops } from "@hub/log/ops";

/**
 * P137 L2: an install or doctor run is one ops line at its end (file only: the CLI prints its own table): `info` with the counts
 * and the time, `warn` naming the failing steps. Never a step's detail (it can name a path or an address; the table has it).
 */
function runLine(kind: "install" | "doctor", reports: StepReport[], t0: number): void {
  const failed = reports.filter((r) => r.outcome === "failed" || r.outcome === "manual").map((r) => r.step.id).slice(0, 20);
  const fields = { steps: reports.length, failed, warned: reports.filter((r) => r.outcome === "warn").length, ms: Date.now() - t0 };
  const log = ops("installer", { fileOnly: true });
  if (failed.length) log.warn(`${kind}: ${failed.length} step(s) failing`, fields);
  else log.info(`${kind}: ${summary(reports)}`, fields);
}

const safe = (ctx: Ctx, s: string) => redact(ctx.configDir, s).replace(/\s+/g, " ").trim();
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function check(ctx: Ctx, s: Step) {
  try { return await s.check(ctx); } catch (e) { return { level: "fail" as const, detail: `check crashed: ${safe(ctx, errText(e))}` }; }
}

/** Replaces each step that expands (one row per configured item) by its rows. A step whose expansion throws stays, as a failing row. */
export async function expandSteps(ctx: Ctx, steps: Step[]): Promise<Step[]> {
  const out: Step[] = [];
  for (const s of steps) {
    if (!s.expand) { out.push(s); continue; }
    try { out.push(...(await s.expand(ctx))); } catch (e) {
      const detail = `could not list its rows: ${safe(ctx, errText(e))}`;
      out.push({ ...s, expand: undefined, check: async () => ({ level: "fail", detail }) });
    }
  }
  return out;
}

/** Runs the checks in order (after {@link expandSteps}). `onStep` is called with each report the moment its step finishes, so a slow doctor is never silent. Each report carries its wall time. */
export async function doctor(ctx: Ctx, steps: Step[], onStep?: (r: StepReport) => void): Promise<StepReport[]> {
  const started = Date.now();
  const out: StepReport[] = [];
  for (const step of await expandSteps(ctx, steps)) {
    const t0 = Date.now();
    const r = await check(ctx, step);
    const report: StepReport = { step, outcome: r.level === "pass" ? "ok" : r.level === "warn" ? "warn" : "failed", detail: safe(ctx, r.detail), ms: r.ms ?? Date.now() - t0 };
    out.push(report);
    onStep?.(report);
  }
  runLine("doctor", out, started);
  return out;
}

/** check -> apply only when the check fails -> check again. Manual steps are never applied. */
export async function install(ctx: Ctx, steps: Step[]): Promise<StepReport[]> {
  const started = Date.now();
  const out: StepReport[] = [];
  for (const step of steps) {
    const r = await check(ctx, step);
    if (r.level === "pass") { out.push({ step, outcome: "ok", detail: safe(ctx, r.detail) }); continue; }
    if (r.level === "warn") { out.push({ step, outcome: "warn", detail: safe(ctx, r.detail) }); continue; }
    if (!step.apply) { out.push({ step, outcome: "manual", detail: safe(ctx, r.detail) }); continue; }
    if (ctx.dryRun) { out.push({ step, outcome: "skipped", detail: `would: ${step.does ?? "apply"} (now: ${safe(ctx, r.detail)})` }); continue; }
    try {
      const did = await step.apply(ctx);
      const after = await check(ctx, step);
      out.push(after.level === "fail"
        ? { step, outcome: "failed", detail: `applied (${safe(ctx, did)}) but check still fails: ${safe(ctx, after.detail)}` }
        : { step, outcome: "changed", detail: safe(ctx, did) });
    } catch (e) {
      out.push({ step, outcome: "failed", detail: safe(ctx, errText(e)) });
    }
  }
  if (!ctx.dryRun) runLine("install", out, started);
  return out;
}

const MARK: Record<Outcome, string> = { ok: "PASS", changed: "DONE", manual: "TODO", skipped: "PLAN", failed: "FAIL", warn: "WARN" };

const secs = (ms: number | undefined): string => (ms === undefined ? "" : `${(ms / 1000).toFixed(1)}s`);

/** The id column is as wide as the longest step id, so rows printed one by one line up with a header printed first. */
export const idWidth = (steps: Step[]): number => Math.max(...steps.map((s) => s.id.length), 4);
/** `timed`: a time column (the doctor's; `install` rows carry no time). */
export const tableHeader = (w: number, timed = false): string => `${"".padEnd(5)} ${"step".padEnd(w)}  ${timed ? `${"time".padStart(6)}  ` : ""}detail`;
export const tableRow = (r: StepReport, w: number, timed = false): string => `${MARK[r.outcome].padEnd(5)} ${r.step.id.padEnd(w)}  ${timed ? `${secs(r.ms).padStart(6)}  ` : ""}${r.detail}`;

export function table(reports: StepReport[]): string {
  const w = idWidth(reports.map((r) => r.step));
  const timed = reports.length > 0 && reports.every((r) => r.ms !== undefined);
  return [tableHeader(w, timed), ...reports.map((r) => tableRow(r, w, timed))].join("\n");
}

/**
 * The slowest steps (over a second), for the line under the summary. Empty when none is. `wallMs`: the run's own time; without it the total
 * is the sum of the rows, which overstates a run whose rows ran together (the `Leads` forms).
 */
export function slowest(reports: StepReport[], n = 3, wallMs?: number): string {
  const slow = reports.filter((r) => (r.ms ?? 0) >= 1000).sort((a, b) => b.ms! - a.ms!).slice(0, n);
  return slow.length ? `slowest: ${slow.map((r) => `${r.step.id} ${secs(r.ms)}`).join(", ")}; total ${secs(wallMs ?? reports.reduce((s, r) => s + (r.ms ?? 0), 0))}` : "";
}

export function summary(reports: StepReport[]): string {
  const n = (o: Outcome) => reports.filter((r) => r.outcome === o).length;
  const bits = [`${n("ok")} ok`, n("changed") && `${n("changed")} changed`, n("skipped") && `${n("skipped")} planned`, n("warn") && `${n("warn")} warnings`, n("manual") && `${n("manual")} manual left`, n("failed") && `${n("failed")} failing`].filter(Boolean);
  return bits.join(", ");
}

export const exitCode = (reports: StepReport[]) => (reports.some((r) => r.outcome === "failed" || r.outcome === "manual") ? 1 : 0);

/** Numbered guide for one manual step. */
export function guideText(step: Step): string {
  return [`${step.title}`, `Why: ${step.why}`, "", ...(step.manual?.steps ?? []).map((t, i) => `${i + 1}. ${t}`), "", `Checked by: ${step.verifies}`].join("\n");
}

export function printGuides(reports: StepReport[]): void {
  const todo = reports.filter((r) => r.outcome === "manual" && r.step.manual);
  todo.forEach((r, i) => p.note(guideText(r.step), `Manual step ${i + 1} of ${todo.length}: ${r.step.id}`));
}

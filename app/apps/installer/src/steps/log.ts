import { opsStoreOf, readOps, type OpsLine } from "@hub/log/ops";
import type { Step } from "../types";
import { fail, pass, warn } from "./helpers";

// P137 verdict 4 (L3): the ops log's errors are read by someone. `log.errors` FAILs on any `error` line of the last 24 h (the
// three most frequent messages, with their counts and sources) and WARNs past `WARN_THRESHOLD` warnings; Overview's Recent errors
// and Activity ▸ Errors show the same lines.

export const LOG_ERRORS_HOURS = 24;
/** More warnings than this in a day is a WARN: a retry loop or a part that keeps failing quietly. */
export const WARN_THRESHOLD = 50;

/** The `n` most frequent messages, `3× mail: a Mail script failed`. Messages are already redacted by the writer. */
export function topMessages(lines: readonly OpsLine[], n = 3): string {
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(`${l.source}: ${l.message.slice(0, 120)}`, (counts.get(`${l.source}: ${l.message.slice(0, 120)}`) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([m, c]) => `${c}× ${m}`).join("; ");
}

export function logErrorsCheck(lines: readonly OpsLine[]): { level: "pass" | "warn" | "fail"; detail: string } {
  const errors = lines.filter((l) => l.level === "error");
  const warnings = lines.length - errors.length;
  const tail = "(./run.sh logs --level warn; Activity ▸ Errors)";
  if (errors.length) return fail(`${errors.length} error line(s) in ${LOG_ERRORS_HOURS} h: ${topMessages(errors)} ${tail}`);
  if (warnings > WARN_THRESHOLD) return warn(`${warnings} warnings in ${LOG_ERRORS_HOURS} h (over ${WARN_THRESHOLD}): ${topMessages(lines)} ${tail}`);
  return pass(`no errors in ${LOG_ERRORS_HOURS} h, ${warnings} warning(s)`);
}

export const logSteps: Step[] = [
  {
    id: "log.errors", group: "Log", title: "Nothing failed in the last day",
    why: "Every part of the Hub writes what failed to the ops log; an error nobody reads is a send, a draft or a Notion write that quietly did not happen.",
    verifies: `The ops log (state/log/ops-<day>.jsonl) has no error line in the last ${LOG_ERRORS_HOURS} h (FAIL with the most frequent messages), and at most ${WARN_THRESHOLD} warnings (else WARN).`,
    manual: { steps: ["Read the lines: `./run.sh logs --level warn` or Activity ▸ Errors in the admin. Each names its part and the page that fixes it.", "Fix the cause; the row passes once a day has passed without a new error."] },
    async check(ctx) {
      const since = new Date(Date.now() - LOG_ERRORS_HOURS * 3_600_000).toISOString();
      return logErrorsCheck(readOps(opsStoreOf(ctx.paths), { level: "warn", since }));
    },
  },
];

import { capSentence } from "../settings";
import { LlmError } from "../transport/types";
import type { Ledger } from "./ledger";

/**
 * The two spend limits, checked before EVERY attempt so a refused call makes no request (decision 0039 point 4, decision 0051):
 * the instance cap (every project and task this month) and, when the task declares one, the task's own monthly budget inside
 * it, so one task (the watcher) cannot starve the others (the pre-analysis, the reply).
 */

const usd = (micro: number): string => `$${(micro / 1e6).toFixed(2)}`;

export interface Limits {
  capMicroUsd: number;
  /** The task's own budget, or null when it declares none. */
  task: { name: string; budgetMicroUsd: number } | null;
}

/** Throws `LlmError("budget")` when either limit is reached. */
export async function checkLimits(ledger: Ledger, limits: Limits, now: Date): Promise<void> {
  const month = await ledger.monthCost({}, now);
  if (month >= limits.capMicroUsd) throw new LlmError("budget", `The monthly LLM cap is reached (${usd(month)} of ${usd(limits.capMicroUsd)}). ${capSentence}`);
  if (!limits.task) return;
  const spent = await ledger.monthCost({ task: limits.task.name }, now);
  if (spent >= limits.task.budgetMicroUsd) {
    throw new LlmError("budget", `The task ${limits.task.name} reached its monthly budget (${usd(spent)} of ${usd(limits.task.budgetMicroUsd)}). It runs again next month (UTC), or raise the budget where the task is declared.`);
  }
}

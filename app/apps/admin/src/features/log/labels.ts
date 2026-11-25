import type { ActivityRowDto } from "@hub/contract/activity";
import type { ActivityView } from "@/routes/search";
import { readReason } from "@/lib/agent-reasons";

// The words of the Activity screen (P73), as pure functions of the contract (Vitest tests in `test/log-*.test.ts`).

/** The View menu of Activity: the timeline's views by outcome, then Follow-ups (P142: the sweep's plans), Sends (UX pass 2026-11-20), the send history, and Errors. */
export const VIEW_LABELS: Record<ActivityView, string> = { all: "All", needs_you: "Needs you", drafts: "Drafts", skipped: "Skipped", "follow-ups": "Follow-ups", sends: "Sends", errors: "Errors" };
export const VIEW_ORDER: readonly ActivityView[] = ["all", "needs_you", "drafts", "skipped", "follow-ups", "sends", "errors"];

/** The parts of a row's reason: a short phrase for a code, the agent's words as the detail. */
export function reasonParts(r: ActivityRowDto): { why: string; detail: string | null } {
  if (r.why === null || r.why.trim() === "") return { why: "", detail: null };
  const { phrase, detail } = readReason(r.why);
  return { why: phrase, detail };
}


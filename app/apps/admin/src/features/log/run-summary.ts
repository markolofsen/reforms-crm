import type { RunStatus } from "@hub/config";
import type { RunDto } from "@hub/contract/responses";
import { duration, plural } from "@/lib/format";

/** What each skill does, as the first half of a sentence about a run. A skill nobody listed reads as "Ran <skill>". */
const WHAT: Record<string, string> = {
  "triage-mail": "Went through the mail",
  "bulk-drafts": "Prepared a batch of drafts",
  calendar: "Looked at the calendar",
  "mail-filters": "Sorted the mail by sender",
  "knowledge-import": "Loaded the knowledge base",
  "kb-review": "Checked the knowledge base for gaps",
  "project-setup": "Set the project up",
  "notion-project-deploy": "Built the Notion structure",
};

const OUTCOME: Record<RunStatus, string> = {
  ok: "Done.",
  needs_human: "Needs you.",
  failed: "Did not finish.",
};

/** "Went through the mail. Needs you." */
export function runSentence(r: RunDto): string {
  const what = r.skill ? (WHAT[r.skill] ?? `Ran ${r.skill}`) : "The agent worked";
  return `${what}. ${OUTCOME[r.status]}`;
}

/** "14 Nov, 09:12 · 3m 4s · 7 events" */
export function runMeta(r: RunDto, when: string): string {
  return [when, duration(r.startedAt, r.finishedAt), plural(r.eventCount, "event")].join(" · ");
}

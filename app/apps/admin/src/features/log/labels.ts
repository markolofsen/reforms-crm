import type { ActivityRowDto } from "@hub/contract/activity";
import type { ActivityView } from "@/routes/search";

// The words of the Activity screen (P73), as pure functions of the contract (Vitest tests in `test/log-*.test.ts`).

/** The View menu of Activity: the timeline's views by outcome, then Sends (UX pass 2026-11-20), the send history. */
export const VIEW_LABELS: Record<ActivityView, string> = { all: "All", needs_you: "Needs you", drafts: "Drafts", skipped: "Skipped", sends: "Sends" };
export const VIEW_ORDER: readonly ActivityView[] = ["all", "needs_you", "drafts", "skipped", "sends"];

// The agent's reason codes in the owner's words (UX pass 2026-11-20). The agent writes a skip as `<code>: <its own words>`
// (skills README, Report: `skipped:<code>`); the code stays in the data and the screen says a short phrase for it, with the
// agent's words kept as the muted detail. Tested in `test/log-reasons.test.ts`.

/** One phrase per code the skills name (README Report codes, sequence-drafts' `open-draft` and its stop reasons). Keys use dashes. */
export const REASON_LABELS: Readonly<Record<string, string>> = {
  "already-drafted": "Already has a draft",
  "not-allowed-recipient": "Not an allowed recipient",
  "do-not-contact": "Do not contact",
  "last-is-ours": "We wrote last",
  "no-message-to-reply": "No message to reply to",
  scheduling: "Wants a meeting",
  cap: "Over the run's limit",
  "open-draft": "Has an open draft",
  error: "Error",
  replied: "They replied",
  bounced: "Mail bounced",
  "opted-out": "Opted out",
  "out-of-office": "Out of office",
  closed: "Deal closed",
  excluded: "Excluded",
  stopped: "Stopped",
};

/** What a reason reads as: the phrase and the agent's own words after the code (null when it wrote none). */
export type Reason = { code: string | null; phrase: string; detail: string | null };

/** A code is lowercase words joined by `-` or `_`; `draft.recipients=test: ...` is not one (it is the agent's words). */
const CODED = /^(?:skipped\s*:\s*)?([a-z][a-z0-9]*(?:[-_][a-z0-9]+)*)(?:(\s*:\s*|\s*,\s*)([\s\S]*))?$/;

const keyOf = (code: string): string => code.replaceAll("_", "-");

/** "out_of_office" or "some-new-code" as words: "Out of office", "Some new code". */
export const humanise = (code: string): string => {
  const s = code.replace(/[-_]+/g, " ").trim();
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
};

const blank = (s: string | undefined): string | null => (s && s.trim() !== "" ? s.trim() : null);

/**
 * Reads a reason. A known code, with or without words after it; an unknown one only when a colon follows it or it has a
 * dash or underscore, so a one-word reason ("newsletter") stays the agent's word. `error:<tool>` names the tool. Anything
 * else is the agent's own sentence, shown as written (code null).
 */
export function readReason(why: string): Reason {
  const text = why.trim();
  const m = CODED.exec(text);
  if (m) {
    const [, code = "", sep = "", rest] = m;
    const known = REASON_LABELS[keyOf(code)];
    const colon = sep.includes(":");
    if (known !== undefined || (sep !== "" && colon) || /[-_]/.test(code)) {
      // A comma after an unknown word is a sentence ("newsletter, no reply"), not a code.
      if (known === undefined && sep !== "" && !colon) return { code: null, phrase: text, detail: null };
      if (keyOf(code) === "error" && colon) {
        const tool = /^([a-z][a-z0-9_-]*)(?:\s*:\s*([\s\S]*))?$/i.exec(rest ?? "");
        if (tool?.[1]) return { code, phrase: `Error in ${tool[1]}`, detail: blank(tool[2]) };
      }
      return { code, phrase: known ?? humanise(code), detail: blank(rest) };
    }
  }
  return { code: null, phrase: text, detail: null };
}

/** The parts of a row's reason: a short phrase for a code, the agent's words as the detail. */
export function reasonParts(r: ActivityRowDto): { why: string; detail: string | null } {
  if (r.why === null || r.why.trim() === "") return { why: "", detail: null };
  const { phrase, detail } = readReason(r.why);
  return { why: phrase, detail };
}


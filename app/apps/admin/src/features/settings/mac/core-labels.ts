import type { CoreLevel } from "@hub/config";
import type { CoreUpdateDto } from "@hub/contract/instance";
import { ago, formatTime } from "@/lib/format";

/** The level as one word (P68). A total map: a new level fails `tsc` here. */
export const CORE_LEVEL_WORDS: Record<CoreLevel, string> = {
  unknown: "not checked",
  current: "up to date",
  available: "update available",
  recommended: "update recommended",
  required: "update required",
  follows: "follows a branch",
};

/**
 * The sidebar's one quiet line: `core v0.12.11`, then a dot for recommended and required (the nav's dot, not a second system), a
 * plain "update available" for a patch, nothing more otherwise.
 */
export function coreLine(d: CoreUpdateDto): { text: string; note: string | null; dot: boolean } {
  const text = `core ${d.pin ?? d.inUse ?? "unknown"}`;
  if (d.local) return { text, note: "local checkout", dot: false };
  if (d.level === "recommended" || d.level === "required") return { text, note: CORE_LEVEL_WORDS[d.level], dot: true };
  if (d.level === "available") return { text, note: CORE_LEVEL_WORDS.available, dot: false };
  return { text, note: null, dot: false };
}

/** "Last checked 3 h ago", and when the last try failed, when and why: the block keeps the last answer, never an error page. */
export function checkedLine(d: CoreUpdateDto, now: number): string {
  const last = d.checkedAt ? `Last checked ${ago(d.checkedAt, now)} (${formatTime(d.checkedAt)})` : "Not checked yet";
  return d.error ? `${last}; the check ${ago(d.error.at, now)} failed: ${d.error.message}` : `${last}.`;
}

/** The facts of the move in words, empty when none applies. */
export function factsLine(d: CoreUpdateDto): string | null {
  const f = [d.facts.migrations ? "the database migrates" : "", d.facts.dependencies ? "dependencies change" : "", d.facts.rollback ? "the pin is newer than the newest tag (a rollback)" : ""].filter(Boolean);
  return f.length ? `${f.join("; ")}.` : null;
}

/** The command as one text, for the copy button: the lines run in order in one shell. */
export const commandText = (d: CoreUpdateDto): string => d.command.join("\n");

import { SAFETY_LABELS } from "@hub/config";
import type { DraftMailDto } from "@hub/contract/mail";
import type { SafetyResultDto } from "@hub/contract/review";
import type { SendPreviewDto } from "@hub/contract/sending";
import { mailProblem } from "@/features/mail/draft/mail-read/tick-guard";
import type { ReviewDraft } from "@/features/mail/model";
import { teammateLine } from "@/features/mail/draft/card-state";

// P105: what the review dialog of one Mail Send lists, as a pure function of what the card already knows (the draft, its live
// Mail read, a changed-under mark, what a refused confirm said). Two severities: a warning is read and accepted by Send; a
// blocker keeps Send off and names its fix. Nothing here sends.

/** The fix a blocker offers: read Mail again, or move the Hub's leftover drafts to Trash (Tidy). */
export type SendFix = "read" | "tidy";
export type SendProblem = { key: string; severity: "blocker" | "warning"; text: string; rule: string | null; fix: SendFix | null };

export type SendReviewInput = {
  d: Pick<ReviewDraft, "safetyResults" | "safety" | "status" | "repliedElsewhere" | "teamSent">;
  /** The card's read of Mail; undefined while it is read (or when it failed: `readError`). */
  mail: DraftMailDto | undefined;
  readError: string | null;
  /** The agent changed the draft since the card opened (`useChangedUnder`). */
  changedUnder: boolean;
  /** What a refused or failed confirm said, in the server's words. */
  refused: readonly string[];
};

/** The server refuses a placeholder whatever was acknowledged (`assess`), so it is a blocker, never a warning to accept. */
const ALWAYS_BLOCKS: ReadonlySet<SafetyResultDto["kind"]> = new Set(["unresolved_marker"]);

/** The checks the dialog shows: the ones run on the live Mail text when it was read, else the stored ones; only those still open. */
export function shownResults(i: Pick<SendReviewInput, "d" | "mail">): SafetyResultDto[] {
  const all = i.mail?.found ? i.mail.safetyResults : i.d.safetyResults;
  return all.filter((r) => !r.acked);
}

/** Every problem, blockers before warnings in the dialog (it orders them); a warning per open check. */
export function sendProblems(i: SendReviewInput): SendProblem[] {
  const out: SendProblem[] = [];
  const block = (key: string, text: string, fix: SendFix | null = "read") => out.push({ key, severity: "blocker", text, rule: null, fix });
  const { mail } = i;
  if (!mail && i.readError !== null) block("read-error", `The draft could not be read from Mail: ${i.readError}`);
  if (mail && !mail.configured) block("no-mailer", "This server cannot read Mail, so the text cannot be checked here. Send it from Mail.", null);
  if (mail?.configured && !mail.found) block("not-found", `${mailProblem(mail.reason)}.`);
  if (mail?.found && mail.note) block("versions", mail.note, "tidy");
  if (mail?.found && !mail.note && !mail.hash) block("no-hash", "The text of this draft has no hash, so it cannot be sent from here.");
  if (i.changedUnder) block("changed", "The agent changed this draft since you opened it: read it again before sending.");
  i.refused.forEach((r, n) => block(`refused-${n}`, r));
  for (const r of shownResults(i)) {
    if (ALWAYS_BLOCKS.has(r.kind)) out.push({ key: `check-${r.kind}`, severity: "blocker", text: `${r.text} Edit the draft first.`, rule: SAFETY_LABELS[r.kind], fix: null });
    else out.push({ key: `check-${r.kind}`, severity: "warning", text: r.text, rule: r.level === "red" ? `Red check · ${SAFETY_LABELS[r.kind]}` : SAFETY_LABELS[r.kind], fix: null });
  }
  if (i.d.safety) out.push({ key: "safety", severity: "warning", text: i.d.safety, rule: null, fix: null });
  if (mail?.found && mail.aside) out.push({ key: "aside", severity: "warning", text: mail.aside, rule: null, fix: null });
  const teammate = teammateLine(i.d);
  if (teammate) out.push({ key: "teammate", severity: "warning", text: teammate, rule: null, fix: null });
  return out;
}

/** While the card's Mail read runs, the dialog waits, in words. */
export const sendLoading = (i: Pick<SendReviewInput, "mail" | "readError">): string | null => (!i.mail && i.readError === null ? "Reading the draft from Mail." : null);

const norm = (xs: readonly string[]) => xs.map((x) => x.trim().toLowerCase()).sort().join(",");

/**
 * Whether the dry run's answer is what the dialog showed (the recipients and the subject, without case or order), so the apply
 * sends what the person read. The text itself is bound by Checked's hash on the server. Returns why not, or null.
 */
export function differsFromShown(shown: Pick<DraftMailDto, "to" | "cc" | "subject">, previewed: Pick<SendPreviewDto, "to" | "cc" | "subject">): string | null {
  if (norm(shown.to) !== norm(previewed.to) || norm(shown.cc) !== norm(previewed.cc) || shown.subject !== previewed.subject) return "Mail changed while you read: read it again, then Send.";
  return null;
}

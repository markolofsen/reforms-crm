import type { DraftMailDto } from "@hub/contract/responses";
import type { ReviewDraft } from "../source";
import { hasSwitch, stateOf, type FlowStep } from "../card/card-state";

/** What the guard needs of a Mail read: nothing of the text itself. */
export type MailRead = Pick<DraftMailDto, "configured" | "found" | "hash" | "reason">;

/** False only when this server reads Mail and Mail has no such draft: the one meaning of the `unreadable` state. */
export const mailReadable = (mail: MailRead | undefined): boolean => !(mail?.configured && !mail.found);

/**
 * Why "I read the checks" cannot be switched ON for this draft right now, in words, or null when it can (P27 M3, decision
 * 0013: fail closed). The switch, the `C` key and the server all hold the same line: a Mail draft is Checked only against a
 * text that was read and hashed. Switching OFF is always allowed. A batch draft (written into the hub, no Mail draft of its own) has to read, so
 * it is the one draft that is checked without a hash.
 */
export function tickBlock(d: ReviewDraft, mail: MailRead | undefined, step: FlowStep = "idle"): string | null {
  if (d.checked) return null;
  const state = stateOf(d, step, mailReadable(mail));
  if (state === "unreadable") return `Mail could not be read${mail?.reason ? `: ${mail.reason}` : ""}. Open it in Mail; this draft cannot be checked here.`;
  if (!hasSwitch(state)) return "This draft has nothing to check or send from here.";
  if (d.batchId !== null) return null;
  if (!mail) return "Mail is being read. Checked turns on once the text has been read.";
  if (!mail.configured) return "This server cannot read Mail, so the text has no hash and cannot be checked here.";
  if (!mail.found || !mail.hash) return "The text of this draft has no hash, so it cannot be checked.";
  return null;
}

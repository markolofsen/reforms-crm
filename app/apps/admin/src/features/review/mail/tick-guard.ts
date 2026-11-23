import { hrefOf } from "@hub/contract/local";
import type { DraftMailDto } from "@hub/contract/mail";
import type { ReviewDraft } from "../source";
import { hasSwitch, stateOf, type FlowStep } from "../card/card-state";

/** What the guard needs of a Mail read: nothing of the text itself. */
export type MailRead = Pick<DraftMailDto, "configured" | "found" | "hash" | "reason" | "note">;

/** False only when this server reads Mail and Mail has no such draft: the one meaning of the `unreadable` state. */
export const mailReadable = (mail: MailRead | undefined): boolean => !(mail?.configured && !mail.found);

/**
 * P58 R1: the Mail draft's own Message-ID, when the card's read found exactly one draft for it (no `note` naming several
 * versions) and Mail gave it one; else null, and Open in Mail falls back to the client's message.
 */
export function draftLinkOf(m: Pick<DraftMailDto, "found" | "note" | "messageId"> | undefined | null): string | null {
  if (!m?.found || m.note || !m.messageId) return null;
  return hrefOf("mail.openDraft", { messageId: m.messageId }) ? m.messageId : null;
}

/**
 * Why "I read the checks" cannot be switched ON for this draft right now, in words, or null when it can (P27 M3, decision
 * 0013: fail closed). The switch, the `C` key and the server all hold the same line: a Mail draft is Checked only against a
 * text that was read and hashed. Switching OFF is always allowed. A batch draft (written into the hub, no Mail draft of its own) has to read, so
 * it is the one draft that is checked without a hash. `readError` is the sentence of a failed read of Mail (the request
 * itself failed, not "Mail has no such draft"): it is named, so the card never says "being read" forever.
 */
/**
 * The card's sentence for a Mail read that found no single draft. Two or more matching drafts is not a failed read (P52):
 * Mail holds more than one version, usually an older one still being removed after a revision, so it says that plainly.
 */
export function mailProblem(reason: string | null | undefined): string {
  if (reason?.includes("drafts in Mail match")) return `Mail holds more than one version of this draft: ${reason}`;
  return `Mail could not be read${reason ? `: ${reason}` : ""}`;
}

export function tickBlock(d: ReviewDraft, mail: MailRead | undefined, step: FlowStep = "idle", readError: string | null = null): string | null {
  if (d.checked) return null;
  const state = stateOf(d, step, mailReadable(mail));
  if (state === "unreadable") return `${mailProblem(mail?.reason)}. Open it in Mail; this draft cannot be checked here.`;
  if (!hasSwitch(state)) return "This draft has nothing to check or send from here.";
  if (!mail && readError !== null) return `The text could not be read from Mail: ${readError} Use Retry above, then turn this on.`;
  if (!mail) return "Mail is being read. Checked turns on once the text has been read.";
  if (!mail.configured) return "This server cannot read Mail, so the text has no hash and cannot be checked here.";
  if (mail.found && mail.note) return mail.note;
  if (!mail.found || !mail.hash) return "The text of this draft has no hash, so it cannot be checked.";
  return null;
}

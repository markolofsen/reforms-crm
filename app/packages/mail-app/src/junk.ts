import { JUNK_SCRIPT, TRASH_SCRIPT } from "./scripts/junk";
import type { OsaRun } from "./osa";
import { rawId } from "./records";

// P147 3m item 1: an inbound message the owner (or his attended session) judged junk or phishing goes to Mail's Junk. Junk, like
// Trash, is recoverable in Mail, so this is not a deletion. One message, matched by its account, mailbox and Message-ID. P147
// 3n: the same message to Trash, for anything else the owner does not want (recoverable too).

/** One inbound message as the Mail reader stored it. */
export interface JunkItem {
  account: string;
  mailbox: string;
  messageId: string;
}

export type JunkAnswer = { moved: true } | { moved: false; why: string };

/** Pure: the script's answer. */
export function parseJunkOutput(out: string): JunkAnswer {
  const t = out.trim();
  if (t === "ok") return { moved: true };
  const [, why] = t.split("\t");
  return { moved: false, why: why?.trim() || t || "Mail did not answer" };
}

export async function moveToJunk(osa: OsaRun, i: JunkItem): Promise<JunkAnswer> {
  return parseJunkOutput(await osa(JUNK_SCRIPT, [i.account, i.mailbox, rawId(i.messageId)]));
}

export async function moveToTrash(osa: OsaRun, i: JunkItem): Promise<JunkAnswer> {
  return parseJunkOutput(await osa(TRASH_SCRIPT, [i.account, i.mailbox, rawId(i.messageId)]));
}

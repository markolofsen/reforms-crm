import { newThreadKey } from "@hub/config";
import { HubError } from "@hub/config/errors";
import type { DraftRow, MailVersionRow } from "@hub/db";
import { displayNameFor, visibleFrom } from "@hub/projects/brand";
import type { DraftWriter, InboundMessage } from "@hub/mail-app/writer/types";
import { alreadySentText, draftFinishedText, isNewThreadDraft, reviseDraft, type Revision, type Signed, type WriteLog } from "../mail";

// P126 M3 (verdict 3.3, decision 0030): one use case for a revision of a Hub Mail draft, for both actors. The agent's
// `draft_write {draft}` and the owner's Save and Restore (`PUT`/`POST .../drafts/:id/mail`) call it; each keeps its own
// guards around it (the tool: the bound project, the read-only handle, the short write connection that records the
// version; the route: the exact admin Origin and the send ticket's door, the version recorded on its own handle). The two
// deliberate differences are fields of the input: `quote` (the agent's text gets the quote of the message answered, a
// person's text is written verbatim) and `signReply` (the agent signs from the message's headers; a person's text is
// signed from the draft's recorded brand context). Nothing here sends.

export type DraftRefusalCode = "already_sent" | "draft_finished" | "no_thread" | "not_this_project";

/** A revision the use case refuses before Mail is asked. `run` (hub mcp) answers it under its code; the route as a 409 with its sentence. */
export class DraftRefused extends HubError {
  declare readonly code: DraftRefusalCode;
  constructor(code: DraftRefusalCode, message: string) {
    super("wrong_state", code, message);
    this.name = "DraftRefused";
  }
}

export interface ReviseMailDraftInput {
  actor: "agent" | "person";
  draft: Pick<DraftRow, "id" | "project" | "mailRef" | "status" | "sentAt" | "toAddr" | "subject" | "brand" | "wroteTo" | "context">;
  body: string;
  writer: DraftWriter;
  mail: { accounts: readonly string[]; sender: string | null };
  /** The project's brands, for the From's display name. */
  brands: Parameters<typeof displayNameFor>[0];
  /** The Hub's versions of this draft not yet in Trash (the replace moves only these), newest first; the agent adds its adopted late saves. */
  live: readonly Pick<MailVersionRow, "account" | "messageId">[];
  /** "add": the quote of the message answered is added under the text (the agent); "keep": what Mail holds below it is kept (a person). */
  quote: "add" | "keep";
  /** Signs a new thread's text (no message answered). */
  signNew: (body: string) => Signed;
  /** Signs a reply's text from the message it answers; absent: written unsigned. */
  signReply?: (inbound: InboundMessage, body: string) => Promise<Signed>;
  /** The write record of this thread (`mail_writes`), when the caller has a write handle. */
  log?: (mailRef: string) => WriteLog;
}

/** The revision Mail saved and the thread key its version is recorded under. Recording the version is the caller's (its own handle). */
export async function reviseMailDraft(i: ReviseMailDraftInput): Promise<{ r: Revision; mailRef: string }> {
  const d = i.draft;
  if (d.status === "sent") throw new DraftRefused("already_sent", alreadySentText(d.id, d.sentAt ?? null, i.actor));
  if (i.actor === "agent" && (d.status === "done" || d.status === "skipped")) throw new DraftRefused("draft_finished", draftFinishedText(d.id, d.status));
  const versions = i.live.map((v) => ({ account: v.account, messageId: v.messageId }));
  const log = (mailRef: string) => (i.log ? { log: i.log(mailRef) } : {});
  // P85b: a new thread answers no message; it is rewritten as a new message to the same client, keyed by its client.
  if (!d.mailRef && isNewThreadDraft(d)) {
    const client = d.toAddr.match(/[^\s,;<>"']+@[^\s,;<>"']+/)?.[0] ?? d.toAddr;
    const mailRef = newThreadKey(client);
    const account = i.live[0]?.account ?? i.mail.accounts[0];
    if (!account) throw new DraftRefused("not_this_project", `Project ${d.project} lists no Mail account.`);
    const signed = i.signNew(i.body);
    const displayName = displayNameFor(i.brands, signed.brand ?? d.brand);
    const written = await reviseDraft(i.writer, { accounts: i.mail.accounts, sender: i.mail.sender, displayName, mailRef: null, body: signed.body, quote: "keep", versions, newThread: { to: client, subject: d.subject, account, from: visibleFrom(i.mail.sender, displayName) }, ...log(mailRef) });
    const { body: _body, ...how } = signed;
    return { r: { ...written, ...how }, mailRef };
  }
  if (!d.mailRef) {
    throw new DraftRefused("no_thread", i.actor === "person" ? "This draft answers no Mail message, so it cannot be written here." : `Draft ${d.id} has no mailRef: it answers no Mail message, so it cannot be revised here.`);
  }
  const r = await reviseDraft(i.writer, { accounts: i.mail.accounts, sender: i.mail.sender, clientWroteTo: d.wroteTo ?? null, displayName: displayNameFor(i.brands, d.brand), mailRef: d.mailRef, body: i.body, quote: i.quote, versions, ...(i.signReply ? { sign: i.signReply } : {}), ...log(d.mailRef) });
  return { r, mailRef: d.mailRef };
}

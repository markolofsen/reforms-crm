import { newThreadKey } from "@hub/config";
import { HubError } from "@hub/config/errors";
import type { DraftRow, MailVersionRow } from "@hub/db";
import { displayNameFor, visibleFrom } from "@hub/projects/brands";
import type { DraftWriter, InboundMessage } from "@hub/mail-app/writer/types";
import { alreadySentText, draftFinishedText, fromFor, isNewThreadDraft, reviseDraft, writeRecorded, type Revision, type Signed, type WriteLog } from "../mail";

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

// ---- the first write -------------------------------------------------------------------------------------------------

/** What a first write answers: one message of the project's Mail (a reply), or nothing yet (a new thread to a client). */
export type FirstMailTarget =
  | { kind: "reply"; inbound: InboundMessage }
  | { kind: "new"; to: string; subject: string; account: string; from: string | null };

export interface FirstMailDraftInput {
  writer: DraftWriter;
  mail: { accounts: readonly string[]; sender: string | null };
  /** The brand's display name for the From, or null. */
  displayName: string | null;
  target: FirstMailTarget;
  /** The text as written to Mail: signed by the caller (each actor signs its own way), or unsigned when `signed` is absent. */
  body: string;
  /** How the text was signed; absent: written unsigned (a project with no brands and no signature). */
  signed?: Omit<Signed, "body">;
  /** The address the client wrote to, for a reply's From when `signed` does not carry one. */
  clientWroteTo?: string | null;
  /** A reply's quote: "add" (the agent: the message answered goes under the text) or "keep" (a person). Default: the writer's. */
  quote?: "add" | "keep";
  /** The write record of this thread (`mail_writes`). */
  log?: WriteLog;
}

/**
 * P126 M3: the one first write of a Hub Mail draft, for the agent's first reply (`draft_write` with a message id), the
 * agent's new thread (`draft_write` with `to`) and the owner's manual first reply (`POST .../clients/:id/draft`). Each
 * caller keeps its own refusals before it (the agent's `already_drafted`, `owner_request_needed`, the Notion client
 * check; the route's exact Origin and its open-draft and Mail-draft checks) and records the version and the draft row
 * after it on its own handle. A first write replaces nothing. Nothing here sends.
 */
export async function writeFirstMailDraft(i: FirstMailDraftInput): Promise<Revision> {
  const how = i.signed ?? {};
  if (i.target.kind === "new") {
    const t = i.target;
    const w = await writeRecorded(i.writer, { kind: "new", account: t.account, sender: visibleFrom(t.from, i.displayName), to: t.to, subject: t.subject, body: i.body, replace: [], landIn: i.mail.accounts }, i.log);
    return { ...w, replyTo: 0, account: w.savedIn || t.account, fromReason: null, clientWroteTo: null, ...how };
  }
  const inbound = i.target.inbound;
  // P58: From the address the client wrote to when the receiving account can send as it, else that account.
  const rf = await fromFor(i.writer, inbound, i.signed ? i.signed.wroteTo : (i.clientWroteTo ?? null), i.mail, i.displayName);
  const { accountAddresses: _addresses, ...where } = inbound;
  const w = await writeRecorded(i.writer, { ...where, body: i.body, sender: rf.from, ...(i.quote ? { quote: i.quote } : {}), replace: [], landIn: i.mail.accounts }, i.log);
  return { ...w, replyTo: inbound.messageId, account: w.savedIn || inbound.account, ...how, fromReason: rf.fromReason, clientWroteTo: rf.clientWroteTo };
}

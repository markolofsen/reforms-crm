import { adoptable, type Adoption, type MailVersionRow, type MailWriteRow } from "@hub/db";
import { replyFrom, type ReplyFrom } from "@hub/projects/brands";
import { writtenBody } from "@hub/mail-app/writer/text";
import { DraftWriteError, type DraftWriter, type InboundMessage, type NewDraftInput, type ReplyDraftInput, type ReplyDraftResult, type ThreadMailDraft, type VersionRef } from "@hub/mail-app/writer/types";
import type { Revision, Signed, WriteLog } from "./types";

// The one revision path (P56) and the recorded write (P65 S5), shared by `draft_write` and the admin's Save and Restore.

/** A hub draft that is a new thread (P85b): it answers no message and its recorded context says so (`newThread`). */
export const isNewThreadDraft = (d: { mailRef: string | null; context: string | null }): boolean => {
  if (d.mailRef) return false;
  try {
    const c = JSON.parse(d.context ?? "null") as { newThread?: unknown } | null;
    return c !== null && typeof c === "object" && c.newThread === true;
  } catch {
    return false;
  }
};


export interface ReviseInput {
  /** The project's Mail accounts (`mail.accounts`): the message answered is looked up only there. */
  accounts: readonly string[];
  /** `mail.sender`: the From only when the receiving account is not on `accounts` (P58 `replyFrom`). */
  sender: string | null;
  /** The address the client wrote to when no `sign` resolves it from the headers (a person's Save: the draft row's `wrote_to`). */
  clientWroteTo?: string | null;
  /** The resolved brand's visible From name; absent keeps Mail's account name. */
  displayName?: string | null;
  /** The hub draft's `mailRef`: the Message-ID of the message it answers; null for a new thread (P85b, then `newThread`). */
  mailRef: string | null;
  /** P85b: the draft is a new thread (it answers nothing): rewritten as a new message to `to` with `subject`, from `from`. */
  newThread?: { to: string; subject: string; account: string; from: string | null };
  body: string;
  quote: "add" | "keep";
  /** The Hub's recorded versions of this draft still in Drafts (`mail_versions`, not trashed): each is replaced in its own account. */
  versions: readonly VersionRef[];
  /** P60: turns the body into the signed body once the answered message is known (the agent's revision); absent: written as given (a person's Save). */
  sign?: (inbound: InboundMessage, body: string) => Promise<Signed>;
  /** P65 S5: the write is recorded before Mail is asked, so a late save is adopted. Absent: not recorded. */
  log?: WriteLog;
}

const quietly = async <T>(p: () => Promise<T>): Promise<T | null> => {
  try {
    return await p();
  } catch {
    return null;
  }
};

/** One write through the writer, recorded in `log` first (P65 S5): a `mail_slow` write keeps its open row, with the shell's hash. */
export async function writeRecorded(writer: DraftWriter, input: ReplyDraftInput | ({ kind: "new" } & NewDraftInput), log?: WriteLog): Promise<ReplyDraftResult> {
  const id = log ? await quietly(() => log.start(writtenBody(input.body))) : null;
  try {
    const r = "kind" in input ? await newOf(writer)(input) : await writer.writeReply(input);
    if (log && id !== null) {
      await quietly(() => log.settle(id, { mailId: r.draftId, messageId: r.messageId }));
      if (r.shell) await quietly(() => log.shell(id, r.shell));
    }
    return r;
  } catch (e) {
    if (log && id !== null && e instanceof DraftWriteError && e.shell) await quietly(() => log.shell(id, e.shell ?? ""));
    throw e;
  }
}

/** The writer's new-thread write, or the refusal when this writer has none. */
const newOf = (writer: DraftWriter) => (i: NewDraftInput): Promise<ReplyDraftResult> => {
  if (!writer.writeNew) throw new DraftWriteError("unavailable", "This Mail writer cannot write a new message.");
  return writer.writeNew(i);
};

/**
 * The thread's drafts that are the Hub's own late saves, not yet recorded (decision 0031 addendum point 2): read from
 * Mail (the project's accounts, In-Reply-To = `mailRef`), matched to the recorded versions and the open writes by the
 * hash of their text. Read-only; the caller records them (`adopted`).
 */
export async function lateSaves(writer: DraftWriter, q: { accounts: readonly string[]; mailRef: string; subject: string | null; versions: readonly Pick<MailVersionRow, "account" | "messageId" | "hash">[]; writes: readonly MailWriteRow[] }): Promise<Adoption<ThreadMailDraft>[]> {
  if (q.writes.length === 0 && q.versions.length === 0) return [];
  const drafts = await writer.threadDrafts(q.accounts, q.mailRef, q.subject);
  const found = adoptable(drafts, q.versions, q.writes);
  // Left unmatched: one more read, of the answered message, so Mail's empty reply in the thread is recognised (P65 S5).
  const left = drafts.filter((d) => !found.some((a) => a.draft === d) && !q.versions.some((v) => v.account.trim().toLowerCase() === (d.account ?? "").trim().toLowerCase() && v.messageId.trim().replace(/^<|>$/g, "").toLowerCase() === (d.messageId ?? "").toLowerCase()));
  if (left.length === 0) return found;
  const m = await writer.findInbound(q.accounts, q.mailRef).catch(() => null);
  const original = m ? await writer.readContent(m).catch(() => null) : null;
  return original ? adoptable(drafts, q.versions, q.writes, original) : found;
}

/**
 * The From of a reply to `inbound` (P58 `replyFrom`): the address the client wrote to when the receiving account can send
 * as it, else the receiving account, else `mail.sender`. The receiving account's addresses come from the lookup that found
 * the message, else one read of the account (`addressesOf`); a failed read leaves the account name alone.
 */
export async function fromFor(writer: DraftWriter, inbound: InboundMessage, clientWroteTo: string | null, mail: { accounts: readonly string[]; sender: string | null }, displayName?: string | null): Promise<ReplyFrom> {
  const addresses = inbound.accountAddresses ?? (await writer.addressesOf(inbound.account).catch(() => []));
  return replyFrom({ account: inbound.account, accountAddresses: addresses, clientWroteTo, displayName }, { mail: { accounts: [...mail.accounts], sender: mail.sender } });
}

/**
 * The one revision of a hub draft (P56): find the message it answers by its Message-ID in the project's accounts, then
 * write the reply through the writer, which moves the older recorded versions to Trash, each in its own account. Shared
 * by `hub mcp`'s `draft_write {draft}` (the agent, `quote: "add"`), the server (a person's Save or Restore, `quote:
 * "keep"`), so there is one path. The caller records the new version (`mail_versions`) in the
 * account Mail saved it in (`savedIn`: the From's account, P65 S5).
 */
export async function reviseDraft(writer: DraftWriter, i: ReviseInput): Promise<Revision> {
  if (i.newThread) {
    // P85b: a new thread answers nothing: the revision is a new message to the same client, replacing the recorded versions.
    const n = i.newThread;
    const r = await writeRecorded(writer, { kind: "new", account: n.account, sender: n.from, to: n.to, subject: n.subject, body: i.body, replace: i.versions, landIn: i.accounts }, i.log);
    return { ...r, replyTo: 0, account: r.savedIn || n.account, fromReason: null, clientWroteTo: null };
  }
  if (!i.mailRef) throw new DraftWriteError("no_thread", "This draft answers no Mail message and is not a new thread, so it cannot be revised here. Nothing was written.");
  const found = await writer.findInbound(i.accounts, i.mailRef);
  if (!found) throw new DraftWriteError("no_message", `The message this draft answers (Message-ID ${i.mailRef}) is not in ${i.accounts.join(", ") || "this project's accounts"}: it may have been deleted. Nothing was written.`);
  const signed = i.sign ? await i.sign(found, i.body) : null;
  const rf = await fromFor(writer, found, signed ? signed.wroteTo : (i.clientWroteTo ?? null), i, i.displayName);
  const { accountAddresses: _addresses, ...where } = found;
  const r = await writeRecorded(writer, { ...where, body: signed?.body ?? i.body, sender: rf.from, quote: i.quote, replace: i.versions, landIn: i.accounts }, i.log);
  const account = r.savedIn || found.account;
  const why = { fromReason: rf.fromReason, clientWroteTo: rf.clientWroteTo };
  if (!signed) return { ...r, replyTo: found.messageId, account, ...why };
  const { body: _body, ...how } = signed;
  return { ...r, replyTo: found.messageId, account, ...how, ...why };
}

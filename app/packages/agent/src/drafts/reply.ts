import { displayNameFor } from "@hub/projects/brand";
import { DraftWriteError, fromFor, writeLogOf, writeRecorded, type Revision } from "../mail";
import { ToolError } from "../mcp/result";
import { adoptLate } from "./adopt";
import { landingWrite, pendingVersion } from "./guards";
import type { DraftScope, Pending, Written } from "./sign";

export interface ReplyArgs {
  account: string;
  mailbox_path: string[];
  message_id: number;
  content: string;
  owner_request: string | undefined;
}

/** `draft_write` with account, mailbox_path and message_id: a new reply to one message of this project's Mail. */
export async function writeNewReply(s: DraftScope, a: ReplyArgs): Promise<Written | Pending> {
  const { ctx, slug, writer, mail, cfg } = s;
  const own = mail.accounts.find((x) => x.trim().toLowerCase() === a.account.trim().toLowerCase());
  if (!own) throw new ToolError("not_this_project", `Account "${a.account}" is not one of project ${slug}'s Mail accounts (${mail.accounts.join(", ") || "none listed in project.md"}).`);
  const inbound = { account: own, mailboxPath: a.mailbox_path, messageId: a.message_id };
  // P65 verdict 4: a rerun is idempotent through the record, not through Drafts. Asked before anything is written.
  // P87: a hub draft id passed as message_id (the walkthrough's first try) is named, with the field to use instead.
  const mailRef = await writer.messageIdOf(inbound).catch(async (e: unknown) => {
    if (!(e instanceof DraftWriteError) || e.code !== "no_message") throw e;
    const hub = await ctx.repos.drafts.get(a.message_id);
    const asDraft = hub && hub.project === slug ? ` ${a.message_id} is hub draft ${a.message_id} (${hub.status}) of this project: to revise it pass draft=${a.message_id} and content only;${hub.status === "sent" ? " it is sent, so for a new message reply to the newest message of its thread (ours in Sent) with owner_request;" : ""}` : "";
    throw new ToolError("wrong_message_id", `No message ${a.message_id} in ${a.mailbox_path.join("/")} of ${own}.${asDraft} message_id is mail-mcp's integer id of the message answered (the id find_messages or list_messages gives), never a hub draft id. Nothing was written.`);
  });
  const rows = await ctx.repos.drafts.byMailRef(slug, mailRef);
  const open = rows.find((x) => x.status === "ready" || x.status === "hold");
  if (open) throw new ToolError("already_drafted", `Draft ${open.id} already answers this message: revise it with draft=${open.id}. Nothing was written.`);
  // P85: the owner's own words ask for a new message; without them a finished draft is the skip of a rerun.
  if (rows[0] && !a.owner_request) throw new ToolError("already_drafted", `Draft ${rows[0].id} (${rows[0].status}) already answered this message: a rerun does not bring it back. Only when the owner asked in this session for a new message to this client: reply to the newest message of the thread (ours in Sent, or theirs) with owner_request = his words. Nothing was written.`);
  const thread = await ctx.repos.mailVersions.ofThread(slug, mailRef);
  await adoptLate(ctx, slug, null, mailRef, null, thread.filter((v) => v.draftId === null));
  const pending = await pendingVersion(s, mailRef);
  // P129 verdict 4: the hub's own unrecorded version of this reply is recorded by this call, not written twice.
  if (pending) return { pending: { mailId: pending.mailId, messageId: pending.messageId, account: pending.account }, mailRef };
  // P65 S5: the Hub's last write for this message may still be landing (Mail slow): a second one would be a duplicate.
  const landing = await landingWrite(s, mailRef);
  if (landing) throw new ToolError("mail_slow", `The hub's write for this message at ${landing.startedAt} has not shown in Mail yet (Mail is slow); it is adopted when it lands. Do not write it again now: tell the owner in one line; a later draft_write with the same record records it once it landed. Nothing was written.`);
  // P87 (B6): the message answered is our own sent mail when a hub draft of this project went out as it.
  const ours = a.owner_request ? await ctx.repos.drafts.bySentMessageId(slug, mailRef) : null;
  const ourThread = ours?.brand ? { brand: ours.brand, wroteTo: ours.wroteTo ?? null, draftId: ours.id } : undefined;
  const signed = s.sign ? await s.sign(inbound, a.content, ourThread) : null;
  // P58: From the address the client wrote to when the receiving account can send as it, else that account.
  const rf = await fromFor(writer, inbound, signed?.wroteTo ?? null, mail, displayNameFor(cfg, signed?.brand));
  const w = await writeRecorded(writer, { ...inbound, body: signed?.body ?? a.content, sender: rf.from, replace: [], landIn: mail.accounts }, ctx.env.withRepos ? writeLogOf(ctx.env.withRepos, slug, null, mailRef) : undefined);
  const savedIn = w.savedIn || own;
  const why = { fromReason: rf.fromReason, clientWroteTo: rf.clientWroteTo };
  let r: Revision;
  if (signed) {
    const { body: _body, ...how } = signed;
    r = { ...w, replyTo: a.message_id, account: savedIn, ...how, ...why };
  } else r = { ...w, replyTo: a.message_id, account: savedIn, ...why };
  return { r, mailRef, versionRows: [] };
}

import { z } from "zod";
import { afterWrite, draftWriteOutput } from "../../drafts/after-write";
import { refuseOwnSignoff } from "../../drafts/guards";
import { writeNewThread } from "../../drafts/new-thread";
import { writeNewReply } from "../../drafts/reply";
import { reviseHubDraft } from "../../drafts/revise";
import { draftScope, type Written } from "../../drafts/sign";
import { DraftWriteError } from "../../mail";
import { defineTool } from "../define";
import { isRefusalCode } from "../refusals";
import { ToolError } from "../result";

// P52 (decision 0030): the one Mail write of `hub mcp`, an unsent draft in Mail's Drafts with Mail in the background
// (`../../mail`, decision 0031: older versions replaced by the `mail_versions` record, never by a line in the text). No send.
// Every version it saves is recorded; a new reply to a message the project already has a draft for is refused
// (`already_drafted`, P65 verdict 4). The use cases live in `../../drafts/`, plain functions over the tool context.

export const draftWriteTool = defineTool({
  name: "draft_write",
  title: "Write or revise an unsent reply draft in Mail",
  description:
    "Saves an unsent draft in Mail's Drafts, Mail in the background; never sends. A revision of a hub draft: `draft` = its id and `content` (plus `reason` to change its \"Why this email\" line). A new reply: `account`, `mailbox_path`, `message_id` (mail-mcp's integer id of the message answered). A new thread to a client with no thread at all: `to`, `subject`, `content`, `owner_request` (`account`, `from`, `brand` optional). `content` is the body only, plain text: the hub signs it. `fromSeenByClient` is the From the client sees; `next` says how it is recorded.",
  input: z.object({
    draft: z.number().int().positive().optional().describe("Revise this hub draft (its id, as focus or draft_show gives it). Then leave account, mailbox_path and message_id out."),
    account: z.string().min(1).max(320).optional().describe("New reply: Mail account of the message answered, as mail-mcp names it."),
    mailbox_path: z.array(z.string().min(1).max(200)).min(1).max(8).optional().describe('New reply: mailbox path of that message, e.g. ["INBOX"].'),
    message_id: z.number().int().positive().optional().describe("New reply: mail-mcp's integer id of the message answered, never a hub draft id."),
    content: z.string().min(1).max(20_000).describe("The body, plain text, with no closing, sign-off, signature, team or brand line of your own in any language: the hub signs."),
    to: z.string().trim().email().max(320).optional().describe("New thread (P85b): the client's address from the project's Notion Clients or Leads; only for a client with no thread at all."),
    subject: z.string().trim().min(1).max(300).optional().describe("New thread: the subject of the new message."),
    from: z.string().trim().email().max(320).optional().describe("New thread: the project's own address to write from (a brand address); default mail.sender, else the account's own."),
    brand: z.string().trim().min(1).max(100).optional().describe("New thread (P97): the ## Brands row the message is signed as (a lead's Lead.Brand), whatever address it goes from."),
    reason: z.string().trim().min(1).max(500).optional().describe("Revision (P99): a new \"Why this email\" line, one short English sentence; omitted, the recorded one stays. In test mode never mention a test or the owner's address."),
    owner_request: z.string().trim().min(1).max(1000).optional().describe("The owner's own words from this session that asked for this message, verbatim (never yours): a new reply on his initiative (a client who has not answered, a sent draft) or a new thread."),
  }),
  output: draftWriteOutput,
  effect: "draft",
  refusals: ["unavailable", "not_found", "not_this_project", "own_signoff", "empty", "mail_not_running", "mail_not_allowed", "content_refused", "mail_slow", "already_sent", "draft_finished", "already_drafted", "no_recipient", "no_message", "no_account", "no_thread", "mail_error", "has_thread", "do_not_contact", "wrong_message_id", "not_a_client", "notion_unavailable", "owner_request_needed"],
  handler: async (ctx, { draft, account, mailbox_path, message_id, content, owner_request, to, subject, from: fromAddress, brand: brandName, reason }) => {
    const slug = ctx.project();
    if (!ctx.env.drafts || !ctx.env.projectMail) throw new ToolError("unavailable", "This hub MCP server cannot write drafts (no Mail writer).");
    const s = draftScope(ctx, slug, ctx.env.drafts, ctx.env.projectMail(slug));
    refuseOwnSignoff(s, content);
    if (reason !== undefined && draft === undefined) throw new ToolError("invalid", "reason is for a revision (draft = its id); a first draft's reason goes to record-draft. Nothing was written.");
    try {
      let w: Written;
      if (draft !== undefined) {
        if (account !== undefined || mailbox_path !== undefined || message_id !== undefined) throw new ToolError("invalid", "Give either draft (a revision) or account, mailbox_path and message_id (a new reply), not both.");
        w = await reviseHubDraft(s, draft, content);
      } else if (to !== undefined) {
        if (mailbox_path !== undefined || message_id !== undefined) throw new ToolError("invalid", "A new thread takes to, subject, content and owner_request (account and from optional), not mailbox_path or message_id.");
        w = await writeNewThread(s, { to, subject, content, owner_request, account, from: fromAddress, brand: brandName });
      } else {
        if (account === undefined || mailbox_path === undefined || message_id === undefined) throw new ToolError("invalid", "Give draft (a revision of a hub draft) or all of account, mailbox_path and message_id (a new reply).");
        w = await writeNewReply(s, { account, mailbox_path, message_id, content, owner_request });
      }
      return await afterWrite(s, w, { draft, content, to, owner_request, reason });
    } catch (e) {
      // A Mail script's own code is a registered refusal; one from outside the registry is Mail's error.
      if (e instanceof DraftWriteError) throw new ToolError(isRefusalCode(e.code) ? e.code : "mail_error", e.message);
      throw e;
    }
  },
});

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { afterWrite } from "../../drafts/after-write";
import { writeNewThread } from "../../drafts/new-thread";
import { writeNewReply } from "../../drafts/reply";
import { reviseHubDraft } from "../../drafts/revise";
import { refuseOwnSignoff } from "../../drafts/guards";
import { draftScope, type Written } from "../../drafts/sign";
import { DraftWriteError } from "../../mail";
import type { ToolCtx } from "../ports";
import { advised } from "../refusals";
import { DATA, run, ToolError } from "../result";

// P52 (decision 0030): the one Mail write of `hub mcp`, an unsent draft in Mail's Drafts with Mail in the background
// (`../../mail`, decision 0031: older versions replaced by the `mail_versions` record, never by a line in the text). No send.
// Every version it saves is recorded; a new reply to a message the project already has a draft for is refused
// (`already_drafted`, P65 verdict 4). The use cases live in `../../drafts/`, plain functions over the tool context.

export function registerDraftWrite(server: McpServer, ctx: ToolCtx): void {
  server.registerTool(
    "draft_write",
    {
      title: "Write or revise an unsent reply draft in Mail",
      description: `Saves an unsent reply to one message in Mail's Drafts, with Mail in the background (no window, no focus, no paste). Use it for every draft and every revision instead of mail-mcp create_reply. A revision of a hub draft: \`draft\` = its id and \`content\`, nothing else (the hub finds the message it answers from its mailRef), plus \`reason\` when the draft's "Why this email" line should change; a sent draft is refused with already_sent and a done or skipped one with draft_finished, before Mail is asked (a new message then is a new reply with owner_request). A new reply: \`account\`, \`mailbox_path\` and \`message_id\` of the message answered (message_id is mail-mcp's integer id, never a hub draft id). Give the reply body only, plain text: the hub adds nothing to the text but its sign-off and the brand's signature, so never end with your own closing, in any language ("Best regards", "С уважением", "С теплом и …,", "Viele Grüße"), nor a team, brand or personal name line ("Carapis team", "Команда Carapis"): that is refused with own_signoff, rewrite without it. A new reply to a message this project already has a draft for is refused with already_drafted: that is the skip of a rerun, not an error (revise that draft with \`draft\` = its id when the owner asks). To write to a client again on the owner's initiative (P85: the client has not answered, or our draft was sent): reply to the NEWEST message of the client's latest thread, ours (in Sent) or theirs, and pass \`owner_request\` = the owner's own words from this session, verbatim, never yours; then a message whose drafts are all finished gets a new one, and a reply to our own message goes to that message's recipients. mail_slow means Mail is slow: the write may still land and the hub adopts it as the draft's version; do not call draft_write again for that draft, tell the owner in one line, and never ask him to delete a Mail draft. A revision saves the new draft first, then moves the older version the hub recorded to Trash, so one version stays; the open admin card shows the new text within seconds. The result's fromSeenByClient is exactly the From the client sees (there is no hidden sender): the address they wrote to (clientWroteTo) when this project's Mail account can send as it, else the account that received the mail (the design for a brand address that forwards into it, not a fault); fromReason is set only when it fell back to mail.sender. A client with NO thread at all (P85b: we never wrote and they never wrote; search Mail by their address first): on the owner's words only, a NEW message with \`to\` = the client's address from the project's Notion Clients, \`subject\`, \`content\` and \`owner_request\` (no account, mailbox_path or message_id; \`account\` and \`from\` optional: one of the project's accounts and its own address, default mail.sender); refused with has_thread when the hub already wrote to them (reply to the newest message instead), do_not_contact when the client is marked so, and not_a_client when the address is neither a recorded client nor a row of the project's Notion Clients or Leads (checked by the hub, P87; a lead, P97: answer a Notion Leads row this way, to its reply address, with \`brand\` = its Lead.Brand so the message is signed as that brand; in test mode, draft.recipients test, the owner's test addresses of the allow_list pass without it, P92); record it with \`"newThread":true\` in place of mailRef. A first draft of a thread: then record it with \`hub record-draft --project <slug>\` and mailRef = the returned thread; a revision records itself. Only this project's Mail accounts. Never sends. ${DATA}`,
      inputSchema: z.object({
        draft: z.number().int().positive().optional().describe("Revise this hub draft (its id, as focus or draft_show gives it). Then leave account, mailbox_path and message_id out."),
        account: z.string().min(1).max(320).optional().describe("New reply: Mail account of the message answered, as mail-mcp names it."),
        mailbox_path: z.array(z.string().min(1).max(200)).min(1).max(8).optional().describe('New reply: mailbox path of that message, e.g. ["INBOX"].'),
        message_id: z.number().int().positive().optional().describe("New reply: mail-mcp's integer id of the message answered."),
        content: z.string().min(1).max(20_000).describe("The reply body, plain text, with no sign-off or signature of your own: the hub signs."),
        to: z.string().trim().email().max(320).optional().describe("New thread (P85b): the client's address, from the project's Notion Clients. Only for a client with no thread at all; needs owner_request and subject."),
        subject: z.string().trim().min(1).max(300).optional().describe("New thread: the subject of the new message."),
        from: z.string().trim().email().max(320).optional().describe("New thread: the project's own address to write from (a brand address); default mail.sender, else the account's own."),
        brand: z.string().trim().min(1).max(100).optional().describe("New thread (P97): the ## Brands row the message is signed as (a lead's Lead.Brand), whatever address it goes from; a name not in ## Brands is refused."),
        reason: z.string().trim().min(1).max(500).optional().describe("Revision (P99): a new \"Why this email\" line for the draft's record, one short English sentence on why the client gets this reply; omitted, the recorded reason stays. In test mode never mention a test or the owner's own address in it."),
        owner_request: z.string().trim().min(1).max(1000).optional().describe("New reply on the owner's initiative (P85): his own words from this session that asked for it, verbatim (never yours). Lets a message whose drafts are all finished get a new one; pass the same words to record-draft as ownerRequest."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ draft, account, mailbox_path, message_id, content, owner_request, to, subject, from: fromAddress, brand: brandName, reason }) =>
      run(advised(async () => {
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
          if (e instanceof DraftWriteError) throw new ToolError(e.code, e.message);
          throw e;
        }
      })),
  );
}

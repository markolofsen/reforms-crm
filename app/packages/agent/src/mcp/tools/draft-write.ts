import { z } from "zod";
import { afterWrite, draftWriteOutput, firstNext } from "../../drafts/after-write";
import { refuseOwnSignoff } from "../../drafts/guards";
import { writeNewThread } from "../../drafts/new-thread";
import { clientOfReply, ownerWordsOf, precheckRecord, recordFirst, replySubjectOf } from "../../drafts/record-step";
import { writeNewReply } from "../../drafts/reply";
import { reviseHubDraft } from "../../drafts/revise";
import { draftScope, type DraftScope, type Pending } from "../../drafts/sign";
import { DraftWriteError, type InboundMessage } from "@hub/mail-app/writer/types";
import { draftRecord } from "../../records/schema";
import { defineTool } from "../define";
import { isRefusalCode } from "../refusals";
import { ToolError } from "../result";

// P52 (decision 0030): the one Mail write of `hub mcp`, an unsent draft in Mail's Drafts with Mail in the background
// (`../../mail`, decision 0031: older versions replaced by the `mail_versions` record, never by a line in the text). No send.
// P129 A3 (verdicts 3, 4): one `kind` per use (revise, reply, new); a reply and a new thread carry their `record`, which the
// hub checks before Mail is asked and writes after (decision 0045 point 10: `hub record-draft` is gone). The input is one
// object with `kind` (an MCP tool's schema is an object); the handler parses it into the discriminated union below.

const content = z.string().min(1).max(20_000).describe("The body, plain text, with no closing, sign-off, signature, team or brand line of your own in any language: the hub signs.");
const ownerRequest = z.string().trim().min(1).max(1000).describe("The owner's words from this session that asked for it, exactly as he typed them (never yours): the hub finds them in the session log.");
const mailIds = z.object({ account: z.string().min(1).max(320), mailbox_path: z.array(z.string().min(1).max(200)).min(1).max(8), message_id: z.number().int().positive().describe("mail-mcp's integer id, never a hub draft id") }).strict();
const message = z.union([z.object({ inbound: z.number().int().positive().describe("the Hub's Inbox id (focus ref inbound:<id>)") }).strict(), mailIds]);

/** The three uses, exclusive: what the handler accepts. */
export const draftWriteCall = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("revise"), draft: z.number().int().positive(), content, reason: z.string().trim().min(1).max(500).optional(), owner_request: ownerRequest.optional() }).strict(),
  z.object({ kind: z.literal("reply"), message, content, owner_request: ownerRequest.optional(), record: draftRecord }).strict(),
  z.object({ kind: z.literal("new"), to: z.string().trim().email().max(320), subject: z.string().trim().min(1).max(300), content, owner_request: ownerRequest, account: z.string().min(1).max(320).optional(), from: z.string().trim().email().max(320).optional(), brand: z.string().trim().min(1).max(100).optional(), record: draftRecord }).strict(),
]);
export type DraftWriteCall = z.output<typeof draftWriteCall>;

export const draftWriteTool = defineTool({
  name: "draft_write",
  title: "Write or revise an unsent draft in Mail",
  description:
    "Saves an unsent draft in Mail's Drafts, Mail in the background, and records it; never sends. kind revise: `draft` (its id), `content`, optional `reason`. kind reply: `message` ({inbound} or mail-mcp's account, mailbox_path, message_id), `content`, `record`. kind new (a client with no thread): `to`, `subject`, `content`, `owner_request`, `record`. `content` is the body only: the hub signs. `owner_request`: his words as typed. `fromSeenByClient` is the From the client sees.",
  input: z.object({
    kind: z.enum(["revise", "reply", "new"]).describe("revise a hub draft, reply to one message, or a new thread"),
    draft: z.number().int().positive().optional().describe("revise: the hub draft's id (focus or draft_show)"),
    message: message.optional().describe("reply: the message answered"),
    to: z.string().optional().describe("new: the client's address (Notion Clients or Leads)"),
    subject: z.string().optional().describe("new: the subject"),
    account: z.string().optional().describe("new: the project's Mail account to write from (default the first)"),
    from: z.string().optional().describe("new: a project address to write from (default mail.sender)"),
    brand: z.string().optional().describe("new: the ## Brands row it is signed as"),
    content,
    reason: z.string().optional().describe("revise: a new \"Why this email\" line, one English sentence"),
    owner_request: ownerRequest.optional(),
    record: draftRecord.optional().describe("reply and new: the record of the draft (who, why, what you read)"),
  }),
  output: draftWriteOutput,
  effect: "draft",
  refusals: ["unavailable", "not_found", "not_this_project", "own_signoff", "empty", "mail_not_running", "mail_not_allowed", "content_refused", "mail_slow", "already_sent", "draft_finished", "already_drafted", "no_recipient", "no_message", "no_account", "no_thread", "mail_error", "has_thread", "do_not_contact", "wrong_message_id", "not_a_client", "notion_unavailable", "owner_request_needed", "owner_words_not_found", "record_invalid", "recipient_not_allowed", "context_refused", "busy", "record_failed"],
  handler: async (ctx, raw) => {
    const parsed = draftWriteCall.safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)));
    if (!parsed.success) throw new ToolError("invalid", `${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}. Nothing was written.`);
    const call = parsed.data;
    const slug = ctx.project();
    if (!ctx.env.drafts || !ctx.env.projectMail) throw new ToolError("unavailable", "This hub MCP server cannot write drafts (no Mail writer).");
    const s = draftScope(ctx, slug, ctx.env.drafts, ctx.env.projectMail(slug));
    refuseOwnSignoff(s, call.content);
    const ownerVerified = ownerWordsOf(s, call.owner_request);
    try {
      if (call.kind === "revise") return await afterWrite(s, await reviseHubDraft(s, call.draft, call.content), { draft: call.draft, content: call.content, to: undefined, owner_request: call.owner_request, reason: call.reason });
      if (call.kind === "new") {
        await precheckRecord(s, call.to, call.record);
        const w = await writeNewThread(s, { to: call.to, subject: call.subject, content: call.content, owner_request: call.owner_request, account: call.account, from: call.from, brand: call.brand });
        const first = () => recordFirst(s, { email: call.to.trim().toLowerCase(), subject: call.subject, mailRef: null }, { owner_request: call.owner_request, ownerVerified, record: call.record });
        return "pending" in w ? await adopted(s, w, first) : await afterWrite(s, w, { draft: undefined, content: call.content, to: call.to, owner_request: call.owner_request, reason: undefined }, first);
      }
      const inbound = await inboundOf(s, call.message);
      const email = await clientOfReply(s, inbound);
      await precheckRecord(s, email, call.record);
      const w = await writeNewReply(s, { account: inbound.account, mailbox_path: inbound.mailboxPath, message_id: inbound.messageId, content: call.content, owner_request: call.owner_request });
      const first = (subject: string, mailRef: string) => () => recordFirst(s, { email, subject, mailRef }, { owner_request: call.owner_request, ownerVerified, record: call.record });
      return "pending" in w ? await adopted(s, w, first(await replySubjectOf(s, inbound), w.mailRef)) : await afterWrite(s, w, { draft: undefined, content: call.content, to: undefined, owner_request: call.owner_request, reason: undefined }, first(w.r.subject, w.mailRef));
    } catch (e) {
      // A Mail script's own code is a registered refusal; one from outside the registry is Mail's error.
      if (e instanceof DraftWriteError) throw new ToolError(isRefusalCode(e.code) ? e.code : "mail_error", e.message);
      throw e;
    }
  },
});

/** The answered message in Mail: a Hub Inbox row resolved through Mail (bound project's accounts only), or mail-mcp's three ids. */
async function inboundOf(s: DraftScope, m: z.output<typeof message>): Promise<InboundMessage> {
  if (!("inbound" in m)) return { account: m.account, mailboxPath: m.mailbox_path, messageId: m.message_id };
  const row = await s.ctx.repos.inboundMail.get(s.slug, m.inbound);
  if (!row) throw new ToolError("not_found", `No message ${m.inbound} in project ${s.slug}'s Inbox.`);
  const found = await s.writer.findInbound(s.mail.accounts, row.messageId);
  if (!found) throw new ToolError("no_message", `Message ${m.inbound} (${row.messageId}) is no longer in this project's Mail. Nothing was written.`);
  return found;
}

/** P129 verdict 4: the hub's own saved, unrecorded version is recorded by this call (adoption); nothing is written to Mail. */
async function adopted(s: DraftScope, w: Pending, first: () => ReturnType<typeof recordFirst>) {
  const rec = await first();
  const out: z.input<typeof draftWriteOutput> = {
    draftId: w.pending.mailId,
    messageId: w.pending.messageId,
    subject: "",
    thread: w.mailRef,
    replaced: [],
    left: [],
    savedIn: w.pending.account,
    replyTo: 0,
    account: w.pending.account,
    fromSeenByClient: "",
    clientWroteTo: null,
    fromReason: null,
    brand: null,
    brandDisplayName: null,
    project: s.slug,
    sent: false,
    recorded: rec.recorded,
    record: { draftId: rec.draftId, action: rec.action, evidence: rec.evidence, warnings: rec.warnings, ...(rec.notice ? { notice: rec.notice } : {}) },
    adopted: true,
    live: true,
    next: firstNext(rec, " The hub recorded the draft it had already saved in Mail for this message; nothing new was written (draft_show shows its From)."),
  };
  return out;
}

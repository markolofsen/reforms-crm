import { z } from "zod";
import { afterWrite, draftWriteOutput, firstNext, type VersionBrand } from "../../drafts/after-write";
import { refuseOwnSignoff } from "../../drafts/guards";
import { writeNewThread } from "../../drafts/new-thread";
import { clientOfReply, ownerWordsOf, precheckRecord, recordFirst, replySubjectOf } from "../../drafts/record-step";
import { writeNewReply } from "../../drafts/reply";
import { reviseHubDraft } from "../../drafts/revise";
import { draftScope, type DraftScope, type Pending } from "../../drafts/sign";
import { DraftWriteError, type InboundMessage } from "@hub/mail-app/writer/types";
import { draftRecord, type DraftRecord } from "../../records/schema";
import { defineTool } from "../define";
import { isRefusalCode } from "../refusals";
import { ToolError } from "../result";
import { boundLead, ownFollowUpClient, type ToolCtx } from "../ports";
import { LEAD_PASS_SKILL, leadPassRequest } from "@hub/config/lead-pass";
import { displayNameFor } from "@hub/projects/brands";

// P52 (decision 0030): the one Mail write of `hub mcp`, an unsent draft in Mail's Drafts with Mail in the background
// (`../../mail`, decision 0031: older versions replaced by the `mail_versions` record, never by a line in the text). No send.
// P129 A3 (verdicts 3, 4): one `kind` per use (revise, reply, new); a reply and a new thread carry their `record`, which the
// hub checks before Mail is asked and writes after (decision 0045 point 10: `hub record-draft` is gone). The input is one
// object with `kind` (an MCP tool's schema is an object); the handler parses it into the discriminated union below.

const content = z.string().min(1).max(20_000).describe("The body, plain text, with no closing, sign-off, signature, team or brand line of your own in any language: the hub signs.");
const ownerRequest = z.string().trim().min(1).max(1000).describe("The owner's words from this session that asked for it, exactly as he typed them (never yours): the hub finds them in the session log.");
const mailIds = z.object({ account: z.string().min(1).max(320), mailbox_path: z.array(z.string().min(1).max(200)).min(1).max(8), message_id: z.number().int().positive().describe("mail-mcp's integer id, never a hub draft id") }).strict();
const message = z.union([z.object({ inbound: z.number().int().positive().describe("the Hub's Inbox id (focus ref inbound:<id>)") }).strict(), mailIds]);

/** The record as the SDK hands it over: already parsed by `input`'s `draftRecord` (its notion page normalized). */
/** P142: a follow-up nudge and its number (the sweep, or one the owner asked for). */
const followUp = z.object({ n: z.number().int().min(1).max(20) }).strict();
const parsedRecord = z.custom<DraftRecord>((v) => typeof v === "object" && v !== null, "record: the draft's record object");
/** The three uses, exclusive: what the handler accepts. */
export const draftWriteCall = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("revise"), draft: z.number().int().positive(), content, reason: z.string().trim().min(1).max(500).optional(), owner_request: ownerRequest.optional() }).strict(),
  z.object({ kind: z.literal("reply"), message, content, owner_request: ownerRequest.optional(), record: parsedRecord, follow_up: followUp.optional() }).strict(),
  z.object({ kind: z.literal("new"), to: z.string().trim().email().max(320), subject: z.string().trim().min(1).max(300), content, owner_request: ownerRequest, account: z.string().min(1).max(320).optional(), from: z.string().trim().email().max(320).optional(), brand: z.string().trim().min(1).max(100).optional(), record: parsedRecord, follow_up: followUp.optional() }).strict(),
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
    follow_up: followUp.optional().describe("reply and new: a follow-up nudge, {n}: which one (a reply to our own last message is the usual nudge)"),
  }),
  output: draftWriteOutput,
  effect: "draft",
  refusals: ["unavailable", "not_found", "not_this_project", "own_signoff", "empty", "mail_not_running", "mail_not_allowed", "content_refused", "mail_slow", "already_sent", "draft_finished", "already_drafted", "no_recipient", "no_message", "no_account", "no_thread", "mail_error", "has_thread", "do_not_contact", "wrong_message_id", "not_a_client", "notion_unavailable", "owner_request_needed", "owner_words_not_found", "record_invalid", "recipient_not_allowed", "busy", "record_failed", "followup_other_client", "lead_other"],
  handler: async (ctx, raw) => {
    // P147 verdict 5: a lead turn writes one new thread to its lead's reply address, with the server's owner_request (never the model's).
    const leadTurn = ctx.env.leadPage !== undefined ? await leadTurnOf(ctx, raw) : null;
    const given = leadTurn ? { ...raw, owner_request: leadTurn.ownerRequest } : raw;
    const parsed = draftWriteCall.safeParse(Object.fromEntries(Object.entries(given).filter(([, v]) => v !== undefined)));
    if (!parsed.success) throw new ToolError("invalid", `${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}. Nothing was written.`);
    const call = parsed.data;
    const slug = ctx.project();
    if (!ctx.env.drafts || !ctx.env.projectMail) throw new ToolError("unavailable", "This hub MCP server cannot write drafts (no Mail writer).");
    const s = draftScope(ctx, slug, ctx.env.drafts, ctx.env.projectMail(slug));
    refuseOwnSignoff(s, call.content);
    if (!leadTurn) ownerWordsOf(s, call.owner_request);
    try {
      if (call.kind === "revise" && s.ctx.env.followUpClient !== undefined) ownFollowUpClient(s.ctx.env, (await s.ctx.repos.drafts.get(call.draft))?.clientId);
      if (call.kind === "revise") return await afterWrite(s, await reviseHubDraft(s, call.draft, call.content), { draft: call.draft, content: call.content, to: undefined, owner_request: call.owner_request, reason: call.reason });
      if (call.kind === "new") {
        await ownClientEmail(s, call.to);
        const leadPass = leadTurn?.leadPass ?? (await dockLead(s, call.to, call.record.skill));
        await precheckRecord(s, call.to, call.record);
        const w = await writeNewThread(s, { to: call.to, subject: call.subject, content: call.content, owner_request: call.owner_request, account: call.account, from: call.from, brand: call.brand });
        const first = (v: VersionBrand) => recordFirst(s, { email: call.to.trim().toLowerCase(), subject: call.subject, mailRef: null }, { owner_request: call.owner_request, record: call.record, followUpN: call.follow_up?.n ?? null, leadPass }, v);
        return "pending" in w ? await adopted(s, w, first) : await afterWrite(s, w, { draft: undefined, content: call.content, to: call.to, owner_request: call.owner_request, reason: undefined }, first);
      }
      const inbound = await inboundOf(s, call.message);
      const email = await clientOfReply(s, inbound);
      await ownClientEmail(s, email);
      await precheckRecord(s, email, call.record);
      const w = await writeNewReply(s, { account: inbound.account, mailbox_path: inbound.mailboxPath, message_id: inbound.messageId, content: call.content, owner_request: call.owner_request });
      const first = (subject: string, mailRef: string) => (v: VersionBrand) => recordFirst(s, { email, subject, mailRef }, { owner_request: call.owner_request, record: call.record, followUpN: call.follow_up?.n ?? null }, v);
      return "pending" in w ? await adopted(s, w, first(await replySubjectOf(s, inbound), w.mailRef)) : await afterWrite(s, w, { draft: undefined, content: call.content, to: undefined, owner_request: call.owner_request, reason: undefined }, first(w.r.subject, w.mailRef));
    } catch (e) {
      // A Mail script's own code is a registered refusal; one from outside the registry is Mail's error.
      if (e instanceof DraftWriteError) throw new ToolError(isRefusalCode(e.code) ? e.code : "mail_error", e.message);
      throw e;
    }
  },
});

type LeadPassRef = { pageId: string; passId: number | null; day: string };

/** P147 verdict 5: a lead turn's call is a new thread to the lead's reply address; the record joins the turn's pass and batch. */
async function leadTurnOf(ctx: ToolCtx, raw: { kind: string; to?: string | undefined }): Promise<{ ownerRequest: string; leadPass: LeadPassRef }> {
  const slug = ctx.project();
  const lead = await boundLead(ctx, slug);
  if (raw.kind !== "new") throw new ToolError("lead_other", "This lead turn writes one draft: kind new, to the lead's reply address. Nothing was written.");
  if (!lead.email) throw new ToolError("lead_other", "This lead has no reply address (a phone or Telegram only): decide hand_over. Nothing was written.");
  if ((raw.to ?? "").trim().toLowerCase() !== lead.email) throw new ToolError("lead_other", `This lead turn writes only to ${lead.email}, the lead's reply address. Nothing was written.`);
  const day = ctx.now().toISOString().slice(0, 10);
  return { ownerRequest: leadPassRequest(day, lead.pageId), leadPass: { pageId: lead.pageId, passId: ctx.env.leadPass ?? null, day } };
}

/** P147: an attended pass's draft (record.skill lead-pass) to a lead not yet converted joins the day's lead batch too. */
async function dockLead(s: DraftScope, to: string, skill: string | null | undefined): Promise<LeadPassRef | null> {
  if (skill !== LEAD_PASS_SKILL) return null;
  const lead = await s.ctx.repos.leadPass.unconvertedLead(s.slug, to);
  return lead ? { pageId: lead.pageId, passId: null, day: s.ctx.now().toISOString().slice(0, 10) } : null;
}

/** Decision 0050 (P142 verdict 5): a sweep turn writes to its own client only. */
async function ownClientEmail(s: DraftScope, email: string): Promise<void> {
  if (s.ctx.env.followUpClient === undefined) return;
  ownFollowUpClient(s.ctx.env, await s.ctx.repos.clients.findByIdentity(s.slug, "email", email.trim().toLowerCase()));
}

/** The answered message in Mail: a Hub Inbox row resolved through Mail (bound project's accounts only), or mail-mcp's three ids. */
async function inboundOf(s: DraftScope, m: z.output<typeof message>): Promise<InboundMessage> {
  if (!("inbound" in m)) return { account: m.account, mailboxPath: m.mailbox_path, messageId: m.message_id };
  const row = await s.ctx.repos.inboundMail.get(s.slug, m.inbound);
  if (!row) throw new ToolError("not_found", `No message ${m.inbound} in project ${s.slug}'s Inbox.`);
  const found = await s.writer.findInbound(s.mail.accounts, row.messageId);
  if (!found) throw new ToolError("no_message", `Message ${m.inbound} (${row.messageId}) is no longer in this project's Mail. Nothing was written.`);
  return found;
}

/**
 * P129 verdict 4: the hub's own saved, unrecorded version is recorded by this call (adoption); nothing is written to Mail. P140 R3:
 * the record and the answer take the brand and the address the client wrote to from that version, never from another write.
 */
async function adopted(s: DraftScope, w: Pending, first: (v: VersionBrand) => ReturnType<typeof recordFirst>) {
  const version: VersionBrand = { brand: w.pending.brand, wroteTo: w.pending.wroteTo };
  const rec = await first(version);
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
    clientWroteTo: version.wroteTo,
    fromReason: null,
    brand: version.brand,
    brandDisplayName: displayNameFor(s.cfg, version.brand),
    project: s.slug,
    sent: false,
    recorded: rec.recorded,
    record: { draftId: rec.draftId, action: rec.action, warnings: rec.warnings, ...(rec.notice ? { notice: rec.notice } : {}) },
    adopted: true,
    live: true,
    next: firstNext(rec, " The hub recorded the draft it had already saved in Mail for this message; nothing new was written (draft_show shows its From)."),
  };
  return out;
}

import { checkDraftRecipients, readAllowList } from "@hub/projects/guard";
import { projectStore } from "@hub/projects/store";
import { headersFromText } from "@hub/projects/brands";
import { normalizeAddress } from "@hub/projects/parse";
import type { InboundMessage } from "@hub/mail-app/writer/types";
import { ToolError } from "../mcp/result";
import { addressesOf } from "../records/checks";
import { recordDraftCall, type DraftRecordOutcome } from "../records/draft";
import type { DraftRecord } from "../records/schema";
import { answeredRef } from "./reply";
import type { DraftScope } from "./sign";
import type { VersionBrand } from "./after-write";

// P129 verdict 4 (decision 0045 point 10): `draft_write` records the draft it wrote, so the agent writes no JSON into a
// shell. The record and the recipients are checked before Mail is asked; the write; then the record on a short write
// connection. A record that fails leaves the version pending: the same call again records it (adoption), never a second write.
// P129 verdict 7: the owner's words, when given, must be in this project's session log.

/** The refusal `owner_words_not_found` when the owner's words are given and not in this project's session log; nothing otherwise. */
export function ownerWordsOf(s: DraftScope, words: string | undefined): void {
  if (!words) return;
  const check = s.ctx.env.ownerWords;
  if (!check || check(s.slug, words)) return;
  throw new ToolError("owner_words_not_found", "owner_request is not in this session's log of the owner's prompts (the last 12 hours, compared without case and spacing): pass his words exactly as he typed them. Nothing was written.");
}

const ADDRESS = /[^\s,;<>"']+@[^\s,;<>"']+/g;

/** The client a reply goes to: the answered message's From, or (our own sent message answered) its first To or Cc that is not ours. */
export async function clientOfReply(s: DraftScope, inbound: InboundMessage): Promise<string> {
  const raw = await s.writer.readHeaders(inbound).catch(() => "");
  // No headers: the message may not exist (P87: a hub draft id passed as message_id); that refusal names the field to use.
  if (!raw.trim()) await answeredRef(s, inbound);
  const unfolded = raw.replace(/\r\n/g, "\n").replace(/\n[ \t]+/g, " ");
  const from = /^from:(.*)$/im.exec(unfolded)?.[1]?.match(ADDRESS)?.[0];
  if (from && !s.isOurs(from)) return normalizeAddress(from);
  const others = headersFromText(raw).filter((h) => h.name === "to" || h.name === "cc").flatMap((h) => h.addresses).find((a) => !s.isOurs(a));
  if (others) return normalizeAddress(others);
  throw new ToolError("no_recipient", "The message answered names no client: its From and To are this project's own addresses. Nothing was written.");
}

/** Checks the record and the recipients before Mail is asked (P99 S0): nothing is written to Mail when the record would fail. */
export async function precheckRecord(s: DraftScope, email: string, record: DraftRecord): Promise<void> {
  const env = s.ctx.env.records;
  if (!env) throw new ToolError("unavailable", "This hub MCP server cannot record drafts (no database to write). Nothing was written.");
  if (!env.projectsDir) return;
  const cfg = projectStore({ projects: env.projectsDir, ...(env.policyDir ? { stateProjects: env.policyDir } : {}) }).config(s.slug);
  const g = checkDraftRecipients(cfg, addressesOf(record.to ?? email, record.cc), env.configFile ? readAllowList(env.configFile) : []);
  if (!g.ok) throw new ToolError("recipient_not_allowed", `draft.recipients of ${s.slug} does not permit ${g.blocked.join(", ")}. Nothing was written.`, { blocked: g.blocked });
}

const REFUSAL_OF: Record<Exclude<DraftRecordOutcome, { ok: true }>["code"], "record_invalid" | "recipient_not_allowed" | "busy" | "record_failed"> = {
  record_invalid: "record_invalid",
  not_allowed: "recipient_not_allowed",
  busy: "busy",
  record_failed: "record_failed",
};

/**
 * Records the first draft of a thread (or adopts a pending one). A refusal says the draft is in Mail and how to finish. The brand
 * and the address the client wrote to are the version's (P140 R3): what the signer resolved for the text this record is for.
 */
export async function recordFirst(s: DraftScope, w: { email: string; subject: string; mailRef: string | null }, q: { owner_request: string | undefined; record: DraftRecord; followUpN?: number | null; leadPass?: { pageId: string; passId: number | null; day: string } | null }, v: VersionBrand): Promise<Extract<DraftRecordOutcome, { ok: true }>> {
  const env = s.ctx.env.records;
  if (!env) throw new ToolError("unavailable", "This hub MCP server cannot record drafts (no database to write).");
  const out = await recordDraftCall({ project: s.slug, email: w.email, subject: w.subject, mailRef: w.mailRef, ownerRequest: q.owner_request ?? null, record: q.record, brand: v.brand, wroteTo: v.wroteTo, ...(q.followUpN != null ? { followUpN: q.followUpN } : {}), ...(q.leadPass ? { leadPass: q.leadPass } : {}) }, env);
  if (out.ok) return out;
  throw new ToolError(REFUSAL_OF[out.code], `The draft is saved in Mail but not recorded: ${out.error}. Call draft_write once more with the record fixed: the hub records the saved draft, it does not write a second one.`, { ...(out.blocked ? { blocked: out.blocked } : {}), ...(out.warnings ? { warnings: out.warnings } : {}) });
}

/** The subject a reply to this message carries ("Re: <its subject>"), for the record of an adopted version. */
export async function replySubjectOf(s: DraftScope, inbound: InboundMessage): Promise<string> {
  const raw = (await s.writer.readHeaders(inbound).catch(() => "")).replace(/\r\n/g, "\n").replace(/\n[ \t]+/g, " ");
  const subject = /^subject:(.*)$/im.exec(raw)?.[1]?.trim() || "(no subject)";
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

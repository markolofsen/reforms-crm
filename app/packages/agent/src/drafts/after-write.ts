import { z } from "zod";
import { displayNameFor } from "@hub/projects/brands";
import { versionHashOf } from "@hub/db";
import type { DraftScope, Written } from "./sign";

// After a `draft_write` saved a draft: the live bump (P53), the version record (P65), the revision record in place, and
// the notes and next step the agent reads (P58, P60, P65 S2, P90).

/**
 * The excerpt a revision keeps (decision 0013 point 3: a preview, never the body): at most 240 characters, its line breaks
 * kept (a poem stays a poem on the card), cut at a word with "…" when longer. P65 S5: it was whitespace-collapsed and cut
 * mid-word ("С теплом и дру").
 */
export const excerptOf = (body: string): string => {
  const t = body.replace(/\r\n?/g, "\n").replace(/[ \t\u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (t.length <= 240) return t;
  const head = t.slice(0, 239);
  const at = Math.max(head.lastIndexOf(" "), head.lastIndexOf("\n"));
  return `${(at > 160 ? head.slice(0, at) : head).trimEnd()}…`;
};

/** What `draft_write` returns (P129 A2: registered as its output schema). */
export const draftWriteOutput = z.object({
  draftId: z.number().describe("Mail's id of the saved draft."),
  messageId: z.string(),
  subject: z.string(),
  thread: z.string().describe("The answered message's Message-ID: the mailRef to record."),
  replaced: z.array(z.string()),
  left: z.array(z.string()),
  savedIn: z.string(),
  replyTo: z.number(),
  account: z.string(),
  // P129 A5: session rules paragraph 11 (P58) moved here, beside the fields it explains.
  fromSeenByClient: z.string().describe("Exactly the From header the client gets; there is no hidden, technical or SMTP sender behind it."),
  clientWroteTo: z.string().nullable().describe("Our address the client wrote to, never the From. The reply goes from it when the account can send as it, else from the account that received the mail: the design, not a fault; never suggest a send-as setup."),
  fromReason: z.string().nullable().describe("Set only when the reply fell back to mail.sender: say so in your one line."),
  brand: z.string().nullable(),
  brandDisplayName: z.string().nullable(),
  brandReason: z.string().optional(),
  signature: z.enum(["signed", "placeholder", "none"]).optional(),
  signatureFallback: z.string().optional(),
  project: z.string(),
  sent: z.literal(false),
  draft: z.number().optional(),
  ownerRequest: z.string().optional(),
  newThread: z.literal(true).optional(),
  recorded: z.boolean(),
  /** P129 verdict 4: the record of a first draft (kind reply or new), written by this call. */
  record: z.object({ draftId: z.number(), action: z.string(), warnings: z.array(z.string()), notice: z.string().optional() }).optional(),
  /** The hub recorded the version it had already saved for this message instead of writing again. */
  adopted: z.literal(true).optional(),
  live: z.boolean(),
  warning: z.string().optional(),
  next: z.string(),
});

export interface WriteRequest {
  draft: number | undefined;
  content: string;
  to: string | undefined;
  owner_request: string | undefined;
  reason: string | undefined;
}

/** What the record step of a first draft returned (`./record-step.ts`). */
export interface FirstRecord {
  draftId: number;
  action: string;
  recorded: boolean;
  message?: string;
  warnings: string[];
  notice?: string;
}

/** P140 R3: what the signer resolved for the version a first record is written for; the record takes it from here only. */
export interface VersionBrand {
  brand: string | null;
  wroteTo: string | null;
}

/** The `next` of a first draft, from its record. */
export const firstNext = (f: FirstRecord, notes = ""): string =>
  f.recorded
    ? `Recorded: draft ${f.draftId} (${f.action}${f.warnings.length ? `, ${f.warnings.length} finding(s) on the card` : ""}). Tell the owner in one line what you wrote. Nothing was sent.${f.notice ? ` ${f.notice}.` : ""}${notes}`
    : `Saved in Mail but NOT recorded: ${f.message ?? "the hub refused the record"}. Tell the owner in one line; never say "recorded". Nothing was sent.${notes}`;

export async function afterWrite(s: DraftScope, { r, versionRows, mailRef }: Written, q: WriteRequest, first?: (v: VersionBrand) => Promise<FirstRecord>): Promise<z.input<typeof draftWriteOutput>> {
  const { ctx, slug, cfg } = s;
  const { env, repos } = ctx;
  const { draft, owner_request, to, reason } = q;
  let live = true;
  try {
    env.mailWritten?.(slug);
  } catch {
    live = false; // the draft is saved; only the open card's refresh is lost (it reads Mail again on focus)
  }
  // P65: the version is the Hub's record of what it wrote; the replaced ones are marked trashed.
  let versionError: string | null = null;
  const version: VersionBrand = { brand: r.brand ?? null, wroteTo: r.clientWroteTo ?? r.wroteTo ?? null };
  if (env.recordVersion) {
    const moved = new Set(r.replaced.map((x) => x.toLowerCase()));
    try {
      await env.recordVersion(slug, { draftId: draft ?? null, mailRef, account: r.account, mailId: r.draftId, messageId: r.messageId, hash: versionHashOf(r.text), signatureFallback: r.signatureFallback ?? null, ...version, trashed: versionRows.filter((v) => moved.has(v.messageId.toLowerCase())).map((v) => v.id) });
    } catch (e) {
      versionError = e instanceof Error ? e.message : String(e);
    }
  }
  const left = r.left.length ? ` Older hub version(s) ${r.left.join(", ")} are still in Drafts: Send names them until one is left; hub drafts sweep (dry run) lists them for the owner. Never ask the owner to delete a Mail draft.` : "";
  const signNote = r.signature === "placeholder" ? ` The draft ends with [Owner: signature for ...] (${r.brandReason}): hub send refuses it until the owner fills it in; say so in your one line.` : "";
  const langNote = r.signatureFallback ? ` The project has no sign-off or signature line for "${r.signatureFallback}", the reply's language: it was signed in English and the card shows the check signature_language; say so in your one line.` : "";
  const versionNote = versionError ? ` The hub could not record this Mail version (${versionError}): Skip and Done will not move it to Trash; say so in your one line.` : "";
  // A revision of a known hub draft is recorded here, in place; a first draft by its record (P129 verdict 4).
  let recorded: { draftId: number; action: string } | null = null;
  let recordError: string | null = null;
  if (draft !== undefined && env.recordRevision) {
    try {
      recorded = await env.recordRevision(slug, draft, { excerpt: excerptOf(q.content), wroteTo: r.clientWroteTo ?? r.wroteTo ?? null, brand: r.brand ?? null, ...(reason !== undefined ? { reason } : {}) });
    } catch (e) {
      recordError = e instanceof Error ? e.message : String(e);
    }
  }
  // P58: the From is exactly what the client sees; a From that is not the address they wrote to is said, with its reason.
  const fromNote = r.fromReason ? ` The client sees From ${r.from}, not ${r.clientWroteTo ?? "the address they wrote to"} (${r.fromReason}); say so in your one line.` : "";
  // P90: a revision of a draft whose thread someone else already answered succeeds, and says so.
  const team = draft !== undefined ? await repos.drafts.teamNotice(draft).catch(() => null) : null;
  const warning = team?.repliedElsewhere ? `${team.repliedElsewhere.by} already replied in this thread at ${team.repliedElsewhere.at} (not this Hub's mail): this draft may repeat or contradict it; say so in your one line.` : team?.teamSent ? `${team.teamSent.by} wrote to this client at ${team.teamSent.at} (Notion Last sent by): say so in your one line.` : null;
  const notes = `${fromNote}${signNote}${langNote}${versionNote}${left}${warning ? ` ${warning}` : ""}`;
  // P129 verdict 4: the first draft of a thread is recorded after Mail saved it; a refusal leaves the version pending for the same call again.
  const rec = draft === undefined && first ? await first(version) : undefined;
  const next = rec
    ? firstNext(rec, notes)
    : recorded
    ? `Recorded: draft ${recorded.draftId} updated in place (same id, mailRef, client and context; Checked is off because the text changed). Tell the owner in one line what you changed. Nothing was sent.${notes}`
    : `Saved in Mail but NOT recorded: the hub could not update draft ${draft ?? "(none)"} in place${recordError ? ` (${recordError})` : ""}. Tell the owner in one line that the new text is in Mail and the card still shows the old one; never say "recorded". Nothing was sent.${notes}`;
  // P58 live finding: unambiguous names for the agent. `fromSeenByClient` is Mail's own read of the saved draft's From.
  const { text: _text, shell: _shell, from, wroteTo: _wroteTo, ...shown } = r;
  return { ...shown, sent: false as const, fromSeenByClient: from, clientWroteTo: r.clientWroteTo, brand: r.brand ?? null, brandDisplayName: displayNameFor(cfg, r.brand), fromReason: r.fromReason, project: slug, ...(draft !== undefined ? { draft } : {}), ...(owner_request ? { ownerRequest: owner_request } : {}), ...(to !== undefined ? { newThread: true as const } : {}), recorded: recorded !== null || rec?.recorded === true, ...(rec ? { record: { draftId: rec.draftId, action: rec.action, warnings: rec.warnings, ...(rec.notice ? { notice: rec.notice } : {}) } } : {}), live, ...(warning ? { warning } : {}), next };
}

import { z } from "zod";
import { displayNameFor } from "@hub/projects/brand";
import { normalizeAddress } from "@hub/projects/parse";
import { versionHash } from "../mail";
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
  fromSeenByClient: z.string().describe("Exactly the From the client sees."),
  clientWroteTo: z.string().nullable(),
  fromReason: z.string().nullable(),
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

export async function afterWrite(s: DraftScope, { r, versionRows, mailRef }: Written, q: WriteRequest): Promise<z.input<typeof draftWriteOutput>> {
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
  if (env.recordVersion) {
    const moved = new Set(r.replaced.map((x) => x.toLowerCase()));
    try {
      await env.recordVersion(slug, { draftId: draft ?? null, mailRef, account: r.account, mailId: r.draftId, messageId: r.messageId, hash: versionHash(r.text), signatureFallback: r.signatureFallback ?? null, trashed: versionRows.filter((v) => moved.has(v.messageId.toLowerCase())).map((v) => v.id) });
    } catch (e) {
      versionError = e instanceof Error ? e.message : String(e);
    }
  }
  const left = r.left.length ? ` Older hub version(s) ${r.left.join(", ")} are still in Drafts: Send names them until one is left; hub drafts sweep (dry run) lists them for the owner. Never ask the owner to delete a Mail draft.` : "";
  const signNote = r.signature === "placeholder" ? ` The draft ends with [Owner: signature for ...] (${r.brandReason}): hub send refuses it until the owner fills it in; say so in your one line.` : "";
  const langNote = r.signatureFallback ? ` The project has no sign-off or signature line for "${r.signatureFallback}", the reply's language: it was signed in English and the card shows the check signature_language; say so in your one line.` : "";
  const versionNote = versionError ? ` The hub could not record this Mail version (${versionError}): Skip and Done will not move it to Trash; say so in your one line.` : "";
  // A revision of a known hub draft is recorded here, in place; only a first draft of a thread needs `record-draft`.
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
  const next = recorded
    ? `Recorded: draft ${recorded.draftId} updated in place (same id, mailRef, client and context; Checked is off because the text changed). Do not run record-draft. Tell the owner in one line what you changed. Nothing was sent.${notes}`
    : draft !== undefined
      ? `Saved in Mail but NOT recorded: the hub could not update draft ${draft} in place${recordError ? ` (${recordError})` : ""}. Record it once, one Bash call from the instance folder: \`echo '{"email":"<client>","subject":"${r.subject.replace(/["'\\]/g, "")}","mailRef":"${r.thread}","skill":"triage-mail","excerpt":"<first 240 chars of your reply>"}' | ./run.sh record-draft --project ${slug}\`; if it answers "recorded":false, nothing was recorded: tell the owner in one line that the new text is in Mail and the card still shows the old one, never "recorded". Nothing was sent.${notes}`
      : to !== undefined
        ? `Record it, one Bash call from the instance folder: \`echo '{"email":"${normalizeAddress(to)}","subject":"${r.subject.replace(/["'\\]/g, "")}","newThread":true,"skill":"bulk-drafts","ownerRequest":"${(owner_request ?? "").replace(/["'\\]/g, "")}","excerpt":"<first 240 chars of your message>","context":{"batchKey":"<one key for every client of this run>","batchTitle":"<short English title>",...}}' | ./run.sh record-draft --project ${slug}\` (JSON on stdin; a new thread has no mailRef; the records of one run share batchKey and are one batch in Drafts). Then tell the owner in one line who it goes to. Nothing was sent.${notes}`
        : `Record it, one Bash call from the instance folder: \`echo '{"email":"<client>","subject":"${r.subject.replace(/["'\\]/g, "")}","mailRef":"${r.thread}","skill":"${owner_request ? "bulk-drafts" : "triage-mail"}",${owner_request ? `"ownerRequest":"${owner_request.replace(/["'\\]/g, "")}",` : ""}"excerpt":"<first 240 chars of your reply>","context":{${owner_request ? `"batchKey":"<one key for every client of this run>","batchTitle":"<short English title>",` : ""}...}}' | ./run.sh record-draft --project ${slug}\` (JSON on stdin; skill ${owner_request ? "bulk-drafts" : "triage-mail step 5"}). Then tell the owner in one line what you changed. Nothing was sent.${notes}`;
  // P58 live finding: unambiguous names for the agent. `fromSeenByClient` is Mail's own read of the saved draft's From.
  const { text: _text, shell: _shell, from, wroteTo: _wroteTo, ...shown } = r;
  return { ...shown, sent: false as const, fromSeenByClient: from, clientWroteTo: r.clientWroteTo, brand: r.brand ?? null, brandDisplayName: displayNameFor(cfg, r.brand), fromReason: r.fromReason, project: slug, ...(draft !== undefined ? { draft } : {}), ...(owner_request ? { ownerRequest: owner_request } : {}), ...(to !== undefined ? { newThread: true as const } : {}), recorded: recorded !== null, live, ...(warning ? { warning } : {}), next };
}

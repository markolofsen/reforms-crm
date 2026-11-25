import { accountAddresses, isOwnAddress } from "@hub/projects/addresses";
import { brandForKey, headersFromText, replyLanguage, resolveBrand, signatureFor, signatureLines, signBody, type BrandResolution, type OwnSignoff } from "@hub/projects/brands";
import { normalizeAddress } from "@hub/projects/parse";
import type { DraftWriter, InboundMessage } from "@hub/mail-app/writer/types";
import type { Revision, Signed } from "../mail";
import { configOf, type ProjectMail, type ToolCtx } from "../mcp/ports";

// P60: the writer signs. What one `draft_write` call works with: the bound project, its writer, its Mail settings and
// the two signers (a reply by the answered message's headers, a new thread by the address it goes from or a named brand).

export interface DraftScope {
  ctx: ToolCtx;
  slug: string;
  writer: DraftWriter;
  mail: ProjectMail;
  cfg: ReturnType<typeof configOf>;
  /** Absent when the project has no identity: drafts are written unsigned. */
  sign?: (inbound: InboundMessage, body: string, thread?: { brand: string; wroteTo: string | null; draftId: number }) => Promise<Signed>;
  signFrom: (fromAddr: string, body: string, named?: string | null) => Signed;
  /** One of the project's own addresses or its sender. */
  isOurs: (address: string) => boolean;
}

/**
 * P129 verdict 4: a version of this thread the hub saved and has not recorded yet (the record failed or never ran). A repeat
 * of the call records it instead of writing a second one (adoption).
 */
export interface Pending {
  pending: { mailId: number; messageId: string; account: string; brand: string | null; wroteTo: string | null };
  mailRef: string;
}

/** What a branch of `draft_write` saved: the revision, the version rows it may have replaced, and its thread key. */
export interface Written {
  r: Revision;
  versionRows: Array<{ id: number; messageId: string }>;
  mailRef: string;
}

/** The Message-IDs a header block names in In-Reply-To and References (folded lines joined), bare and lower case. Pure. */
export function threadRefs(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.replace(/\r\n/g, "\n").replace(/\n[ \t]+/g, " ").split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0 || !["in-reply-to", "references"].includes(line.slice(0, i).trim().toLowerCase())) continue;
    for (const m of line.slice(i + 1).match(/<[^<>\s]+>/g) ?? []) out.push(m.slice(1, -1).toLowerCase());
  }
  return [...new Set(out)];
}

/** The address a header block's From names, lower case, or null. Pure. */
const fromOf = (raw: string): string | null => {
  const line = raw.replace(/\r\n/g, "\n").replace(/\n[ \t]+/g, " ").split("\n").find((l) => /^from\s*:/i.test(l));
  return line?.match(/[^\s<>,;:"'()[\]]+@[^\s<>,;:"'()[\]]+\.[^\s<>,;:"'()[\]]+/)?.[0]?.toLowerCase() ?? null;
};

export interface ThreadBrandLookups {
  /** The project's sent draft that went out as this Message-ID, with its brand. */
  bySent(ref: string): Promise<{ id: number; brand: string | null; wroteTo: string | null } | null>;
  /** The newest lead's Brand of this address, or null. */
  leadBrand(email: string): Promise<string | null>;
}

/**
 * P147 3m finding C: a reply's brand. First the thread's own: the newest of our sends it names (In-Reply-To, References) that
 * carried a brand; then the headers (`resolveBrand`) when the client wrote to a brand's own address; else the brand of the lead
 * this client came from; else the headers. The shared account's address (every brand's mail goes from it) never turns one
 * brand's thread into another's.
 */
export async function replyBrand(raw: string | null, cfg: Parameters<typeof resolveBrand>[1], look: ThreadBrandLookups): Promise<BrandResolution | null> {
  if (raw === null) return null;
  for (const ref of threadRefs(raw).reverse()) {
    const d = await look.bySent(ref).catch(() => null);
    const row = d?.brand ? brandForKey(cfg.brands, d.brand) : null;
    if (d && row) return { wroteTo: d.wroteTo, brand: row.name, via: "address", reason: `the thread's earlier send (draft ${d.id}) was ${row.name}'s` };
  }
  const headers = resolveBrand(headersFromText(raw), cfg);
  const from = fromOf(raw);
  // A brand's own address the client wrote to is precise; the shared account's address (or none) says nothing about the brand.
  const shared = headers.brand === null || (headers.wroteTo !== null && accountAddresses(cfg.mail).has(headers.wroteTo));
  const lead = shared && from && !isOwnAddress(from, cfg.mail) ? await look.leadBrand(from).catch(() => null) : null;
  const row = lead ? brandForKey(cfg.brands, lead) : null;
  if (row) return { wroteTo: headers.wroteTo, brand: row.name, via: "address", reason: `the lead of ${from} came in for ${row.name}` };
  return headers;
}

/**
 * P155 trap 1: the brand `draft_write` will sign a reply to this message with, for a reader (`message_show`) to hand over the
 * same brand's booking link: our own sent message's brand (P87), else {@link replyBrand}.
 */
export async function threadBrand(ctx: Pick<ToolCtx, "repos">, slug: string, raw: string | null, cfg: Parameters<typeof resolveBrand>[1], messageId: string | null): Promise<BrandResolution | null> {
  const ours = messageId ? await ctx.repos.drafts.bySentMessageId(slug, messageId).catch(() => null) : null;
  const row = ours?.brand ? brandForKey(cfg.brands, ours.brand) : null;
  if (ours && row) return { wroteTo: ours.wroteTo ?? null, brand: row.name, via: "address", reason: `the thread's earlier draft ${ours.id} was ${row.name}'s` };
  return replyBrand(raw, cfg, { bySent: (ref) => ctx.repos.drafts.bySentMessageId(slug, ref), leadBrand: async (email) => (await ctx.repos.leadRows.ofEmail(slug, email)).find((l) => l.brand)?.brand ?? null });
}

/** P147 3f G2: `own` is the agent's sign-off and team line in the client's language, used only where the project has none in it. */
export function draftScope(ctx: ToolCtx, slug: string, writer: DraftWriter, mail: ProjectMail, own?: OwnSignoff | null): DraftScope {
  const cfg = configOf(mail);
  // The brand comes from the answered message's headers; an unreadable header block in a project with brands gives the
  // placeholder, never another brand's lines. P65 S2: in the reply's language.
  // P87 (B6): a reply to our own sent message keeps the brand that message carried (the thread's), not the account's.
  const sign = mail.identity
    ? async (inbound: InboundMessage, body: string, thread?: { brand: string; wroteTo: string | null; draftId: number }): Promise<Signed> => {
        const raw = await writer.readHeaders(inbound).catch(() => null);
        const r = thread
          ? { wroteTo: thread.wroteTo, brand: thread.brand, via: "address" as const, reason: `the thread's earlier draft ${thread.draftId} was ${thread.brand}'s` }
          : await replyBrand(raw, cfg, {
              bySent: (ref) => ctx.repos.drafts.bySentMessageId(slug, ref),
              leadBrand: async (email) => (await ctx.repos.leadRows.ofEmail(slug, email)).find((l) => l.brand)?.brand ?? null,
            });
        const block = signatureFor(cfg, r, replyLanguage(body), own);
        return { body: signBody(body, block, signatureLines(cfg)), wroteTo: r?.wroteTo ?? null, brand: r?.brand ?? null, brandReason: r?.reason ?? "the message's headers could not be read", signature: block.placeholder ? "placeholder" : block.lines.length ? "signed" : "none", ...(block.fallback ? { signatureFallback: block.fallback } : {}) };
      }
    : undefined;
  // P85b: a new thread has no answered message: its brand is the one of the address it goes from. P97 S3: or the brand named
  // (a lead's Lead.Brand): on saas every brand's mail goes from hello@reforms.ai, so the From cannot tell Carapis from Reforms.
  const signFrom = (fromAddr: string, body: string, named?: string | null): Signed => {
    const row = named ? cfg.brands.find((b) => b.name.toLowerCase() === named.toLowerCase()) : undefined;
    const res = row ? { wroteTo: null, brand: row.name, via: "address" as const, reason: `the brand ${row.name} was named for this message` } : resolveBrand(headersFromText(`From: ${fromAddr}`), cfg);
    const block = signatureFor(cfg, res, replyLanguage(body), own);
    return { body: mail.identity ? signBody(body, block, signatureLines(cfg)) : body, wroteTo: null, brand: res.brand, brandReason: res.reason, signature: !mail.identity ? "none" : block.placeholder ? "placeholder" : block.lines.length ? "signed" : "none", ...(block.fallback ? { signatureFallback: block.fallback } : {}) };
  };
  const isOurs = (a: string) => isOwnAddress(a, cfg.mail) || (!!mail.sender && normalizeAddress(a) === normalizeAddress(mail.sender));
  return { ctx, slug, writer, mail, cfg, ...(sign ? { sign } : {}), signFrom, isOurs };
}

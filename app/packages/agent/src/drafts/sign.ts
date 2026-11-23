import { isOwnAddress } from "@hub/projects/addresses";
import { headersFromText, replyLanguage, resolveBrand, signatureFor, signatureLines, signBody } from "@hub/projects/brands";
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
  pending: { mailId: number; messageId: string; account: string };
  mailRef: string;
}

/** What a branch of `draft_write` saved: the revision, the version rows it may have replaced, and its thread key. */
export interface Written {
  r: Revision;
  versionRows: Array<{ id: number; messageId: string }>;
  mailRef: string;
}

export function draftScope(ctx: ToolCtx, slug: string, writer: DraftWriter, mail: ProjectMail): DraftScope {
  const cfg = configOf(mail);
  // The brand comes from the answered message's headers; an unreadable header block in a project with brands gives the
  // placeholder, never another brand's lines. P65 S2: in the reply's language.
  // P87 (B6): a reply to our own sent message keeps the brand that message carried (the thread's), not the account's.
  const sign = mail.identity
    ? async (inbound: InboundMessage, body: string, thread?: { brand: string; wroteTo: string | null; draftId: number }): Promise<Signed> => {
        const raw = await writer.readHeaders(inbound).catch(() => null);
        const r = thread ? { wroteTo: thread.wroteTo, brand: thread.brand, via: "address" as const, reason: `the thread's earlier draft ${thread.draftId} was ${thread.brand}'s` } : raw === null ? null : resolveBrand(headersFromText(raw), cfg);
        const block = signatureFor(cfg, r, replyLanguage(body));
        return { body: signBody(body, block, signatureLines(cfg)), wroteTo: r?.wroteTo ?? null, brand: r?.brand ?? null, brandReason: r?.reason ?? "the message's headers could not be read", signature: block.placeholder ? "placeholder" : block.lines.length ? "signed" : "none", ...(block.fallback ? { signatureFallback: block.fallback } : {}) };
      }
    : undefined;
  // P85b: a new thread has no answered message: its brand is the one of the address it goes from. P97 S3: or the brand named
  // (a lead's Lead.Brand): on saas every brand's mail goes from hello@reforms.ai, so the From cannot tell Carapis from Reforms.
  const signFrom = (fromAddr: string, body: string, named?: string | null): Signed => {
    const row = named ? cfg.brands.find((b) => b.name.toLowerCase() === named.toLowerCase()) : undefined;
    const res = row ? { wroteTo: null, brand: row.name, via: "address" as const, reason: `the brand ${row.name} was named for this message` } : resolveBrand(headersFromText(`From: ${fromAddr}`), cfg);
    const block = signatureFor(cfg, res, replyLanguage(body));
    return { body: mail.identity ? signBody(body, block, signatureLines(cfg)) : body, wroteTo: null, brand: res.brand, brandReason: res.reason, signature: !mail.identity ? "none" : block.placeholder ? "placeholder" : block.lines.length ? "signed" : "none", ...(block.fallback ? { signatureFallback: block.fallback } : {}) };
  };
  const isOurs = (a: string) => isOwnAddress(a, cfg.mail) || (!!mail.sender && normalizeAddress(a) === normalizeAddress(mail.sender));
  return { ctx, slug, writer, mail, cfg, ...(sign ? { sign } : {}), signFrom, isOurs };
}

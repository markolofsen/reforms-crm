// P110, P126 P1: what the Mail composer shows for a conversation: the brand options, the From and the signature.
import { replyLanguage, type ReplyLanguage } from "@hub/contract/language";
import type { Brand, ProjectConfig } from "../schema";
import { EMAIL, normalizeAddress } from "../values";
import { displayNameFor, replyFrom } from "./from";
import { brandResolutionFor, type BrandResolution } from "./resolve";
import { signatureFor } from "./signature";

export const MAIL_COMPOSER_STATUSES = ["resolved", "needs_brand", "needs_mail", "missing_signature"] as const;
export type MailComposerStatus = (typeof MAIL_COMPOSER_STATUSES)[number];

export interface MailComposerContext {
  brand: string | null;
  wroteTo: string | null;
  from: string | null;
  technicalAddress: string | null;
  language: ReplyLanguage;
  signatureLines: string[];
  signatureFallback: ReplyLanguage | null;
  signatureLinesByLanguage: Record<ReplyLanguage, string[]>;
  signatureFallbackByLanguage: Record<ReplyLanguage, ReplyLanguage | null>;
  status: MailComposerStatus;
  reason: string | null;
  brands: MailComposerBrandOption[];
}

export interface MailComposerBrandOption {
  name: string;
  wroteTo: string | null;
  from: string | null;
  technicalAddress: string | null;
  signatureLines: string[];
  signatureFallback: ReplyLanguage | null;
  signatureLinesByLanguage: Record<ReplyLanguage, string[]>;
  signatureFallbackByLanguage: Record<ReplyLanguage, ReplyLanguage | null>;
  status: "ready" | "missing_signature";
}

const technicalAddressOf = (from: string | null): string | null => {
  if (!from) return null;
  const named = /<([^>]+)>/.exec(from)?.[1];
  const address = named ?? from;
  return EMAIL.test(address) ? normalizeAddress(address) : null;
};

function brandOptions(c: { mail: Pick<ProjectConfig["mail"], "accounts" | "sender">; brands: readonly Brand[]; signoff: string; languages: readonly string[] }, q: { account: string; accountAddresses: readonly string[] }, body: string): MailComposerBrandOption[] {
  const language = body.trim() ? replyLanguage(body) : defaultReplyLanguage(c.languages);
  return c.brands.map((brand) => {
    const resolution = brandResolutionFor(c.brands, brand.name);
    const reply = replyFrom({ account: q.account, accountAddresses: q.accountAddresses, clientWroteTo: resolution?.wroteTo ?? null, displayName: displayNameFor(c, brand.name) }, { mail: c.mail });
    const block = signatureFor(c, resolution, language);
    const variants = signatureVariants(c, resolution);
    return {
      name: brand.name,
      wroteTo: resolution?.wroteTo ?? null,
      from: reply.from,
      technicalAddress: technicalAddressOf(reply.from),
      signatureLines: block.lines,
      signatureFallback: block.fallback ?? null,
      ...variants,
      status: block.placeholder ? "missing_signature" : "ready",
    };
  });
}

const defaultReplyLanguage = (languages: readonly string[]): ReplyLanguage => {
  const configured = languages.map((language) => language.trim().toLowerCase().split("-")[0]).find((language) => language === "en" || language === "ru");
  return configured === "ru" ? "ru" : "en";
};

function signatureVariants(c: { signoff: string; brands: readonly Brand[]; languages: readonly string[] }, resolution: BrandResolution | null): Pick<MailComposerBrandOption, "signatureLinesByLanguage" | "signatureFallbackByLanguage"> {
  const en = signatureFor(c, resolution, "en");
  const ru = signatureFor(c, resolution, "ru");
  return {
    signatureLinesByLanguage: { en: en.lines, ru: ru.lines },
    signatureFallbackByLanguage: { en: en.fallback ?? null, ru: ru.fallback ?? null },
  };
}

/** The server-owned addressing and signature context shown by a manual Mail composer. */
export function mailComposerContext(c: { mail: Pick<ProjectConfig["mail"], "accounts" | "sender">; brands: readonly Brand[]; signoff: string; languages: readonly string[] }, q: { account: string; accountAddresses: readonly string[]; resolution: BrandResolution | null }, body = ""): MailComposerContext {
  const language = body.trim() ? replyLanguage(body) : defaultReplyLanguage(c.languages);
  const brands = brandOptions(c, q, body);
  const one = brands.length === 1 ? brands[0] : null;
  const oneWroteTo = q.resolution?.wroteTo ?? one?.wroteTo ?? null;
  const oneVia = q.resolution?.wroteTo ? q.resolution.via : one?.wroteTo ? "address" as const : "none" as const;
  const resolution = q.resolution?.brand || !one
    ? q.resolution
    : { brand: one.name, wroteTo: oneWroteTo, via: oneVia, reason: q.resolution?.reason ?? `the project has one configured brand: ${one.name}` };
  const brand = resolution?.brand ?? null;
  const reply = replyFrom({ account: q.account, accountAddresses: q.accountAddresses, clientWroteTo: resolution?.wroteTo ?? null, displayName: displayNameFor(c, brand) }, { mail: c.mail });
  const technicalAddress = reply.from ? (/<([^>]+)>/.exec(reply.from)?.[1] ?? (EMAIL.test(reply.from) ? normalizeAddress(reply.from) : null)) : null;
  const block = signatureFor(c, resolution, language);
  const variants = signatureVariants(c, resolution);
  let status: MailComposerStatus = "resolved";
  let reason: string | null = null;
  if (c.brands.length > 0 && brand === null) {
    status = "needs_brand";
    reason = resolution?.reason ?? "the conversation does not identify one brand";
  } else if (technicalAddress === null) {
    status = "needs_mail";
    reason = reply.fromReason ?? "Mail has no usable sending address";
  } else if (block.placeholder) {
    status = "missing_signature";
    reason = "the selected brand has no configured signature";
  }
  return {
    brand,
    wroteTo: resolution?.wroteTo ?? null,
    from: reply.from,
    technicalAddress,
    language,
    signatureLines: block.lines,
    signatureFallback: block.fallback ?? null,
    ...variants,
    status,
    reason,
    brands,
  };
}


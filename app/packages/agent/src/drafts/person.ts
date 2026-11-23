// P126 M3: how the owner's own text is signed and which brand it goes out under, for Save, Restore and his manual first
// reply. The agent signs from the message's headers (`sign.ts`); a person's text is signed from the recorded Mail context
// of the draft or the conversation. Pure: the caller reads Mail's headers and the recorded drafts.
import { brandResolutionFor, replyLanguage, signatureFor, signatureLines, signBody, type BrandResolution } from "@hub/projects/brand";
import type { Brand } from "@hub/projects/model";
import type { Signed } from "../mail";

export interface PersonMail {
  signoff: string;
  brands: readonly Brand[];
  languages: readonly string[];
}

/** Signs a person's text under the given resolution; `none` names why there is no brand context. Verbatim otherwise. */
export function signAsPerson(pm: PersonMail, resolution: Pick<BrandResolution, "brand" | "wroteTo" | "reason"> | null, none: string): (text: string) => Signed {
  return (text) => {
    const block = signatureFor(pm, resolution, replyLanguage(text));
    return {
      body: signBody(text, block, signatureLines(pm)),
      wroteTo: resolution?.wroteTo ?? null,
      brand: resolution?.brand ?? null,
      brandReason: resolution?.reason ?? none,
      signature: block.placeholder ? "placeholder" : block.lines.length ? "signed" : "none",
      ...(block.fallback ? { signatureFallback: block.fallback } : {}),
    };
  };
}

export interface PersonBrandInput {
  /** What Mail's headers of the message answered say, when they were read. */
  fromHeaders: BrandResolution | null;
  /** The brands of the conversation's recorded drafts, distinct. */
  recorded: readonly string[];
  /** The brand the owner chose in the composer, if any. */
  requested: string | null;
}

export type PersonBrand = { ok: true; resolution: BrandResolution | null; brand: string | null; wroteTo: string | null } | { ok: false; why: string };

/**
 * The brand of the owner's manual first reply: Mail's headers first, then the one recorded brand, then his choice, then
 * the project's only brand. A choice that is not a brand, or that contradicts the headers, is refused, and so is no brand
 * when the project has several.
 */
export function personBrand(brands: readonly Brand[], i: PersonBrandInput): PersonBrand {
  let resolution = i.fromHeaders;
  let wroteTo = resolution?.wroteTo ?? null;
  let brand = resolution?.brand ?? (i.recorded.length === 1 ? i.recorded[0] ?? null : null);
  const requested = i.requested;
  if (requested && !brands.some((b) => b.name.toLowerCase() === requested.toLowerCase())) return { ok: false, why: `The selected brand "${requested}" is not configured for this project.` };
  if (requested && resolution?.brand && resolution.brand.toLowerCase() !== requested.toLowerCase()) return { ok: false, why: `Mail identifies this conversation as ${resolution.brand}. Refresh the conversation before choosing a different brand.` };
  if (!resolution?.brand && brand) resolution = brandResolutionFor(brands, brand, resolution?.wroteTo ?? wroteTo);
  if (!resolution?.brand && requested) resolution = brandResolutionFor(brands, requested, resolution?.wroteTo ?? wroteTo);
  if (!resolution?.brand && brands.length === 1 && brands[0]) resolution = brandResolutionFor(brands, brands[0].name, resolution?.wroteTo ?? wroteTo);
  brand = resolution?.brand ?? brand;
  wroteTo = resolution?.wroteTo ?? wroteTo;
  if (brands.length > 1 && !brand) return { ok: false, why: "Choose a brand before saving this Mail draft." };
  return { ok: true, resolution, brand, wroteTo };
}

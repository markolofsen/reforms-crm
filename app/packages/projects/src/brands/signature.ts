// P60 B2, P126 P1: the signature block of a reply in its language, and the text it is added to.
import type { ReplyLanguage } from "@hub/contract/language";
import type { Brand } from "../schema";
import type { BrandResolution } from "./resolve";

/** One line, case- and space-folded, as the sign-off and signature checks compare them. */
export const norm = (l: string) => l.replace(/\s+/g, " ").trim().toLowerCase();


export interface SignatureBlock {
  /** The lines the writer appends after the body: the sign-off, then the brand's signature lines; or the placeholder. */
  lines: string[];
  /** True when the block is the `[Owner: signature for ...]` placeholder (`hub send` refuses it). */
  placeholder: boolean;
  /** P65 S2: the reply's language had no line of its own, so the English lines were used (the amber check `signature_language`). */
  fallback?: "en" | "ru";
}

const TAG = /^([a-z]{2}):\s*(.*)$/;

/** One configured line as its language variants: `en: Best regards, | ru: С уважением,` is two; an untagged part is for any language (`*`). */
export function lineVariants(line: string): Array<{ lang: string; text: string }> {
  return line
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = TAG.exec(p);
      return m ? { lang: m[1] as string, text: (m[2] as string).trim() } : { lang: "*", text: p };
    })
    .filter((v) => v.text !== "");
}

const primary = (l: string): string => l.trim().toLowerCase().split("-")[0] ?? "";

/**
 * The lines of a configured block for one language: untagged lines always, tagged ones of that language; none of it in
 * that language: English. `fallback` (the amber check `signature_language`) when the block is not in the reply's
 * language: no line is tagged for it, and either other lines are tagged (the owner wrote per language and skipped this
 * one) or the lines are untagged and the language is not among the project's `languages` (untagged lines are written
 * in the project's languages, so a Russian reply under `languages: en` is signed in English). P65 S2 live send check.
 */
function pick(lines: readonly string[], lang: ReplyLanguage, languages: readonly string[]): { lines: string[]; fallback: boolean } {
  const parts = lines.map(lineVariants);
  const tagged = parts.some((vs) => vs.some((v) => v.lang !== "*"));
  const has = (l: string) => parts.some((vs) => vs.some((v) => v.lang === l));
  const want = !tagged || has(lang) ? lang : "en";
  const out: string[] = [];
  for (const vs of parts) {
    const mine = vs.find((v) => v.lang === want) ?? vs.find((v) => v.lang === "*") ?? (want !== "en" ? undefined : vs.find((v) => v.lang === "en"));
    if (mine) out.push(mine.text);
  }
  const covered = has(lang) || (!tagged && languages.map(primary).includes(lang));
  return { lines: out, fallback: out.length > 0 && !covered };
}

/**
 * How a draft of this project ends (P60 verdict 2c). No `## Brands` table: `signoff` alone (nothing when it is empty).
 * A table: `signoff` plus the resolved brand's `Signature`; brand unresolved or its signature unanswered: the placeholder
 * `[Owner: signature for <wroteTo or "unknown brand">]`, never another brand's lines. P65 S2: lines may be tagged per
 * language (`en: Best regards, | ru: С уважением,`); the block is picked for `lang`, the reply's language, and falls
 * back to English (with `fallback`) when the project has no line for it: none tagged for it, and untagged lines only
 * when `lang` is among the project's `languages`.
 */
export function signatureFor(c: { signoff: string; brands: readonly Brand[]; languages: readonly string[] }, r: Pick<BrandResolution, "brand" | "wroteTo"> | null, lang: ReplyLanguage = "en"): SignatureBlock {
  const so = pick(c.signoff.trim() ? [c.signoff.trim()] : [], lang, c.languages);
  const withFallback = (b: SignatureBlock, fell: boolean): SignatureBlock => (fell ? { ...b, fallback: lang } : b);
  if (c.brands.length === 0) return withFallback({ lines: so.lines, placeholder: false }, so.fallback);
  const row = r?.brand ? c.brands.find((b) => b.name === r.brand) : undefined;
  if (!row || row.signature.length === 0) {
    const who = row ? row.name : (r?.wroteTo ?? "unknown brand");
    return withFallback({ lines: [...so.lines, `[Owner: signature for ${who}]`], placeholder: true }, so.fallback);
  }
  const sig = pick(row.signature, lang, c.languages);
  return withFallback({ lines: [...so.lines, ...sig.lines], placeholder: false }, so.fallback || sig.fallback);
}

/**
 * The body with the signature block appended once. A sign-off or signature the agent typed at the end anyway (the same
 * lines, any case or spacing), and a block the writer appended to an earlier version, are removed first, so a revision
 * is signed once.
 */
export function signBody(body: string, block: SignatureBlock, known: readonly string[] = []): string {
  const lines = body.replace(/\s+$/, "").split("\n");
  const strip = new Set([...block.lines, ...known].map(norm).filter(Boolean));
  const isPlaceholder = (l: string) => /^\[Owner: signature for [^\]]*\]$/i.test(l.trim());
  while (lines.length && (lines[lines.length - 1]?.trim() === "" || strip.has(norm(lines[lines.length - 1] ?? "")) || isPlaceholder(lines[lines.length - 1] ?? ""))) lines.pop();
  const text = lines.join("\n").replace(/\s+$/, "");
  return block.lines.length ? `${text}\n\n${block.lines.join("\n")}` : text;
}

/** Every line any brand of the project signs with (and the sign-off), every language variant: stripped before signing again and before comparing drafts. */
export const signatureLines = (c: { signoff: string; brands: readonly Brand[] }): string[] => [...new Set([c.signoff, ...c.brands.flatMap((b) => b.signature)].flatMap((l) => lineVariants(l).map((v) => v.text)).map((l) => l.trim()).filter(Boolean))];

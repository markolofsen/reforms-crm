"use client";

import { useState } from "react";
import type { MailComposerContextDto } from "@hub/contract/conversations";
import { replyLanguage } from "@hub/contract/language";

type Language = MailComposerContextDto["language"];
type BrandOption = MailComposerContextDto["brands"][number];

/** The signature the owner is asked to apply: the one the text should carry now, by brand and language. */
export type PendingSignature = { brand: string; language: Language; signatureLines: readonly string[]; signatureFallback: Language | null };

function normSignatureLine(line: string): string {
  return line.replace(/\s+/g, " ").trim().toLowerCase();
}

function withoutSignature(value: string, signatureLines: readonly string[]): string {
  const known = new Set(signatureLines.map(normSignatureLine).filter(Boolean));
  const lines = value.replace(/\s+$/, "").split("\n");
  while (lines.length > 0 && (lines.at(-1)?.trim() === "" || known.has(normSignatureLine(lines.at(-1) ?? "")))) lines.pop();
  return lines.join("\n").replace(/\s+$/, "");
}

function replaceSignature(value: string, previous: readonly string[], next: readonly string[]): string {
  const body = withoutSignature(value, previous);
  return body && next.length > 0 ? `${body}\n\n${next.join("\n")}` : next.join("\n");
}

const sameLines = (a: readonly string[], b: readonly string[]) => a.join("\n") === b.join("\n");

/**
 * The text of a manual Mail message and the signature it carries (P110). The brand is the one the conversation resolved, else
 * the owner's pick, else the project's only brand. The signature follows the brand and the language of what he wrote; while
 * he has written nothing it is replaced in place, once he has, a changed signature waits for his "Update … signature" (his
 * words are never rewritten silently). Everything but his text, his pick and the lines the text holds is derived, so no effect
 * copies state.
 */
export function useMailSignature(composer: MailComposerContextDto) {
  const [value, setValue] = useState(() => composer.signatureLines.join("\n"));
  // The signature lines the text holds now.
  const [applied, setApplied] = useState<readonly string[]>(composer.signatureLines);
  const [pickedBrand, setPickedBrand] = useState<string | null>(null);
  // A new composer context (another brand resolved, the project's signature edited) re-signs the text in this render.
  const contextKey = composer.signatureLines.join("\n");
  const [seenContextKey, setSeenContextKey] = useState(contextKey);
  if (seenContextKey !== contextKey) {
    setSeenContextKey(contextKey);
    if (!sameLines(applied, composer.signatureLines)) {
      setValue((previous) => replaceSignature(previous, applied, composer.signatureLines));
      setApplied(composer.signatureLines);
    }
  }
  const known = (name: string | null): name is string => name !== null && composer.brands.some((brand) => brand.name === name);
  const selectedBrand = known(composer.brand) ? composer.brand : known(pickedBrand) ? pickedBrand : composer.brands.length === 1 ? composer.brands[0]?.name ?? null : null;
  const selected = composer.brands.find((brand) => brand.name === selectedBrand) ?? null;
  const body = withoutSignature(value, applied).trim();
  const language = body ? replyLanguage(body) : composer.language;
  const signatureOf = (option: BrandOption | null, lang: Language) => option?.signatureLinesByLanguage[lang] ?? composer.signatureLinesByLanguage[lang];
  const signature = signatureOf(selected, language);
  const signatureFallback = selected?.signatureFallbackByLanguage[language] ?? composer.signatureFallbackByLanguage[language] ?? composer.signatureFallback;
  const brandSelectionRequired = composer.status === "needs_brand" && selected === null;
  const pending: PendingSignature | null = !body || brandSelectionRequired || sameLines(signature, applied) ? null : { brand: selected?.name ?? composer.brand ?? "selected brand", language, signatureFallback, signatureLines: signature };
  const chooseBrand = (name: string) => {
    const option = composer.brands.find((brand) => brand.name === name);
    if (!option) return;
    setPickedBrand(option.name);
    if (body) return;
    const next = signatureOf(option, language);
    setValue(replaceSignature(value, applied, next));
    setApplied(next);
  };
  const applyPending = () => {
    if (!pending) return;
    setValue((previous) => replaceSignature(previous, applied, pending.signatureLines));
    setApplied(pending.signatureLines);
  };
  return { value, setValue, selected, selectedBrand, chooseBrand, body, language, signature, signatureFallback, brandSelectionRequired, pending, applyPending };
}

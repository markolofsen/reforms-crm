// P60 B3, P126 P1: the knowledge axis: which brands an entry of the knowledge base belongs to.
import type { Brand } from "../schema";


/** The word that makes an entry shared by every brand of a `by-brand` project. */
export const ANY_BRAND = "ANY";

/**
 * Why an entry's `brands` cannot be indexed in this project, or null. Only a `knowledge.scope by-brand` project checks:
 * there every entry must list at least one brand, each a `## Brands` name (case-insensitive) or `ANY`. A `shared`
 * project ignores `brands`. The indexer, `knowledge check` and doctor all call this, so they agree.
 */
export function entryBrandProblem(brands: readonly string[] | undefined, c: { knowledge: { scope: string }; brands: readonly Brand[] }): string | null {
  if (c.knowledge.scope !== "by-brand") return null;
  if (!brands || brands.length === 0) return `no brands: in a knowledge.scope by-brand project every entry lists its brands (names of ## Brands rows, or ${ANY_BRAND} for a fact true for every brand)`;
  const names = new Set(c.brands.map((b) => b.name.toLowerCase()));
  const unknown = brands.filter((b) => b !== ANY_BRAND && !names.has(b.toLowerCase()));
  return unknown.length ? `unknown brand ${unknown.map((u) => `"${u}"`).join(", ")}: brands are ## Brands names (${c.brands.map((b) => b.name).join(", ") || "none"}) or ${ANY_BRAND}` : null;
}

/** The canonical names of an entry's brands (the table's spelling; `ANY` kept). */
export const canonicalBrands = (brands: readonly string[], all: readonly Brand[]): string[] => [...new Set(brands.map((b) => (b === ANY_BRAND ? b : (all.find((x) => x.name.toLowerCase() === b.toLowerCase())?.name ?? b))))];

/**
 * The `brands` of an entry's YAML front matter, read without a YAML library (doctor runs where `yaml` is not a
 * dependency): `brands: [A, B]`, `brands: A`, or a block list of `- A` lines. Undefined when the key is absent.
 */
export function frontMatterBrands(text: string): string[] | undefined {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return undefined;
  const lines = (m[1] ?? "").split(/\r?\n/);
  const i = lines.findIndex((l) => /^brands\s*:/.test(l));
  if (i < 0) return undefined;
  const unq = (s: string) => s.trim().replace(/^["']|["']$/g, "").trim();
  const rest = (lines[i] ?? "").replace(/^brands\s*:/, "").trim();
  if (rest.startsWith("[")) return rest.replace(/^\[|\]\s*$/g, "").split(",").map(unq).filter(Boolean);
  if (rest !== "") return rest.split("|").map(unq).filter(Boolean);
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    const item = /^\s*-\s+(.*)$/.exec(l);
    if (!item) break;
    out.push(unq(item[1] ?? ""));
  }
  return out.filter(Boolean);
}

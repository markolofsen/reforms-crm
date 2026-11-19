// Brands (P60, doc 16 sections 3 and 7): the `## Brands` table of project.md and the one resolver from an inbound's
// headers to the brand the client wrote to. Pure: no file, Mail or database access, so parse.ts and @hub/notion can
// import it, and the hub MCP server, the draft writer and doctor all call the same functions.
import type { Brand, ProjectConfig } from "./schema";
import { EMAIL, isIsoDate, normalizeAddress } from "./values";

export type BrandIssue = { severity: "error" | "warning"; code: "bad_table" | "duplicate_row" | "bad_value" | "bad_date" | "bad_by"; line: number; field: "brands"; message: string };

export const BRANDS_COLUMNS = ["brand", "receives at", "signature", "answered", "by"] as const;
export const BRANDS_HEADER = "| Brand | Receives at | Signature | Answered | By |";
const BYS = ["owner", "default", "agent"] as const;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i;
/** `<br>` (or `<br/>`, `<br />`) separates the lines of a Signature cell: a table cell holds one line. */
const BR = /<br\s*\/?>/i;

export const splitSignature = (cell: string): string[] => (cell.trim() === "" ? [] : cell.split(BR).map((l) => l.trim()).filter((l) => l !== ""));
export const joinSignature = (lines: readonly string[]): string => lines.map((l) => l.trim()).filter(Boolean).join("<br>");

/** The project's own Mail identity, as `resolveBrand` and the table check read it. */
type Own = Pick<ProjectConfig["mail"], "accounts" | "addresses" | "domains">;

const accountAddresses = (m: Own): Set<string> => new Set(m.accounts.filter((a) => EMAIL.test(a.trim())).map(normalizeAddress));
const domainOf = (a: string): string => a.slice(a.lastIndexOf("@") + 1);

/** Whether an address belongs to the project: one of its accounts, addresses or aliases, or on one of its domains. */
export function isOwnAddress(address: string, m: Own): boolean {
  const a = normalizeAddress(address);
  if (!EMAIL.test(a)) return false;
  return accountAddresses(m).has(a) || m.addresses.map(normalizeAddress).includes(a) || m.domains.includes(domainOf(a));
}

/**
 * Reads the rows of `## Brands` (header and data rows as `tableOf` returns them). Each `Receives at` entry must be the
 * project's own (an account, address or alias, or an address or domain on `mail.domains`); no entry may sit in two rows;
 * brand names are unique (case-insensitive). Issues carry the 1-based line.
 */
export function parseBrands(t: { header: string[] | null; headerIdx: number; rows: Array<{ cells: string[]; idx: number }> }, sectionLine: number, m: Own): { brands: Brand[]; issues: BrandIssue[] } {
  const issues: BrandIssue[] = [];
  const brands: Brand[] = [];
  const err = (line: number, code: BrandIssue["code"], message: string) => issues.push({ severity: "error", code, line, field: "brands", message });
  const header = t.header?.map((c) => c.toLowerCase());
  if (!header || header.length !== BRANDS_COLUMNS.length || header.some((c, i) => c !== BRANDS_COLUMNS[i])) {
    err(t.headerIdx >= 0 ? t.headerIdx + 1 : sectionLine, "bad_table", "## Brands needs a table with the columns Brand | Receives at | Signature | Answered | By");
    return { brands, issues };
  }
  const names = new Map<string, number>();
  const claimed = new Map<string, string>();
  for (const r of t.rows) {
    const line = r.idx + 1;
    if (r.cells.length !== BRANDS_COLUMNS.length) {
      err(line, "bad_table", `a Brands row has ${r.cells.length} cells, expected ${BRANDS_COLUMNS.length} (escape "|" in a value as "\\|")`);
      continue;
    }
    const [name, receives, signature, answered, by] = r.cells as [string, string, string, string, string];
    if (!name) {
      err(line, "bad_value", "a Brands row has no Brand name");
      continue;
    }
    const key = name.toLowerCase();
    if (names.has(key)) {
      err(line, "duplicate_row", `brand "${name}" is listed twice (first on line ${names.get(key)})`);
      continue;
    }
    names.set(key, line);
    const receivesAt: string[] = [];
    for (const raw of receives.split(",").map((s) => s.trim()).filter(Boolean)) {
      const isAddress = raw.includes("@");
      const v = isAddress ? normalizeAddress(raw) : raw.toLowerCase();
      if (isAddress ? !EMAIL.test(v) : !DOMAIN.test(v)) {
        err(line, "bad_value", `"${raw}" in brand ${name} is neither an address nor a domain`);
        continue;
      }
      if (isAddress ? !isOwnAddress(v, m) : !m.domains.includes(v)) {
        err(line, "bad_value", isAddress ? `${v} (brand ${name}) is not one of the project's accounts, addresses or aliases and is on none of its mail.domains` : `${v} (brand ${name}) is not on mail.domains`);
        continue;
      }
      const other = claimed.get(v);
      if (other && other !== name) {
        err(line, "bad_value", `${v} is listed by brand ${other} and brand ${name}: one address or domain belongs to one brand`);
        continue;
      }
      claimed.set(v, name);
      if (!receivesAt.includes(v)) receivesAt.push(v);
    }
    if (receivesAt.length === 0) err(line, "bad_value", `brand ${name} receives at nothing: list its addresses or domains`);
    if (!isIsoDate(answered)) err(line, "bad_date", `Answered "${answered}" of brand ${name} is not an ISO date (YYYY-MM-DD)`);
    if (!(BYS as readonly string[]).includes(by)) err(line, "bad_by", `By "${by}" of brand ${name} must be one of ${BYS.join(", ")}`);
    brands.push({ name, receivesAt, signature: splitSignature(signature), answered, by: (BYS as readonly string[]).includes(by) ? (by as Brand["by"]) : "owner" });
  }
  return { brands, issues };
}

// ---- the resolver ------------------------------------------------------------------------------------------------

/** One recipient header of the inbound, its addresses in the order they appear. */
export interface HeaderAddresses {
  name: string;
  addresses: string[];
}

/** The order the brand address is looked for in (doc 16 section 7): the forward's own headers first, `To` and `Cc` last. */
export const BRAND_HEADER_ORDER = ["x-gm-original-to", "x-original-to", "x-forwarded-for", "x-forwarded-to", "delivered-to", "to", "cc"] as const;

const ADDRESS = /[^\s<>,;:"'()[\]]+@[^\s<>,;:"'()[\]]+\.[^\s<>,;:"'()[\]]+/g;

/** Every address in a header value (`Name <a@b>, c@d`, or the space-separated `X-Forwarded-For`), normalised. */
export const addressesIn = (value: string): string[] => (value.match(ADDRESS) ?? []).map(normalizeAddress);

/**
 * The recipient headers of a raw header block (as Mail's `all headers` or mail-mcp's `allHeaders` give it): folded lines
 * joined, one entry per header line of a name in {@link BRAND_HEADER_ORDER}, in the order of the block.
 */
export function headersFromText(raw: string): HeaderAddresses[] {
  const out: HeaderAddresses[] = [];
  for (const line of raw.replace(/\r\n/g, "\n").replace(/\n[ \t]+/g, " ").split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    if ((BRAND_HEADER_ORDER as readonly string[]).includes(name)) out.push({ name, addresses: addressesIn(line.slice(i + 1)) });
  }
  return out;
}

export interface BrandResolution {
  /** The project's address the client wrote to, or null when no header names one. */
  wroteTo: string | null;
  /** The brand row it belongs to (its exact name), or null: never a default brand. */
  brand: string | null;
  via: "address" | "domain" | "none";
  reason: string;
}

/**
 * Which brand an inbound belongs to (P60 section 4.2). Step 1, `wroteTo`: walk the headers in {@link BRAND_HEADER_ORDER}
 * (each name's lines in order, each line's addresses in order); the first address that is the project's own and NOT one of
 * its account addresses wins; only if none, the first account address (a forward names the account in `Delivered-To`, so
 * reading it first would make every forwarded mail the account's). Step 2, `brand`: the row listing `wroteTo` exactly,
 * else the row listing its domain, else null with the reason. The From of a reply is not decided here (P58).
 */
export function resolveBrand(headers: readonly HeaderAddresses[], c: { mail: Own; brands: readonly Brand[] }): BrandResolution {
  const ordered: string[] = [];
  for (const name of BRAND_HEADER_ORDER) for (const h of headers) if (h.name.toLowerCase() === name) ordered.push(...h.addresses.map(normalizeAddress));
  const accounts = accountAddresses(c.mail);
  const own = ordered.filter((a) => isOwnAddress(a, c.mail));
  const wroteTo = own.find((a) => !accounts.has(a)) ?? own.find((a) => accounts.has(a)) ?? null;
  if (!wroteTo) return { wroteTo: null, brand: null, via: "none", reason: ordered.length ? `no recipient header names an address of this project (${[...new Set(ordered)].slice(0, 3).join(", ")})` : "the message has no recipient headers" };
  if (c.brands.length === 0) return { wroteTo, brand: null, via: "none", reason: "the project has no ## Brands table" };
  const exact = c.brands.find((b) => b.receivesAt.includes(wroteTo));
  if (exact) return { wroteTo, brand: exact.name, via: "address", reason: `${wroteTo} is listed by brand ${exact.name}` };
  const byDomain = c.brands.find((b) => b.receivesAt.includes(domainOf(wroteTo)));
  if (byDomain) return { wroteTo, brand: byDomain.name, via: "domain", reason: `${wroteTo} is on ${domainOf(wroteTo)}, a domain of brand ${byDomain.name}` };
  return { wroteTo, brand: null, via: "none", reason: `${wroteTo} is in no brand row` };
}

// ---- the signature -----------------------------------------------------------------------------------------------

export interface SignatureBlock {
  /** The lines the writer appends after the body: the sign-off, then the brand's signature lines; or the placeholder. */
  lines: string[];
  /** True when the block is the `[Owner: signature for ...]` placeholder (`hub send` refuses it). */
  placeholder: boolean;
}

/**
 * How a draft of this project ends (P60 verdict 2c). No `## Brands` table: `signoff` alone (nothing when it is empty).
 * A table: `signoff` plus the resolved brand's `Signature`; brand unresolved or its signature unanswered: the placeholder
 * `[Owner: signature for <wroteTo or "unknown brand">]`, never another brand's lines.
 */
export function signatureFor(c: { signoff: string; brands: readonly Brand[] }, r: Pick<BrandResolution, "brand" | "wroteTo"> | null): SignatureBlock {
  const signoff = c.signoff.trim();
  if (c.brands.length === 0) return { lines: signoff ? [signoff] : [], placeholder: false };
  const row = r?.brand ? c.brands.find((b) => b.name === r.brand) : undefined;
  if (!row || row.signature.length === 0) {
    const who = row ? row.name : (r?.wroteTo ?? "unknown brand");
    return { lines: [...(signoff ? [signoff] : []), `[Owner: signature for ${who}]`], placeholder: true };
  }
  return { lines: [...(signoff ? [signoff] : []), ...row.signature], placeholder: false };
}

const norm = (l: string) => l.replace(/\s+/g, " ").trim().toLowerCase();

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

/** Every line any brand of the project signs with (and the sign-off): stripped before signing again and before comparing drafts. */
export const signatureLines = (c: { signoff: string; brands: readonly Brand[] }): string[] => [...new Set([c.signoff, ...c.brands.flatMap((b) => b.signature)].map((l) => l.trim()).filter(Boolean))];

// ---- the knowledge axis (B3) ---------------------------------------------------------------------------------------

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

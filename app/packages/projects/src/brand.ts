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
  /** P65 S2: the reply's language had no line of its own, so the English lines were used (the amber check `signature_language`). */
  fallback?: string;
}

/** The languages a sign-off or signature line may be tagged with (`ru: С уважением,`). Untagged lines are for every language. */
export type ReplyLanguage = "en" | "ru";

/**
 * The reply's language, from its script (P65 S2, P60 finding 2): more than half of its letters Cyrillic is `ru`, else
 * `en`. Quoted lines (`> `) are not the reply and are not counted.
 */
export function replyLanguage(body: string): ReplyLanguage {
  const own = body.split("\n").filter((l) => !/^\s*>/.test(l)).join("\n");
  const letters = own.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return "en";
  const cyr = letters.filter((c) => /\p{Script=Cyrillic}/u.test(c)).length;
  return cyr / letters.length > 0.5 ? "ru" : "en";
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

/** Every line any brand of the project signs with (and the sign-off), every language variant: stripped before signing again and before comparing drafts. */
export const signatureLines = (c: { signoff: string; brands: readonly Brand[] }): string[] => [...new Set([c.signoff, ...c.brands.flatMap((b) => b.signature)].flatMap((l) => lineVariants(l).map((v) => v.text)).map((l) => l.trim()).filter(Boolean))];

/**
 * Closing phrases a reply must not end with when the writer signs (P65 S2, P60 finding 1), lower case, no trailing
 * punctuation, in every language the Hub writes (en, ru, uk, de, es, fr, pt, it). The list is the third rule of
 * {@link ownSignoff}; the two structural rules catch a closing it does not name.
 */
export const SIGNOFF_PHRASES: readonly string[] = [
  // en
  "best regards", "kind regards", "warm regards", "warmest regards", "regards", "best wishes", "with best wishes", "with kind regards", "with warm regards", "best", "all the best", "cheers", "sincerely", "yours sincerely", "yours faithfully", "yours truly", "yours", "warmly", "respectfully", "take care", "talk soon", "thanks", "many thanks", "thank you", "with thanks", "thanks again",
  // ru
  "с уважением", "с наилучшими пожеланиями", "с теплом", "с почтением", "с приветом", "всего доброго", "всего наилучшего", "всего хорошего", "до связи", "искренне ваш", "искренне ваша", "спасибо", "с благодарностью",
  // uk
  "з повагою", "з найкращими побажаннями", "з теплом", "щиро ваш", "щиро ваша", "щиро", "всього найкращого", "всього доброго", "на все добре", "дякую", "з вдячністю",
  // de
  "mit freundlichen grüßen", "mit freundlichen grüssen", "freundliche grüße", "viele grüße", "beste grüße", "liebe grüße", "herzliche grüße", "schöne grüße", "grüße", "mfg", "hochachtungsvoll", "herzlichst", "danke", "vielen dank", "besten dank",
  // es
  "saludos", "saludos cordiales", "un saludo", "un cordial saludo", "atentamente", "cordialmente", "un abrazo", "abrazos", "afectuosamente", "gracias", "muchas gracias",
  // fr
  "cordialement", "bien cordialement", "bien à vous", "salutations", "sincères salutations", "meilleures salutations", "amicalement", "bien amicalement", "chaleureusement", "à bientôt", "merci", "merci beaucoup",
  // pt
  "atenciosamente", "abraços", "um abraço", "saudações", "cumprimentos", "melhores cumprimentos", "com os melhores cumprimentos", "obrigado", "obrigada", "muito obrigado", "muito obrigada",
  // it
  "cordiali saluti", "distinti saluti", "saluti", "un saluto", "un caro saluto", "a presto", "grazie", "grazie mille",
];

/** A thanks starts many a sentence ("Thanks, we will answer tomorrow"): matched only alone, or as a closing over a name line. */
const THANKS = new Set(["thanks", "many thanks", "thank you", "with thanks", "thanks again", "спасибо", "с благодарностью", "дякую", "з вдячністю", "danke", "vielen dank", "besten dank", "gracias", "muchas gracias", "merci", "merci beaucoup", "obrigado", "obrigada", "muito obrigado", "muito obrigada", "grazie", "grazie mille"]);

/** "<Brand> team", "Команда <Brand>", "L'équipe <Brand>": a line holding one of these words signs as a team. */
const TEAM_WORDS = new Set(["team", "команда", "команди", "teams", "equipo", "équipe", "l'équipe", "equipe", "squadra", "equipa"]);

const bare = (l: string) => norm(l).replace(/[\s.,;:!—–-]+$/u, "");
const words = (l: string): string[] => l.trim().split(/\s+/).filter(Boolean);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasToken = (line: string, token: string): boolean => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(token)}($|[^\\p{L}\\p{N}])`, "iu").test(line);

/**
 * A line that signs a name: at most five words (eight with a brand name or team word), no sentence or address punctuation (`. / @ : ? ! ;`), not a list item,
 * and a brand or signing name of the project in it, a team word ("Carapis team", "Команда Carapis"), or (`loose`) at
 * most three words that all start upper case ("Mark", "Anna Petrova").
 */
function nameLine(line: string, names: readonly string[], loose: boolean): boolean {
  const t = line.trim();
  const w = words(t);
  if (w.length === 0 || w.length > 8 || /[./@:?!;]/.test(t) || /^[-*•\d]/.test(t)) return false;
  // A brand or team line may be longer ("The Caribbean Real Estate MLS team"); a bare name is short.
  if (names.some((n) => hasToken(t, n))) return true;
  if (w.some((x) => TEAM_WORDS.has(x.toLowerCase()))) return true;
  if (w.length > 5) return false;
  return loose && w.length <= 3 && w.every((x) => /^\p{Lu}/u.test(x));
}

/**
 * A closing the agent typed itself (P65 S2): among the last four non-empty lines of its text (quotes not counted), the
 * first line that is
 * 1. one of the project's own sign-off or signature lines (any language);
 * 2. a closing over a name: a short line (at most seven words, no sentence punctuation or digit inside) ending with a
 *    comma, not the reply's first line (the greeting) nor a list's continuation, and every line after it a name line
 *    ("С теплом и дружеским поклоном,\nКоманда Carapis", "Thanks,\nMark"), in any language;
 * 3. a team or brand name line with only name lines after it ("Carapis team", "Команда Carapis");
 * 4. a closing phrase of {@link SIGNOFF_PHRASES}: alone, with a short name after a comma ("Best regards, Mark"), or as
 *    the start of a longer closing ending with a comma ("С теплом и дружеским поклоном,").
 * `names` are the project's brand names and the names its signature lines sign with. Null when the text ends without
 * a closing. Pure; the text is never edited.
 */
export function ownSignoff(body: string, own: readonly string[] = [], names: readonly string[] = []): string | null {
  const lines = body.split("\n").filter((l) => l.trim() !== "" && !/^\s*>/.test(l));
  const from = Math.max(0, lines.length - 4);
  const mine = new Set(own.map(bare).filter(Boolean));
  const ns = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2))];
  const signs = (l: string, loose: boolean) => mine.has(bare(l)) || nameLine(l, ns, loose);
  const restSigns = (i: number, loose: boolean) => lines.slice(i + 1).every((l) => signs(l, loose));
  for (let i = from; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const t = raw.trim();
    const b = bare(raw);
    if (mine.has(b)) return t;
    const prev = (lines[i - 1] ?? "").trim();
    const closing = /,$/.test(t) && words(t).length <= 7 && !/[.?!:;\d]/.test(t.slice(0, -1)) && i > 0 && !/[,:]$/.test(prev);
    if (closing && i < lines.length - 1 && restSigns(i, true)) return t;
    if (nameLine(t, ns, false) && restSigns(i, false)) return t;
    for (const p of SIGNOFF_PHRASES) {
      if (b === p) return t;
      if (THANKS.has(p)) continue;
      if (b.startsWith(`${p},`) && words(b.slice(p.length + 1)).length <= 3) return t;
      if (p.includes(" ") && b.startsWith(`${p} `) && /,$/.test(t) && words(t).length <= 7 && restSigns(i, true)) return t;
    }
  }
  return null;
}

/** The names a project signs with, for {@link ownSignoff}: its brand names and every word group of its signature lines that is not a domain. */
export const signingNames = (c: { signoff: string; brands: readonly Brand[] }): string[] => [...new Set([...c.brands.map((b) => b.name), ...signatureLines(c).filter((l) => !/[./@:]/.test(l) && !/,$/.test(l.trim()))].map((n) => n.trim()).filter(Boolean))];

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

// P60 B1, P126 P1: the `## Brands` table of project.md (as `SECTIONS.brands` reads it) and its cell vocabulary.
import type { Brand } from "../schema";
import { isOwnAddress, type OwnMail } from "../addresses";
import { headerLine, SECTIONS, type SpecRow } from "../md/sections";
import { EMAIL, isIsoDate, normalizeAddress } from "../values";

export type BrandIssue = { severity: "error" | "warning"; code: "bad_table" | "duplicate_row" | "bad_value" | "bad_date" | "bad_by"; line: number; field: "brands"; message: string };

/** The header line the writer puts down: every column of the Brands spec (P126 P2: Display name is optional on read). */
export const BRANDS_HEADER = headerLine(SECTIONS.brands);
const BYS = ["owner", "default", "agent"] as const;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/i;
/** `<br>` (or `<br/>`, `<br />`) separates the lines of a Signature cell: a table cell holds one line. */
const BR = /<br\s*\/?>/i;

export const splitSignature = (cell: string): string[] => (cell.trim() === "" ? [] : cell.split(BR).map((l) => l.trim()).filter((l) => l !== ""));
export const joinSignature = (lines: readonly string[]): string => lines.map((l) => l.trim()).filter(Boolean).join("<br>");

const DISPLAY_NAME_MAX = 120;
const DISPLAY_NAME_INVALID = /[<>\r\n\u0000-\u001f\u007f]/;

export function displayNameIssue(value: string): string | null {
  const name = value.trim();
  if (name.length > DISPLAY_NAME_MAX) return `display name is longer than ${DISPLAY_NAME_MAX} characters`;
  if (DISPLAY_NAME_INVALID.test(name)) return "display name contains a control character or angle bracket";
  return null;
}

export const normalizedDisplayName = (value: string | null | undefined): string | null => {
  const name = value?.trim() ?? "";
  return name === "" ? null : name;
};

/**
 * Reads the rows of `## Brands`, as `readTable(lines, scan, SECTIONS.brands)` returns them (header checked, cells padded,
 * so a row without Display name reads it as ""). Each `Receives at` entry must be the project's own (an account,
 * address or alias, or an address or domain on `mail.domains`); no entry may sit in two rows; brand names are unique
 * (case-insensitive). Issues carry the 1-based line.
 */
export function parseBrands(rows: readonly SpecRow[], m: OwnMail): { brands: Brand[]; issues: BrandIssue[] } {
  const issues: BrandIssue[] = [];
  const brands: Brand[] = [];
  const err = (line: number, code: BrandIssue["code"], message: string) => issues.push({ severity: "error", code, line, field: "brands", message });
  const names = new Map<string, number>();
  const claimed = new Map<string, string>();
  for (const r of rows) {
    const line = r.line;
    const [name = "", receives = "", signature = "", answered = "", by = "", displayName = ""] = r.cells;
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
    const normalizedName = normalizedDisplayName(displayName);
    if (normalizedName) {
      const problem = displayNameIssue(normalizedName);
      if (problem) err(line, "bad_value", `display name of brand ${name}: ${problem}`);
    }
    if (!isIsoDate(answered)) err(line, "bad_date", `Answered "${answered}" of brand ${name} is not an ISO date (YYYY-MM-DD)`);
    if (!(BYS as readonly string[]).includes(by)) err(line, "bad_by", `By "${by}" of brand ${name} must be one of ${BYS.join(", ")}`);
    brands.push({ name, receivesAt, signature: splitSignature(signature), displayName: normalizedName, answered, by: (BYS as readonly string[]).includes(by) ? (by as Brand["by"]) : "owner" });
  }
  return { brands, issues };
}

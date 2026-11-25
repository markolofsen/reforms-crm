// P145 K1 (decision 0053): one project key across the Hub, Notion and every lead form. A `## Brands` row name, a Notion
// `Projects` option, a Leads `Brand` option, a django-cfg `project_keys` value and a notice's `X-Project-Key` all name a
// project; they match when their keys are equal. The key is the name in lower case with everything but a-z and 0-9 dropped,
// so the human names in Notion ("Caribbean MLS") and the slugs of the sites ("caribbean-mls") need no second column. Pure.
import type { Brand } from "../schema";

/** The project key of a name: lower case, letters and digits only ("GPT-Kino" -> "gptkino"). Empty when nothing is left. */
export const projectKey = (name: string | null | undefined): string => (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The one option whose key equals the key of `name`, as Notion holds it, or null. Two options with the same key (`Reforms` and
 * `reforms`) are a drift the doctor reports: the writers pick none rather than guess.
 */
export function optionForKey(options: readonly string[], name: string | null | undefined): string | null {
  const key = projectKey(name);
  if (!key) return null;
  const hits = options.filter((o) => projectKey(o) === key);
  return hits.length === 1 ? hits[0]! : null;
}

/** The `## Brands` row whose key equals the key of `name`, or null. */
export const brandForKey = <B extends Pick<Brand, "name">>(brands: readonly B[], name: string | null | undefined): B | null => {
  const key = projectKey(name);
  return key ? (brands.find((b) => projectKey(b.name) === key) ?? null) : null;
};

/** One brand row against the live options of a property: the options its key matched (one is right; none or two is drift). */
export interface KeyMatch {
  brand: string;
  key: string;
  matched: string[];
}

/** Each brand with the options its key matches, and the options no brand row claims (`Other` is never a project). Pure. */
export function matchProjectKeys(brands: readonly Pick<Brand, "name">[], options: readonly string[]): { rows: KeyMatch[]; unclaimed: string[] } {
  const rows = brands.map((b) => ({ brand: b.name, key: projectKey(b.name), matched: options.filter((o) => projectKey(o) === projectKey(b.name)) }));
  const keys = new Set(rows.map((r) => r.key));
  const unclaimed = options.filter((o) => !keys.has(projectKey(o)) && projectKey(o) !== "other");
  return { rows, unclaimed };
}

/**
 * The options to write for a card that gains `name`'s project (decision 0053 point 4): the card's own options plus the matching
 * one, never one removed. Null when nothing changes (already there, or no single option matches: Notion would create a new one).
 */
export function projectsWithKey(current: readonly string[], options: readonly string[], name: string | null | undefined): string[] | null {
  const option = optionForKey(options, name);
  if (!option || current.some((c) => projectKey(c) === projectKey(option))) return null;
  return [...current, option];
}

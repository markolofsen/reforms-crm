import { entryTopic, OTHER_TOPIC, type KnowledgeEntryDto } from "@hub/contract/knowledge";

/** The brand heading of an entry that holds for every brand (`brands: [ANY]`, or none named). */
export const ALL_BRANDS = "All brands";

/**
 * One heading of the Knowledge table (P74) and the rows directly under it: `count` is every row under it, its sub-headings' too
 * (the rows of the view and the search, never the base: the View menu holds those, `admin-principles.md` rule 10). `depth` 0 is
 * the outermost level. A heading is a row, never a disclosure (rule 5).
 */
export type EntrySection = { id: string; label: string; depth: number; count: number; entries: readonly KnowledgeEntryDto[] };

type Node = { label: string; entries: KnowledgeEntryDto[]; children: Map<string, Node>; count: number };

const node = (label: string): Node => ({ label, entries: [], children: new Map(), count: 0 });

/** Label order; `All brands` first and `Other` last, so the shared facts lead and the unfiled trail. */
const rank = (label: string): number => (label === ALL_BRANDS ? 0 : label === OTHER_TOPIC ? 2 : 1);
const byLabel = (a: Node, b: Node): number => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label);

const brandsOf = (e: KnowledgeEntryDto): readonly string[] => (e.brands.length === 0 || e.brands.includes("ANY") ? [ALL_BRANDS] : e.brands);

function place(root: Node, path: readonly string[], e: KnowledgeEntryDto) {
  let at = root;
  for (const label of path) {
    at.count += 1;
    // Keyed case-insensitively, so a folder `pricing` and a flat entry's category PRICING meet under one heading.
    const k = label.toLowerCase();
    const next = at.children.get(k) ?? node(label);
    at.children.set(k, next);
    at = next;
  }
  at.count += 1;
  at.entries.push(e);
}

function flatten(n: Node, depth: number, prefix: string, out: EntrySection[]) {
  for (const c of [...n.children.values()].sort(byLabel)) {
    const id = `${prefix}/${c.label}`;
    out.push({ id, label: c.label, depth, count: c.count, entries: c.entries });
    flatten(c, depth + 1, id, out);
  }
}

/**
 * The rows of the view as headings (P74): by topic (`entryTopic`: the folder, else the category, else Other), with the brand on
 * top only when the base's brands differ (`facetsOf`); an entry for every brand goes under "All brands", one with two brands under
 * each. A heading with no row in the view is not drawn. The sections come in reading order, each heading before its rows, the
 * rows of a folder before its sub-folders; rows keep the server's title order. Pure.
 */
export function groupEntries(entries: readonly KnowledgeEntryDto[], brandsDiffer: boolean): EntrySection[] {
  const root = node("");
  for (const e of entries) {
    const topic = entryTopic(e.key, e.category);
    for (const brand of brandsDiffer ? brandsOf(e) : [null]) place(root, brand === null ? topic : [brand, ...topic], e);
  }
  const out: EntrySection[] = [];
  flatten(root, 0, "", out);
  return out;
}

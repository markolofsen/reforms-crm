// Turns a rules file into Gmail filter specs: whitelist first, then categories in priority order, from/domain/list-id
// matches of one category and action merged into `OR` queries (chunked under MAX_QUERY_LEN), subject rules one each.
import { MAX_QUERY_LEN } from "./match.js";
import { normalizeRules } from "./rules-file.js";
import { classesOf, classIds, defaultLabel, type Action, type Category, type RulesFile } from "./model.js";

export interface FilterSpec {
  criteria: { from?: string; subject?: string; hasTheWord?: string };
  label: string;
  archive: boolean;
  markRead: boolean;
  /** Gmail "never send it to spam": set for client, partner and security mail. */
  neverSpam: boolean;
  category: Category;
}


function chunk(terms: string[]): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  for (const t of terms) {
    if (cur.length && [...cur, t].join(" OR ").length > MAX_QUERY_LEN) {
      out.push(cur.join(" OR "));
      cur = [];
    }
    cur.push(t);
  }
  if (cur.length) out.push(cur.join(" OR "));
  return out;
}

export function buildFilters(input: RulesFile): FilterSpec[] {
  const file = normalizeRules(input);
  const classes = classesOf(file);
  const order = classIds(classes);
  const neverSpam = new Set(classes.filter((c) => c.neverSpam).map((c) => c.id));
  interface Group { category: Category; label: string; action: Action; from: string[]; list: string[]; subjects: string[] }
  const groups = new Map<string, Group>();
  const group = (category: Category, label: string, action: Action): Group => {
    const key = `${order.indexOf(category)}|${label}|${action}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { category, label, action, from: [], list: [], subjects: [] }));
    return g;
  };
  // The whitelist is an explicit rule of its own: client label, never skipping the inbox.
  for (const w of file.whitelist) group("client", defaultLabel("client"), "label").from.push(w.match.kind === "domain" ? `@${w.match.value}` : w.match.value);
  for (const r of file.rules) {
    const g = group(r.category, r.label, r.action);
    if (r.match.kind === "from") g.from.push(r.match.value);
    else if (r.match.kind === "domain") g.from.push(`@${r.match.value}`);
    else if (r.match.kind === "list-id") g.list.push(`list:${r.match.value}`);
    else g.subjects.push(r.match.value);
  }
  const out: FilterSpec[] = [];
  for (const [, g] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const skip = g.action === "label+skip+read";
    const base = { label: g.label, archive: skip, markRead: skip, neverSpam: neverSpam.has(g.category), category: g.category };
    for (const q of chunk([...new Set(g.from)].sort())) out.push({ ...base, criteria: { from: q } });
    for (const q of chunk([...new Set(g.list)].sort())) out.push({ ...base, criteria: { hasTheWord: q } });
    for (const s of [...new Set(g.subjects)].sort()) out.push({ ...base, criteria: { subject: `"${s}"` } });
  }
  return out;
}

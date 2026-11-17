// Is the Notion pack still what the live CRM looks like? `schema/<db>.json` (pack) against a live data source, property by property. Pure: the live side is the
// `schema` object that the Notion connector's fetch returns for a data source (`{ "Name": { "type": "title" }, "Status": { "type": "select", "options": [{ "name": "New" }] } }`),
// pasted in by the agent, or the same shape read through the token. Nothing is written anywhere; a difference is either a pack fix or an owner choice.

export interface LiveProp { type: string; options?: Array<{ name: string }> }
export type LiveSchema = Record<string, LiveProp>;

export interface PackProp { type: string; /** Other names the live CRMs use for it. */ aliases?: string[]; createAs?: string; contract?: boolean; options?: unknown[]; optional?: boolean; skip?: boolean; flag?: string; vertical?: boolean }
export interface PackSchema { database?: string; properties: Record<string, PackProp> }

export interface SchemaDiff {
  /** The pack has it, the live data source does not (optional, skipped and flagged properties are not counted). */
  missing: string[];
  /** The live data source has it, the pack does not: the pack is behind reality. */
  extra: string[];
  typeChanged: Array<{ name: string; pack: string; live: string }>;
  /** Contract options (the pack marks them `contract`: a writer stops without them) absent live. */
  optionsMissing: Array<{ name: string; options: string[] }>;
  /** Options that differ but are a project's own choice (a vertical's Type, Lead source, Category...): information, not a failure. */
  optionsExtra: Array<{ name: string; options: string[] }>;
}

const optName = (o: unknown): string => (typeof o === "string" ? o : typeof o === "object" && o && "name" in o ? String((o as { name: unknown }).name) : "");
/** The connector marks Hub/formula/rollup types the same way the pack does; relation and rollup are compared by type only. */
const OPTION_TYPES = new Set(["select", "multi_select", "status"]);

/** Accepts the `schema` object, a whole `data-source-state` object, or JSON text containing either. */
export function liveSchemaOf(input: unknown): LiveSchema {
  const v = typeof input === "string" ? (JSON.parse(input) as unknown) : input;
  const o = (v ?? {}) as { schema?: unknown };
  const schema = (o.schema ?? v) as Record<string, unknown>;
  const out: LiveSchema = {};
  for (const [name, p] of Object.entries(schema)) {
    if (!p || typeof p !== "object" || typeof (p as { type?: unknown }).type !== "string") continue;
    const q = p as { type: string; options?: unknown[] };
    out[name] = { type: q.type, ...(Array.isArray(q.options) ? { options: q.options.map((x) => ({ name: optName(x) })) } : {}) };
  }
  return out;
}

export function diffSchema(pack: PackSchema, live: LiveSchema): SchemaDiff {
  const d: SchemaDiff = { missing: [], extra: [], typeChanged: [], optionsMissing: [], optionsExtra: [] };
  for (const [name, p] of Object.entries(pack.properties)) {
    const alias = [name, ...(p.aliases ?? [])].find((n) => n in live);
    const l = alias ? live[alias] : undefined;
    if (!l) {
      if (!p.optional && !p.skip && !p.flag && !p.vertical) d.missing.push(name);
      continue;
    }
    if (l.type !== p.type && l.type !== p.createAs) d.typeChanged.push({ name, pack: p.type, live: l.type });
    if (OPTION_TYPES.has(p.type) && Array.isArray(p.options) && p.options.length && l.options) {
      const want = p.options.map(optName).filter(Boolean), have = l.options.map((o) => o.name);
      const miss = want.filter((o) => !have.includes(o)), extra = have.filter((o) => !want.includes(o));
      if (miss.length) (p.contract ? d.optionsMissing : d.optionsExtra).push({ name, options: miss });
      if (extra.length) d.optionsExtra.push({ name, options: extra });
    }
  }
  const known = new Set(Object.entries(pack.properties).flatMap(([n, p]) => [n, ...(p.aliases ?? [])]));
  for (const name of Object.keys(live)) if (!known.has(name)) d.extra.push(name);
  return d;
}

export const isClean = (d: SchemaDiff): boolean => !d.missing.length && !d.extra.length && !d.typeChanged.length && !d.optionsMissing.length;

export function renderDiff(db: string, d: SchemaDiff): string {
  const lines = [`${db}: ${isClean(d) ? "matches the pack" : "differs from the pack"}`];
  if (d.missing.length) lines.push(`  missing live (pack has them): ${d.missing.join(", ")}`);
  if (d.extra.length) lines.push(`  extra live (pack is behind): ${d.extra.join(", ")}`);
  for (const t of d.typeChanged) lines.push(`  type: ${t.name}: pack ${t.pack}, live ${t.live}`);
  for (const o of d.optionsMissing) lines.push(`  options missing live: ${o.name}: ${o.options.join(", ")}`);
  for (const o of d.optionsExtra) lines.push(`  options differ (a project's own choice): ${o.name}: ${o.options.join(", ")}`);
  return `${lines.join("\n")}\n`;
}

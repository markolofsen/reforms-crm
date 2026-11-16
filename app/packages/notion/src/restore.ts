import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pageTitle } from "./dump.js";
import { sortKeys, stripSignedFileUrls } from "./stable.js";
import type { DataSourceInfo, Manifest, NotionReader, PageObject, PropertyConfig, PropertyValue } from "./types.js";

/** Property types the API cannot write: a restore skips them and lists them. */
export const READ_ONLY_TYPES = new Set([
  "formula",
  "rollup",
  "created_time",
  "created_by",
  "last_edited_time",
  "last_edited_by",
  "unique_id",
  "verification",
  "button",
]);

const OPTION_TYPES = new Set(["select", "multi_select", "status"]);

export interface SchemaDiff {
  missingProperties: Array<{ name: string; type: string }>;
  changedTypes: Array<{ name: string; dumped: string; live: string }>;
  missingOptions: Array<{ name: string; options: string[] }>;
}

export interface MissingPage {
  id: string;
  title: string;
  hasBody: boolean;
  writable: string[];
  skippedReadOnly: string[];
  /** Relations that hold links; each needs an old-id to new-id map. */
  relations: Array<{ name: string; count: number }>;
}

export interface ChangedPage {
  id: string;
  title: string;
  properties: string[];
}

export interface DatabasePlan {
  slug: string;
  dataSourceId: string;
  title: string;
  error?: string;
  schema: SchemaDiff;
  dumpedPages: number;
  livePages: number;
  unchanged: number;
  missing: MissingPage[];
  changed: ChangedPage[];
  newInLive: number;
}

export interface RestorePlan {
  project: string;
  dumpDate: string;
  databases: DatabasePlan[];
  totals: { wouldRecreate: number; changedSinceDump: number; newInLive: number; errors: number };
}

function optionNames(config: PropertyConfig): string[] {
  const body = config[config.type] as { options?: Array<{ name?: string }> } | undefined;
  return (body?.options ?? []).map((o) => o.name ?? "").filter(Boolean);
}

export function diffSchema(dumped: DataSourceInfo["properties"], live: DataSourceInfo["properties"]): SchemaDiff {
  const out: SchemaDiff = { missingProperties: [], changedTypes: [], missingOptions: [] };
  for (const [name, config] of Object.entries(dumped).sort(([a], [b]) => a.localeCompare(b))) {
    const now = live[name];
    if (!now) {
      out.missingProperties.push({ name, type: config.type });
      continue;
    }
    if (now.type !== config.type) {
      out.changedTypes.push({ name, dumped: config.type, live: now.type });
      continue;
    }
    if (OPTION_TYPES.has(config.type)) {
      const have = new Set(optionNames(now));
      const lacking = optionNames(config).filter((o) => !have.has(o));
      if (lacking.length) out.missingOptions.push({ name, options: lacking });
    }
  }
  return out;
}

function propertyKey(value: PropertyValue): string {
  return JSON.stringify(sortKeys(stripSignedFileUrls(value)));
}

function changedProperties(dumped: PageObject, live: PageObject): string[] {
  const names = new Set([...Object.keys(dumped.properties), ...Object.keys(live.properties)]);
  const out: string[] = [];
  for (const name of [...names].sort()) {
    const a = dumped.properties[name];
    const b = live.properties[name];
    if (!a || !b) {
      out.push(name);
      continue;
    }
    if (READ_ONLY_TYPES.has(a.type) && READ_ONLY_TYPES.has(b.type)) continue;
    if (propertyKey(a) !== propertyKey(b)) out.push(name);
  }
  return out;
}

function describeMissing(page: PageObject, hasBody: boolean): MissingPage {
  const writable: string[] = [];
  const skipped: string[] = [];
  const relations: MissingPage["relations"] = [];
  for (const [name, prop] of Object.entries(page.properties).sort(([a], [b]) => a.localeCompare(b))) {
    if (READ_ONLY_TYPES.has(prop.type)) {
      skipped.push(name);
      continue;
    }
    writable.push(name);
    if (prop.type === "relation" && Array.isArray(prop.relation) && prop.relation.length > 0) {
      relations.push({ name, count: prop.relation.length });
    }
  }
  return { id: page.id, title: pageTitle(page), hasBody, writable, skippedReadOnly: skipped, relations };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

/** Latest dated folder with a manifest, or the folder named by `from` (a date or a path). */
export async function resolveDumpDir(outDir: string, from?: string): Promise<string> {
  if (from) return /^\d{4}-\d{2}-\d{2}$/.test(from) ? join(outDir, from) : from;
  const names = (await readdir(outDir).catch(() => [] as string[])).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort();
  for (const name of names.reverse()) {
    try {
      await readFile(join(outDir, name, "manifest.json"));
      return join(outDir, name);
    } catch {
      // unfinished dump: skip it
    }
  }
  throw new Error(`No complete dump in ${outDir} (a dump without manifest.json is unfinished)`);
}

/**
 * Compare a dump with the live databases and say what a restore would do. Reads only: the live side is a schema
 * retrieve and a page list, never a write. Matching is by page id: a page that is gone from Notion would be recreated
 * (and get a new id); a page present on both sides is never touched, only reported when it differs.
 */
export async function planRestore(dumpDir: string, reader: NotionReader, only?: string[]): Promise<RestorePlan> {
  const manifest = await readJson<Manifest>(join(dumpDir, "manifest.json"));
  const databases: DatabasePlan[] = [];

  for (const entry of manifest.databases) {
    if (only && !only.includes(entry.slug)) continue;
    const base: DatabasePlan = {
      slug: entry.slug,
      dataSourceId: entry.data_source_id,
      title: entry.title,
      schema: { missingProperties: [], changedTypes: [], missingOptions: [] },
      dumpedPages: entry.pages,
      livePages: 0,
      unchanged: 0,
      missing: [],
      changed: [],
      newInLive: 0,
    };
    if (entry.error) {
      databases.push({ ...base, error: `not in the dump: ${entry.error}` });
      continue;
    }
    try {
      const dbDir = join(dumpDir, entry.slug);
      const dumpedSchema = await readJson<{ properties: DataSourceInfo["properties"] }>(join(dbDir, "schema.json"));
      const liveInfo = await reader.retrieveDataSource(entry.data_source_id);
      base.schema = diffSchema(dumpedSchema.properties, liveInfo.properties);

      const live = new Map<string, PageObject>();
      for await (const page of reader.listPages(entry.data_source_id)) live.set(page.id, stripSignedFileUrls(page) as PageObject);
      base.livePages = live.size;

      const pageFiles = (await readdir(join(dbDir, "pages"))).filter((n) => n.endsWith(".json")).sort();
      const seen = new Set<string>();
      for (const file of pageFiles) {
        const dumped = await readJson<PageObject>(join(dbDir, "pages", file));
        seen.add(dumped.id);
        const now = live.get(dumped.id);
        if (!now) {
          const md = await readFile(join(dbDir, "pages", `${dumped.id}.md`), "utf8").catch(() => "");
          base.missing.push(describeMissing(dumped, md.trim().length > 0));
          continue;
        }
        const props = changedProperties(dumped, now);
        if (props.length === 0) base.unchanged++;
        else base.changed.push({ id: dumped.id, title: pageTitle(dumped), properties: props });
      }
      base.newInLive = [...live.keys()].filter((id) => !seen.has(id)).length;
    } catch (err) {
      base.error = err instanceof Error ? err.message : String(err);
    }
    databases.push(base);
  }

  return {
    project: manifest.project,
    dumpDate: manifest.date,
    databases,
    totals: {
      wouldRecreate: databases.reduce((n, d) => n + d.missing.length, 0),
      changedSinceDump: databases.reduce((n, d) => n + d.changed.length, 0),
      newInLive: databases.reduce((n, d) => n + d.newInLive, 0),
      errors: databases.filter((d) => d.error).length,
    },
  };
}

export function renderPlan(plan: RestorePlan, maxListed = 25): string {
  const out: string[] = [];
  out.push(`Restore dry run: project ${plan.project}, dump ${plan.dumpDate}. Nothing was written to Notion.`);
  for (const db of plan.databases) {
    out.push("", `== ${db.slug} (${db.title || db.dataSourceId})`);
    if (db.error) {
      out.push(`  ERROR ${db.error}`);
      continue;
    }
    out.push(`  dumped ${db.dumpedPages}, live ${db.livePages}, identical ${db.unchanged}, new in live ${db.newInLive}`);
    for (const p of db.schema.missingProperties) out.push(`  schema: property "${p.name}" (${p.type}) is missing in live`);
    for (const p of db.schema.changedTypes) out.push(`  schema: "${p.name}" is ${p.live} in live, was ${p.dumped}`);
    for (const p of db.schema.missingOptions) out.push(`  schema: "${p.name}" lacks options ${p.options.join(", ")}`);
    out.push(`  would recreate ${db.missing.length} page(s)`);
    for (const m of db.missing.slice(0, maxListed)) {
      const rel = m.relations.map((r) => `${r.name}x${r.count}`).join(", ");
      out.push(
        `    - ${m.title || "(untitled)"} [${m.id}] body:${m.hasBody ? "yes" : "no"}` +
          (rel ? ` relations to remap: ${rel}` : "") +
          (m.skippedReadOnly.length ? ` read-only skipped: ${m.skippedReadOnly.join(", ")}` : ""),
      );
    }
    if (db.missing.length > maxListed) out.push(`    ... and ${db.missing.length - maxListed} more (use --json)`);
    if (db.changed.length) {
      out.push(`  ${db.changed.length} page(s) differ from the dump (left as they are in Notion)`);
      for (const c of db.changed.slice(0, maxListed)) out.push(`    ~ ${c.title || "(untitled)"} [${c.id}]: ${c.properties.join(", ")}`);
      if (db.changed.length > maxListed) out.push(`    ... and ${db.changed.length - maxListed} more (use --json)`);
    }
  }
  const t = plan.totals;
  out.push("", `Total: would recreate ${t.wouldRecreate}, differ ${t.changedSinceDump}, new in live ${t.newInLive}, errors ${t.errors}.`);
  return `${out.join("\n")}\n`;
}

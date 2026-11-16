import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizePage, sha256, stableStringify } from "./stable.js";
import type { DataSourceInfo, Manifest, ManifestDatabase, NotionReader, PageObject, Project } from "./types.js";

const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;
const TRUNCATED_MARK = "<!-- notion-dump: truncated";

export interface DumpOptions {
  project: Project;
  /** Folder that holds the dated dump folders. */
  outDir: string;
  /** YYYY-MM-DD, the name of this dump's folder. */
  date: string;
  reader: NotionReader;
  /** Skip slugs not listed. */
  only?: string[];
  /** Reuse the markdown of a page whose last_edited_time did not change since an earlier dump. Default true. */
  reuse?: boolean;
  log?: (line: string) => void;
}

export function pageTitle(page: PageObject): string {
  for (const prop of Object.values(page.properties)) {
    if (prop.type === "title" && Array.isArray(prop.title)) {
      return (prop.title as Array<{ plain_text?: string }>).map((t) => t.plain_text ?? "").join("");
    }
  }
  return "";
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function latestCompleteDump(outDir: string, before: string): Promise<string | null> {
  const names = await readdir(outDir).catch(() => [] as string[]);
  const dated = names.filter((n) => DATE_DIR.test(n) && n < before).sort().reverse();
  for (const name of dated) {
    if ((await readIfExists(join(outDir, name, "manifest.json"))) !== null) return join(outDir, name);
  }
  return null;
}

/** Markdown from an earlier file when the page has not been edited since. */
async function reusableMarkdown(dirs: string[], slug: string, page: PageObject): Promise<string | null> {
  for (const dir of dirs) {
    const base = join(dir, slug, "pages", page.id);
    const json = await readIfExists(`${base}.json`);
    if (json === null) continue;
    try {
      const old = JSON.parse(json) as { last_edited_time?: string };
      if (old.last_edited_time !== page.last_edited_time) continue;
    } catch {
      continue;
    }
    const md = await readIfExists(`${base}.md`);
    if (md !== null) return md;
  }
  return null;
}

function withTruncationMark(markdown: string, truncated: boolean, unknown: string[]): string {
  if (!truncated) return markdown;
  const ids = unknown.length ? ` unknown_block_ids=${unknown.join(",")}` : "";
  return `${markdown.replace(/\n*$/, "\n")}\n${TRUNCATED_MARK}${ids} -->\n`;
}

async function dumpDatabase(
  opts: DumpOptions,
  slug: string,
  dataSourceId: string,
  reuseDirs: string[],
  dayDir: string,
): Promise<ManifestDatabase> {
  const { reader, log } = opts;
  const info: DataSourceInfo = await reader.retrieveDataSource(dataSourceId);
  const pages: PageObject[] = [];
  for await (const page of reader.listPages(dataSourceId)) pages.push(normalizePage(page));
  pages.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const dbDir = join(dayDir, slug);
  const pagesDir = join(dbDir, "pages");
  await mkdir(pagesDir, { recursive: true });

  const schemaText = stableStringify({ id: info.id, title: info.title, properties: info.properties });
  await writeFile(join(dbDir, "schema.json"), schemaText);

  const lines: string[] = [];
  const index: string[] = [`# ${info.title || slug}`, "", "| Title | Page id | Last edited |", "|---|---|---|"];
  let truncated = 0;
  let fetched = 0;
  let reused = 0;

  for (const page of pages) {
    const jsonText = stableStringify(page);
    let md = opts.reuse === false ? null : await reusableMarkdown(reuseDirs, slug, page);
    if (md === null) {
      const res = await reader.retrieveMarkdown(page.id);
      md = withTruncationMark(res.markdown, res.truncated, res.unknownBlockIds);
      fetched++;
    } else {
      reused++;
    }
    if (md.includes(TRUNCATED_MARK)) truncated++;
    await writeFile(join(pagesDir, `${page.id}.json`), jsonText);
    await writeFile(join(pagesDir, `${page.id}.md`), md);
    lines.push(`${page.id}\t${sha256(jsonText)}\t${sha256(md)}`);
    index.push(`| ${pageTitle(page).replace(/\|/g, "\\|") || "(untitled)"} | ${page.id} | ${page.last_edited_time} |`);
  }

  // Drop files of pages that no longer exist, so a second run on the same day matches the live state.
  const keep = new Set(pages.flatMap((p) => [`${p.id}.json`, `${p.id}.md`]));
  for (const name of await readdir(pagesDir)) {
    if (!keep.has(name) && /\.(json|md)$/.test(name)) await rm(join(pagesDir, name));
  }
  await writeFile(join(dbDir, "index.md"), `${index.join("\n")}\n`);

  const schemaSha = sha256(schemaText);
  log?.(`${slug}: ${pages.length} pages (${fetched} fetched, ${reused} reused, ${truncated} truncated)`);
  return {
    slug,
    data_source_id: dataSourceId,
    title: info.title,
    pages: pages.length,
    markdown_truncated: truncated,
    schema_sha256: schemaSha,
    sha256: sha256([schemaSha, ...lines].join("\n")),
  };
}

/**
 * Dump every database of the project to <outDir>/<date>/<slug>/{schema.json,index.md,pages/<id>.{json,md}> and write
 * manifest.json last: a folder without a manifest is an unfinished dump and nothing reads it. Nothing is sent to
 * Notion. Running again on the same date rewrites the same files with the same bytes.
 */
export async function runDump(opts: DumpOptions): Promise<Manifest> {
  const dayDir = join(opts.outDir, opts.date);
  await mkdir(dayDir, { recursive: true });
  const previous = await latestCompleteDump(opts.outDir, opts.date);
  const reuseDirs = [dayDir, ...(previous ? [previous] : [])];

  const wanted = opts.project.databases.filter((d) => !opts.only || opts.only.includes(d.slug));
  if (opts.only) {
    const unknown = opts.only.filter((s) => !opts.project.databases.some((d) => d.slug === s));
    if (unknown.length) throw new Error(`Not in project.md: ${unknown.join(", ")}`);
  }

  const databases: ManifestDatabase[] = [];
  for (const db of wanted) {
    try {
      databases.push(await dumpDatabase(opts, db.slug, db.dataSourceId, reuseDirs, dayDir));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.log?.(`${db.slug}: FAILED ${message}`);
      databases.push({
        slug: db.slug,
        data_source_id: db.dataSourceId,
        title: "",
        pages: 0,
        markdown_truncated: 0,
        schema_sha256: "",
        sha256: "",
        error: message,
      });
    }
  }

  const totals = {
    databases: databases.length,
    pages: databases.reduce((n, d) => n + d.pages, 0),
    markdown_truncated: databases.reduce((n, d) => n + d.markdown_truncated, 0),
    errors: databases.filter((d) => d.error).length,
  };
  const manifest: Manifest = {
    format: 1,
    project: opts.project.name,
    date: opts.date,
    databases,
    totals,
    sha256: sha256(databases.map((d) => `${d.slug}:${d.sha256}`).join("\n")),
  };
  await writeFile(join(dayDir, "manifest.json"), stableStringify(manifest));
  return manifest;
}

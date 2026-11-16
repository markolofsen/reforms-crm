import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { EntryError, normalizeFront, parseEntry, renderEntry, sha256, type FrontMatter } from "./entry.js";
import { walkMarkdown } from "./indexer.js";

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

const localDate = (d: Date): string => d.toLocaleDateString("en-CA");

/** Writes only when the bytes differ, so a re-import leaves every file (and its mtime) alone. Atomic by rename. */
function writeIfChanged(file: string, text: string): boolean {
  if (existsSync(file) && readFileSync(file, "utf8") === text) return false;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
  return true;
}

function pruneEmptyDirs(dir: string, keepRoot: string): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) pruneEmptyDirs(p, keepRoot);
  }
  if (dir !== keepRoot && readdirSync(dir).length === 0) rmdirSync(dir);
}

type ImportRecord = {
  source: string;
  date: string;
  [k: string]: unknown;
};

/** `.generated/knowledge-import.json`: one record per source (`notion`, `files`), merged so `both` keeps each. Deterministic bytes. */
export const IMPORT_RECORD = ".generated/knowledge-import.json";
function writeImportRecord(projectFolder: string, key: "notion" | "files", record: ImportRecord): void {
  const file = join(projectFolder, IMPORT_RECORD);
  let all: Record<string, ImportRecord> = {};
  try {
    all = JSON.parse(readFileSync(file, "utf8")) as Record<string, ImportRecord>;
  } catch {
    /* first import */
  }
  all[key] = record;
  const sorted = Object.fromEntries(Object.entries(all).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeIfChanged(file, `${JSON.stringify(sorted, null, 2)}\n`);
}

// ---- Notion property reading (API shapes of `PageObject.properties`) -------------------------------------------

type Prop = { type?: string; [k: string]: unknown };
const plain = (parts: unknown): string =>
  Array.isArray(parts) ? parts.map((p) => (p as { plain_text?: string }).plain_text ?? "").join("") : "";

function textOf(p: Prop | undefined): string | undefined {
  if (!p) return undefined;
  switch (p.type) {
    case "title":
      return plain(p.title);
    case "rich_text":
      return plain(p.rich_text);
    case "select":
      return (p.select as { name?: string } | null)?.name;
    case "status":
      return (p.status as { name?: string } | null)?.name;
    case "url":
      return (p.url as string | null) ?? undefined;
    case "date":
      return (p.date as { start?: string } | null)?.start ?? undefined;
    default:
      return undefined;
  }
}
const listOf = (p: Prop | undefined): string[] =>
  p?.type === "multi_select" ? ((p.multi_select as Array<{ name?: string }>) ?? []).map((o) => o.name ?? "").filter(Boolean) : [];

interface DumpPage {
  id: string;
  last_edited_time?: string;
  properties: Record<string, Prop>;
}

const slugify = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "") || "entry";

const folderSegments = (folder: string | undefined): string[] =>
  (folder ?? "")
    .split("/")
    .map((s) => s.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter((s) => s && s !== "." && s !== "..");

const prop = (p: DumpPage, name: string): Prop | undefined => {
  const hit = Object.keys(p.properties).find((k) => k.toLowerCase() === name.toLowerCase());
  return hit ? p.properties[hit] : undefined;
};

/**
 * Notion Knowledge page -> entry. The mapping of doc 16: Question (the title property) -> title, Approved -> approved,
 * Use -> use, Audiences -> audiences, Category/Kind/Folder -> same names, Stages -> stages, Phrasings (`|`-separated)
 * -> phrasings, Valid until, Last confirmed, Source, Supersedes -> same names; page id and last_edited_time ->
 * notion_id, notion_edited. A page whose `Use` is empty is imported as MARKER (context only): an unset Use must not
 * make an entry quotable.
 */
export function mapPage(page: DumpPage): FrontMatter {
  const titleProp = Object.values(page.properties).find((p) => p.type === "title");
  const title = (textOf(titleProp) ?? "").trim() || "(untitled)";
  const use = textOf(prop(page, "Use"));
  const phrasings = (textOf(prop(page, "Phrasings")) ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  const approved = (prop(page, "Approved") as { checkbox?: boolean } | undefined)?.checkbox === true;
  return normalizeFront({
    title,
    approved,
    use: use === "STATE" ? "STATE" : "MARKER",
    audiences: listOf(prop(page, "Audiences")),
    category: textOf(prop(page, "Category")),
    kind: textOf(prop(page, "Kind")),
    stages: listOf(prop(page, "Stages")),
    folder: textOf(prop(page, "Folder")),
    phrasings,
    valid_until: textOf(prop(page, "Valid until")),
    last_confirmed: textOf(prop(page, "Last confirmed")),
    source: textOf(prop(page, "Source")),
    supersedes: textOf(prop(page, "Supersedes")),
    notion_id: page.id,
    notion_edited: page.last_edited_time,
  });
}

export const entryPathFor = (front: FrontMatter): string =>
  ["knowledge", "notion", ...folderSegments(front.folder), `${slugify(front.title)}-${(front.notion_id ?? "").replace(/-/g, "").slice(0, 8)}.md`].join("/");

export interface DumpImportResult {
  dump: string;
  pages: number;
  written: number;
  unchanged: number;
  removed: number;
  truncated: number;
  approved: number;
}

function findDump(projectFolder: string, dumpDir?: string): string {
  if (dumpDir) {
    if (!existsSync(join(dumpDir, "manifest.json"))) throw new ImportError(`no manifest.json in ${dumpDir}: an unfinished dump is not read`);
    return resolve(dumpDir);
  }
  const base = join(projectFolder, "dumps");
  const dated = (existsSync(base) ? readdirSync(base) : []).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n)).sort().reverse();
  for (const name of dated) {
    const mf = join(base, name, "manifest.json");
    if (!existsSync(mf)) continue;
    const m = JSON.parse(readFileSync(mf, "utf8")) as { databases?: Array<{ slug: string; error?: string }> };
    const k = m.databases?.find((d) => d.slug === "knowledge");
    if (k && !k.error) return join(base, name);
  }
  throw new ImportError(`no complete dump with a knowledge database under ${base} (run: pnpm --filter @hub/notion notion-dump dump <project> --only knowledge)`);
}

/**
 * Notion dump -> `knowledge/notion/<folder>/<slug>-<id8>.md` + `_import.json`. Rewrites only changed files, removes
 * files whose page is gone, and is idempotent: the same dump gives the same bytes. Never touches `knowledge/files/`.
 */
export function importFromDump(root: string, slug: string, opts: { dumpDir?: string; now?: Date } = {}): DumpImportResult {
  const folder = join(root, slug);
  if (!existsSync(folder)) throw new ImportError(`no such project folder: ${folder}`);
  const dump = findDump(folder, opts.dumpDir);
  const pagesDir = join(dump, "knowledge", "pages");
  if (!existsSync(pagesDir)) throw new ImportError(`the dump has no knowledge/pages: ${pagesDir}`);

  const knowledgeDir = join(folder, "knowledge");
  const notionDir = join(knowledgeDir, "notion");
  const wanted = new Map<string, string>();
  const hashes: Record<string, string> = {};
  let truncated = 0;
  let approved = 0;

  const ids = readdirSync(pagesDir).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)).sort();
  for (const id of ids) {
    const page = JSON.parse(readFileSync(join(pagesDir, `${id}.json`), "utf8")) as DumpPage;
    const mdFile = join(pagesDir, `${id}.md`);
    let body = existsSync(mdFile) ? readFileSync(mdFile, "utf8") : "";
    if (body.includes("<!-- notion-dump: truncated")) truncated++;
    body = body.replace(/\s*<!-- notion-dump: truncated[^>]*-->\s*$/, "\n");
    const front = mapPage(page);
    if (front.approved) approved++;
    const rel = entryPathFor(front);
    if (wanted.has(rel)) throw new ImportError(`two pages map to ${rel} (same title and id prefix)`);
    const text = renderEntry(front, body);
    wanted.set(rel, text);
    hashes[rel] = sha256(text);
  }

  let written = 0;
  let unchanged = 0;
  for (const [rel, text] of wanted) {
    if (writeIfChanged(join(folder, rel), text)) written++;
    else unchanged++;
  }
  let removed = 0;
  for (const rel of walkMarkdown(notionDir, folder)) {
    if (!wanted.has(rel)) {
      unlinkSync(join(folder, rel));
      removed++;
    }
  }
  pruneEmptyDirs(notionDir, notionDir);

  writeImportRecord(folder, "notion", {
    source: "notion-dump",
    date: localDate(opts.now ?? new Date()),
    dump: basename(dump),
    pages: ids.length,
    files: wanted.size,
    approved,
    truncated,
    sha256: Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => (a < b ? -1 : 1))),
  });
  return { dump: basename(dump), pages: ids.length, written, unchanged, removed, truncated, approved };
}

export interface FilesImportResult {
  copied: number;
  unchanged: number;
  invalid: Array<{ path: string; error: string }>;
}

/**
 * Validates `.md` files from `from` (a file or a folder) and copies the valid ones to `knowledge/files/`, keeping their
 * relative paths. A source already inside `knowledge/files/` is validated in place. The Notion mirror is never a source.
 */
export function importFromFiles(root: string, slug: string, from: string, opts: { now?: Date } = {}): FilesImportResult {
  const folder = join(root, slug);
  if (!existsSync(folder)) throw new ImportError(`no such project folder: ${folder}`);
  const src = resolve(from);
  if (!existsSync(src)) throw new ImportError(`no such file or folder: ${from}`);
  const mirror = join(folder, "knowledge", "notion");
  if (src === mirror || src.startsWith(mirror + sep)) throw new ImportError("knowledge/notion is the Notion mirror: change the entry in Notion and re-import, never copy it into files");
  const filesDir = join(folder, "knowledge", "files");

  const sources = statSync(src).isDirectory()
    ? walkMarkdown(src, src).map((rel) => ({ rel, abs: join(src, rel) }))
    : [{ rel: basename(src), abs: src }];
  const result: FilesImportResult = { copied: 0, unchanged: 0, invalid: [] };
  const record: Record<string, string> = {};

  for (const { rel, abs } of sources) {
    const text = readFileSync(abs, "utf8");
    try {
      parseEntry(text);
    } catch (err) {
      if (!(err instanceof EntryError)) throw err;
      result.invalid.push({ path: rel, error: err.message });
      continue;
    }
    const target = join(filesDir, rel);
    record[`knowledge/files/${rel}`] = sha256(text);
    if (resolve(target) === abs) {
      result.unchanged++;
      continue;
    }
    if (writeIfChanged(target, text)) result.copied++;
    else result.unchanged++;
  }
  writeImportRecord(folder, "files", {
    source: "files",
    date: localDate(opts.now ?? new Date()),
    from: relative(folder, src).startsWith("..") ? basename(src) : relative(folder, src),
    files: Object.keys(record).length,
    sha256: Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1))),
  });
  return result;
}

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

// Renaming a project slug in the database, generic: no table is named here. A table takes part when it has a
// `project` column (every table that belongs to a project does) plus the registry's own `projects.slug`. The write is
// ONE immediate transaction, after a consistent backup copy next to the file. No foreign key points at a slug, and
// the FTS index of knowledge_docs does not hold it (triggers fire on the update and keep it in step regardless).

export interface RenameTable {
  table: string;
  column: string;
  rows: number;
}

export interface DbRenameResult {
  tables: RenameTable[];
  total: number;
  /** Only when applied: the backup file. */
  backup?: string;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

/** The columns that hold a slug: `<table>.project` for every ordinary table, plus `projects.slug`. */
function slugColumns(sqlite: Database.Database): Array<{ table: string; column: string }> {
  const out: Array<{ table: string; column: string }> = [];
  const tables = sqlite
    .prepare("select name from sqlite_master where type = 'table' and sql not like 'CREATE VIRTUAL%' and name not like 'sqlite_%' and name not like '__drizzle%' and name not like 'live_%' order by name")
    .all() as Array<{ name: string }>;
  for (const { name } of tables) {
    if (!IDENT.test(name)) continue;
    const cols = (sqlite.prepare(`select name from pragma_table_info(${JSON.stringify(name).replace(/"/g, "'")})`).all() as Array<{ name: string }>).map((c) => c.name);
    if (cols.includes("project")) out.push({ table: name, column: "project" });
    else if (name === "projects" && cols.includes("slug")) out.push({ table: name, column: "slug" });
  }
  return out;
}

/** UTC stamp for a file name: 20261115T101530Z. */
export const stamp = (d: Date = new Date()): string => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

/**
 * Counts (dry run) or performs (`apply`) the rename of `from` to `to` in every slug column of the database at `dbPath`.
 * Refuses when `to` already has rows anywhere, or when `from` has none in the registry and none anywhere.
 * `registry` lets the caller fix the registry row's JSON and hash in the same transaction.
 */
export function renameProjectInDb(
  dbPath: string,
  from: string,
  to: string,
  o: { apply: boolean; now?: Date; registry?: (settingsJson: string) => { settingsJson: string; hash?: string } },
): DbRenameResult {
  if (!existsSync(dbPath)) return { tables: [], total: 0 };
  const sqlite = new Database(dbPath, o.apply ? {} : { readonly: true });
  try {
    sqlite.pragma("busy_timeout = 5000");
    const cols = slugColumns(sqlite);
    const count = (t: { table: string; column: string }, v: string) =>
      (sqlite.prepare(`select count(*) as n from ${q(t.table)} where ${q(t.column)} = ?`).get(v) as { n: number }).n;
    const tables = cols.map((c) => ({ ...c, rows: count(c, from) })).filter((t) => t.rows > 0);
    const clash = cols.filter((c) => count(c, to) > 0).map((c) => c.table);
    if (clash.length) throw new Error(`the database already has rows for "${to}" (${clash.join(", ")}); nothing renamed`);
    const total = tables.reduce((n, t) => n + t.rows, 0);
    if (!o.apply || total === 0) return { tables: tables.map(({ table, column, rows }) => ({ table, column, rows })), total };

    // consistent copy (WAL-safe), taken before anything is written
    const backup = join(dirname(dbPath), `${dbPath.split(/[\\/]/).pop()}.before-rename-${from}-${stamp(o.now)}`);
    mkdirSync(dirname(backup), { recursive: true });
    sqlite.prepare("VACUUM INTO ?").run(backup);

    const run = sqlite.transaction(() => {
      for (const t of tables) sqlite.prepare(`update ${q(t.table)} set ${q(t.column)} = ? where ${q(t.column)} = ?`).run(to, from);
      if (o.registry && tables.some((t) => t.table === "projects")) {
        const row = sqlite.prepare("select settings_json as s from projects where slug = ?").get(to) as { s: string } | undefined;
        if (row) {
          const r = o.registry(row.s);
          sqlite.prepare("update projects set settings_json = ?, hash = coalesce(?, hash) where slug = ?").run(r.settingsJson, r.hash ?? null, to);
        }
      }
      // every row moved? then nothing may remain under the old slug
      const left = cols.filter((c) => count(c, from) > 0).map((c) => c.table);
      if (left.length) throw new Error(`rows still under "${from}" in ${left.join(", ")}; rolled back`);
    });
    run.immediate();
    return { tables: tables.map(({ table, column, rows }) => ({ table, column, rows })), total, backup };
  } finally {
    sqlite.close();
  }
}

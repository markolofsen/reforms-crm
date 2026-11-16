import Database from "better-sqlite3";
import { existsSync } from "node:fs";

/** Draft counts per status from a database file, opened READ-ONLY (no migration, no WAL write, nothing created). `null` when the file is missing or unreadable. */
export function draftCountsReadOnly(path: string): Record<string, number> | null {
  if (!existsSync(path)) return null;
  let db: Database.Database | undefined;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    db.pragma("busy_timeout = 2000");
    const rows = db.prepare("select status, count(*) as n from drafts group by status").all() as { status: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

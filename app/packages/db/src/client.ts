import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hubPaths } from "@hub/config/paths";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };
export type DbHandle = { db: Db; close: () => void };

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, "../drizzle");

/** Default file: HUB_DB, else the instance database (`<home>/data/app.db`). The rule lives in `@hub/config/paths`. */
export function defaultDbPath(): string {
  return hubPaths().db;
}

/**
 * Opens SQLite with the settings the research asks for: WAL, busy_timeout, foreign keys,
 * and applies the committed SQL migrations. One writer process owns the file; the sync
 * driver is hidden behind the async repositories in `repos/`.
 */
export function openDb(path: string = defaultDbPath()): DbHandle {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return { db, close: () => sqlite.close() };
}

/**
 * The database for a reader that must never write (P51: `hub focus` and `hub mcp`): opened read-only, no migration, so a
 * write through the handle throws (SQLITE_READONLY) instead of being merely absent. The file must exist.
 */
/** `busyMs`: how long a read waits on a lock (default 2 s); the prompt hook passes a short one, it must never hold a prompt. */
export function openDbReadOnly(path: string = defaultDbPath(), o: { busyMs?: number } = {}): DbHandle {
  const sqlite = new Database(path, { readonly: true, fileMustExist: true });
  sqlite.pragma(`busy_timeout = ${Math.max(0, Math.round(o.busyMs ?? 2000))}`);
  const db = drizzle(sqlite, { schema });
  return { db, close: () => sqlite.close() };
}

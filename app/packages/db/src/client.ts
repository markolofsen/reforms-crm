import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hubPaths } from "@hub/config/paths";
import * as schema from "./schema";
import { errFields, ops } from "@hub/log/ops";

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };
export type DbHandle = { db: Db; close: () => void };

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, "../drizzle");

/** Default file: HUB_DB, else the instance database (`<home>/data/app.db`). The rule lives in `@hub/config/paths`. */
export function defaultDbPath(): string {
  return hubPaths().db;
}

/** How many migrations the file records as applied (Drizzle's own table); 0 before the first. */
function appliedMigrations(sqlite: Database.Database): number {
  try {
    const row: unknown = sqlite.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get();
    const n: unknown = row && typeof row === "object" ? Reflect.get(row, "n") : 0;
    return typeof n === "number" ? n : 0;
  } catch {
    return 0;
  }
}

/** How many migrations this core ships (its journal's entries). */
function shippedMigrations(): number {
  const journal: unknown = JSON.parse(readFileSync(resolve(migrationsFolder, "meta/_journal.json"), "utf8"));
  const entries: unknown = journal && typeof journal === "object" ? Reflect.get(journal, "entries") : [];
  return Array.isArray(entries) ? entries.length : 0;
}

/**
 * A database that has migrations still to apply, opened by a process that does not migrate (decision of P141, 2026-11-24): only the
 * Hub server applies migrations to an existing database, so a half-written migration in a working tree never reaches the live one
 * through a CLI command or an agent tool. The fix is one restart of the server.
 */
export class DbBehindError extends Error {
  constructor(readonly path: string, readonly pending: number) {
    super(`The database ${path} is ${pending} migration(s) behind this core: the Hub server applies them when it starts (restart it), then run this again.`);
    this.name = "DbBehindError";
  }
}

export interface OpenDbOptions {
  /**
   * Apply the pending migrations of an existing database. Only the server (`apps/server/src/main.ts`), `migrate-cli`, `seed-cli` and
   * the restore check pass it. A new database (no migration applied yet: a test's, a first install's) is always migrated.
   */
  migrate?: boolean;
}

/**
 * Opens SQLite with the settings the research asks for: WAL, busy_timeout, foreign keys,
 * and applies the committed SQL migrations. One writer process owns the file; the sync
 * driver is hidden behind the async repositories in `repos/`. An existing database that is behind is migrated only with
 * `migrate: true`; any other opener refuses it (`DbBehindError`) instead of running on a schema the code does not expect.
 */
export function openDb(path: string = defaultDbPath(), o: OpenDbOptions = {}): DbHandle {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");
  const db = drizzle(sqlite, { schema });
  const before = appliedMigrations(sqlite);
  const pending = shippedMigrations() - before;
  if (before > 0 && pending > 0 && !o.migrate) {
    sqlite.close();
    throw new DbBehindError(path, pending);
  }
  try {
    const t0 = Date.now();
    migrate(db, { migrationsFolder });
    // P137 L2: migrations that ran are one line (how many, how long); an open with nothing new says nothing.
    const after = appliedMigrations(sqlite);
    if (after > before && path !== ":memory:") ops("db").info("database migrations applied", { db: path, applied: after - before, total: after, ms: Date.now() - t0 });
  } catch (e) {
    // P86: a migration that fails stops whoever opened the database; the line says which file and why.
    ops("db").error("a database migration failed", { db: path, ...errFields(e, true) });
    sqlite.close();
    throw e;
  }
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

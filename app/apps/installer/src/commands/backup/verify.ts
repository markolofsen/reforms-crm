import { restoreCheck } from "@hub/db";
import { checkWatchBackup, watchBackupRoot } from "./watch-verify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Ctx } from "../../context";
import { BackupError, type Manifest, STAMP, type Target, checkManifest, listSnapshots, resolveTarget } from "./manifest";
import { type BackupResult } from "./snapshot";
export function restoreSnapshotDb(dir: string, manifest: Manifest): { problems: string[]; lines: string[] } {
  let root: string;
  try { root = watchBackupRoot(dir); }
  catch (error) { return { problems: [error instanceof Error ? error.message : "The snapshot recovery paths are unsafe"], lines: [] }; }
  const tmp = mkdtempSync(path.join(tmpdir(), "hub-restore-"));
  try {
    const r = restoreCheck(path.join(root, "data", "app.db"), tmp);
    if (r.before.integrity !== "ok") return { problems: [`data/app.db: integrity_check says ${r.before.integrity.slice(0, 120)}`], lines: [] };
    const problems: string[] = [];
    const rec = manifest.db;
    if (rec && (rec.tables !== r.before.tables || rec.rows !== r.before.rows)) problems.push(`data/app.db: restored copy has ${r.before.tables} tables and ${r.before.rows} rows, the manifest recorded ${rec.tables} and ${rec.rows}`);
    if (r.after.integrity !== "ok") problems.push(`data/app.db: integrity_check says ${r.after.integrity.slice(0, 120)} after the migrations`);
    if (r.after.dataRows !== r.before.dataRows) problems.push(`data/app.db: the migrations changed the row count from ${r.before.dataRows} to ${r.after.dataRows}`);
    if (!problems.length) problems.push(...checkWatchBackup(root, manifest.files));
    const counts = rec ? `matches the manifest (${rec.tables} tables, ${rec.rows} rows)` : `${r.before.tables} tables, ${r.before.rows} rows (this snapshot recorded no counts: nothing to compare with)`;
    return { problems, lines: [`data/app.db: restores into a temporary file, integrity_check ok, ${counts}; ${r.migrationsApplied} migration(s) applied on top, rows unchanged`] };
  } catch (e) {
    return { problems: [`data/app.db: cannot be restored: ${(e as Error).message.slice(0, 160)}`], lines: [] };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** Re-check a snapshot (default: the newest): manifest, every hash and size, then a real restore of the COPIED database into a temporary folder. Never opens the live database. */
export function verify(ctx: Ctx, which?: string): BackupResult {
  let t: Target;
  try { t = resolveTarget(ctx); } catch (e) { if (e instanceof BackupError) return { ok: false, lines: [e.message] }; throw e; }
  let dir: string;
  if (which) dir = STAMP.test(which) ? path.join(t.root, which) : path.resolve(which);
  else {
    const newest = listSnapshots(t.root)[0];
    if (!newest) return { ok: false, lines: [`no snapshot in ${t.root}: \`hub backup --apply\``] };
    dir = newest.dir;
  }
  const { manifest, problems } = checkManifest(dir);
  const lines = [`snapshot ${dir}`];
  if (manifest) {
    lines.push(`created ${manifest.created}, core ${manifest.core_version ?? "unknown"}, ${manifest.files.length} file(s) hashed`);
    if (manifest.files.some((f) => f.path === "data/app.db") && !problems.some((x) => x.startsWith("data/app.db"))) {
      const r = restoreSnapshotDb(dir, manifest);
      lines.push(...r.lines);
      problems.push(...r.problems);
    } else if (!problems.length && !manifest.files.some((f) => f.path === "data/app.db")) {
      problems.push(...checkWatchBackup(dir, manifest.files));
    }
  }
  if (problems.length) { lines.push(...problems.map((p) => `PROBLEM ${p}`)); return { ok: false, lines, dir }; }
  lines.push("all hashes match; the database was restored only into a temporary folder, which is removed; the live data was not opened");
  return { ok: true, lines, dir };
}

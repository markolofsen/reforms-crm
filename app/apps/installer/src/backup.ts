import { readInstanceConfig } from "@hub/config/instance";
// `hub backup` (decision 0023): a manual, dated snapshot of what the instance cannot get back from git.
// Dry run unless --apply. Never reads or copies a secret: only the NAMES in state/secrets/ go into the manifest (a directory listing),
// and the Notion dump is a child process that loads its own token. Restore is never run here; a snapshot is verified, not applied.
import { copyAndVerify, restoreCheck } from "@hub/db";
import { projectStore } from "@hub/projects";
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Ctx } from "./context";
import { readCoreVersion } from "@hub/config/core-version";

/** Snapshots kept; older ones are deleted by --apply (only folders with a valid manifest). */
export const KEEP = 14;
/** A snapshot older than this makes the doctor warn. */
export const MAX_AGE_DAYS = 7;
export const STAMP = /^\d{8}-\d{6}$/;
export const MANIFEST = "manifest.json";
/** A first dump reads every page at about 3 requests a second: a CRM of a few thousand pages needs well over 15 minutes. */
const DUMP_TIMEOUT_MS = 2 * 60 * 60_000; // only `--notion-dump` waits on one
const DAY = 864e5;
/** Where the instance config sits inside a snapshot. */
const CONFIG_IN_SNAPSHOT = "config/config.json";

export interface ManifestFile { path: string; sha256: string; size: number }
export interface Manifest {
  format: 1;
  created: string;
  instance: string;
  core_version: string | null;
  files: ManifestFile[];
  /** File NAMES the instance expects under state/secrets/. Contents are never read or copied. */
  secrets_expected: string[];
  /** Table and row counts of the copied `data/app.db` when the snapshot was made; the restore check compares the restored file with them. Absent in snapshots made before v0.6.13. */
  db?: { tables: number; rows: number };
  notion: { project: string; status: "copied" | "dumped" | "dumped-with-errors" | "skipped" | "failed"; detail: string }[];
}

export class BackupError extends Error {}

// ---- where ------------------------------------------------------------------------------------------------------------------------

/** realpath of the nearest existing ancestor plus the rest, so a symlinked or not-yet-created folder compares truthfully. */
export function realish(p: string): string {
  const abs = path.resolve(p);
  const rest: string[] = [];
  let cur = abs;
  for (;;) {
    if (existsSync(cur)) return path.join(realpathSync(cur), ...rest.reverse());
    const up = path.dirname(cur);
    if (up === cur) return abs;
    rest.push(path.basename(cur));
    cur = up;
  }
}
export const isInside = (child: string, parent: string): boolean => { const r = path.relative(parent, child); return r === "" || (!r.startsWith("..") && !path.isAbsolute(r)); };
/**
 * After a restart, Google Drive for desktop can expose the old mount beside the live one, named `GoogleDrive-<account> (dd.mm.yyyy hh:mm)`.
 * A snapshot written there is not in the live Drive. Returns the offending path component, or undefined. Judged on the name only: no owner path is known here.
 */
export const STALE_DRIVE_MOUNT = /^GoogleDrive-.* \(\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}\)$/;
export function staleDriveMount(p: string): string | undefined { return path.resolve(p).split(path.sep).find((part) => STALE_DRIVE_MOUNT.test(part)); }

export interface Target { root: string; instance: string }

/** The one snapshot folder (default `<instance>/backups/`, git-ignored), from config/config.json. Throws BackupError for a folder inside state/ (the secrets) or the core checkout. */
export function resolveTarget(ctx: Ctx): Target {
  const cfg = readInstanceConfig(ctx.paths).config;
  const instance = path.basename(ctx.paths.home);
  let root: string;
  if (cfg.backup_dir === undefined || cfg.backup_dir === null || cfg.backup_dir === "") root = path.join(ctx.paths.home, "backups");
  else {
    if (typeof cfg.backup_dir !== "string") throw new BackupError("backup_dir in config/config.json must be a path (a string)");
    // A relative path is resolved from the instance folder (`../shared-backups` works); an absolute path is used as is. No `~`.
    root = path.resolve(ctx.paths.home, cfg.backup_dir.trim());
  }
  root = path.resolve(root);
  const stale = staleDriveMount(root) ?? staleDriveMount(realish(root));
  if (stale) throw new BackupError(`the backup folder ${root} lies under "${stale}", a stale Google Drive mount (its dated name appears after a restart): a snapshot made there is NOT in your live Drive. Set backup_dir in config/config.json to the same folder under the live mount, the GoogleDrive-<account> folder without the date`);
  for (const [label, area] of [["state/", ctx.paths.state], ["the core checkout", ctx.paths.core]] as const) {
    if (isInside(realish(root), realish(area))) throw new BackupError(`the backup folder ${root} is inside ${label} (${area}): secrets live there and the core is another repository. Use the default backups/ or another folder outside state/ and the core`);
  }
  return { root, instance };
}

/**
 * A snapshot folder inside the instance must never reach git: it holds client data. Returns a problem line when `root` lies inside the instance
 * and is tracked or not ignored; undefined when it is safe (outside the instance, ignored, or the instance is not a git repository).
 */
export async function gitGuard(ctx: Ctx, root: string): Promise<string | undefined> {
  if (!isInside(realish(root), realish(ctx.paths.home))) return undefined;
  const git = (args: string[]) => ctx.run("git", ["-C", ctx.paths.home, ...args], { timeoutMs: 30_000 });
  if ((await git(["rev-parse", "--git-dir"])).code !== 0) return undefined;
  const rel = path.relative(realish(ctx.paths.home), realish(root)).split(path.sep).join("/");
  const tracked = await git(["ls-files", "--", rel]);
  if (tracked.stdout.trim()) return `${tracked.stdout.trim().split("\n").length} file(s) under ${rel}/ are tracked by git (client data in a repository): \`git rm -r --cached ${rel}\`, then ignore it`;
  const ignored = await git(["check-ignore", "-q", "--", `${rel}/x`]);
  if (ignored.code !== 0) return `${rel}/ is not ignored by git: add \`${rel}/\` to the instance .gitignore before any snapshot is written`;
  return undefined;
}

// ---- files ------------------------------------------------------------------------------------------------------------------------

export function sha256File(file: string): string {
  const h = createHash("sha256");
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(1 << 20);
    for (let n = readSync(fd, buf, 0, buf.length, null); n > 0; n = readSync(fd, buf, 0, buf.length, null)) h.update(buf.subarray(0, n));
  } finally { closeSync(fd); }
  return h.digest("hex");
}

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(f, base));
    else if (e.isFile()) out.push(path.relative(base, f).split(path.sep).join("/"));
  }
  return out.sort();
}

export function readManifest(dir: string): Manifest | undefined {
  try {
    const m = JSON.parse(readFileSync(path.join(dir, MANIFEST), "utf8")) as Partial<Manifest>;
    if (m.format !== 1 || typeof m.created !== "string" || !Array.isArray(m.files) || !Array.isArray(m.secrets_expected)) return undefined;
    return m as Manifest;
  } catch { return undefined; }
}

export interface Snapshot { name: string; dir: string; manifest: Manifest }
/** Complete snapshots (a dated folder with a valid manifest), newest first. A `.partial` folder or one without a manifest is not a snapshot. */
export function listSnapshots(root: string): Snapshot[] {
  if (!existsSync(root)) return [];
  const out: Snapshot[] = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || !STAMP.test(e.name)) continue;
    const dir = path.join(root, e.name);
    const manifest = readManifest(dir);
    if (manifest) out.push({ name: e.name, dir, manifest });
  }
  return out.sort((a, b) => b.name.localeCompare(a.name));
}
const stampOf = (d: Date): string => { const p = (n: number, w = 2) => String(n).padStart(w, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
const dateOf = (d: Date): string => { const s = stampOf(d); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };
const kb = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Recompute every hash and size against the manifest. Reads the snapshot only. */
export function checkManifest(dir: string): { manifest?: Manifest; problems: string[] } {
  const manifest = readManifest(dir);
  if (!manifest) return { problems: [`${path.join(dir, MANIFEST)} is missing or not a valid manifest`] };
  const problems: string[] = [];
  const have = new Set(walk(dir).filter((f) => f !== MANIFEST));
  for (const f of manifest.files) {
    const file = path.join(dir, f.path);
    if (f.path.startsWith("/") || f.path.split("/").includes("..")) { problems.push(`${f.path}: unsafe path in the manifest`); continue; }
    if (!have.delete(f.path)) { problems.push(`${f.path}: listed in the manifest, missing from the snapshot`); continue; }
    if (statSync(file).size !== f.size) problems.push(`${f.path}: size ${statSync(file).size} differs from the recorded ${f.size}`);
    else if (sha256File(file) !== f.sha256) problems.push(`${f.path}: sha256 differs from the manifest`);
  }
  for (const extra of have) problems.push(`${extra}: in the snapshot but not in the manifest`);
  return { manifest, problems };
}

// ---- plan and apply ---------------------------------------------------------------------------------------------------------------

export interface BackupResult { ok: boolean; lines: string[]; dir?: string; bytes?: number }

function notionProjects(ctx: Ctx) {
  return projectStore({ projects: ctx.paths.projects }).list().filter((p) => p.parsed.config.status !== "archived" && p.parsed.config.notion.databases.length > 0);
}
/** Names of the secret files the instance expects. A directory listing: no file is opened. */
export function secretNames(ctx: Ctx): string[] {
  const names = new Set<string>();
  try { for (const e of readdirSync(ctx.configDir, { withFileTypes: true })) if (e.isFile()) names.add(e.name); } catch { /* no secrets folder yet */ }
  for (const p of notionProjects(ctx)) names.add(p.parsed.config.notion.tokenFile);
  return [...names].sort();
}

const tokenPresent = (ctx: Ctx, file: string): boolean => existsSync(path.join(ctx.configDir, file));

export interface BackupOptions {
  apply: boolean;
  now?: Date;
  /** Run a live `notion-dump` into the snapshot first (minutes to hours for a big CRM). Default: copy the newest dump that already exists. */
  notionDump?: boolean;
}

export interface DumpFound { date: string; dir: string; ageDays: number; errors: number }
const DATED = /^\d{4}-\d{2}-\d{2}$/;
/** The newest complete dump (a dated folder with a readable manifest.json) under `<project>/dumps/`. */
export function newestDump(projectFolder: string, now = Date.now()): DumpFound | undefined {
  const root = path.join(projectFolder, "dumps");
  if (!existsSync(root)) return undefined;
  for (const name of readdirSync(root).filter((n) => DATED.test(n)).sort().reverse()) {
    try {
      const m = JSON.parse(readFileSync(path.join(root, name, MANIFEST), "utf8")) as { date?: string; totals?: { errors?: number } };
      const date = DATED.test(m.date ?? "") ? m.date! : name;
      return { date, dir: path.join(root, name), ageDays: Math.floor((now - Date.parse(`${date}T00:00:00Z`)) / DAY), errors: m.totals?.errors ?? 0 };
    } catch { /* no readable manifest: an unfinished dump, skip it */ }
  }
  return undefined;
}
const fixLine = (p: { slug: string; folder: string }) => `fix: \`pnpm --filter @hub/notion notion-dump dump ${p.folder}\`, or \`hub backup --apply --notion-dump\``;

export async function backup(ctx: Ctx, opts: BackupOptions): Promise<BackupResult> {
  let t: Target;
  try { t = resolveTarget(ctx); } catch (e) { if (e instanceof BackupError) return { ok: false, lines: [e.message] }; throw e; }
  const unsafe = await gitGuard(ctx, t.root);
  if (unsafe) return { ok: false, lines: [`refusing to run: ${unsafe}`] };
  const now = opts.now ?? new Date();
  const stamp = stampOf(now);
  const final = path.join(t.root, stamp);
  const stage = path.join(t.root, `${stamp}.partial`);
  const lines: string[] = [];
  if (existsSync(final) || existsSync(stage)) return { ok: false, lines: [`${existsSync(final) ? final : stage} already exists: a snapshot is never overwritten. Wait a second and run again`] };

  const projects = notionProjects(ctx);
  const existing = listSnapshots(t.root);
  const doomed = existing.slice(KEEP - 1);
  const tsx = path.join(ctx.paths.core, "app", "packages", "notion", "node_modules", ".bin", "tsx");
  const cli = path.join(ctx.paths.core, "app", "packages", "notion", "src", "cli.ts");

  if (!opts.apply) {
    lines.push(`dry run: nothing is written (add --apply)`, `snapshot folder: ${final}`);
    lines.push(existsSync(ctx.paths.db) ? `- data/app.db: VACUUM INTO copy, then integrity_check (${kb(statSync(ctx.paths.db).size)} live)` : "- data/app.db: does not exist yet, skipped");
    lines.push(existsSync(ctx.paths.configFile) ? "- config/config.json: copied" : "- config/config.json: does not exist, skipped");
    if (!projects.length) lines.push("- notion: no project lists databases, nothing to copy");
    for (const p of projects) {
      const d = newestDump(p.folder, now.getTime());
      const live = opts.notionDump && tokenPresent(ctx, p.parsed.config.notion.tokenFile);
      if (live) lines.push(`- notion ${p.slug}: LIVE dump of ${p.parsed.config.notion.databases.length} database(s) first (read only; minutes to hours)`);
      else if (d) lines.push(`- notion ${p.slug}: copy the newest dump ${d.date} (${d.ageDays} day(s) old${d.ageDays > MAX_AGE_DAYS ? `, WARN: over ${MAX_AGE_DAYS} days; ${fixLine(p)}` : ""})`);
      else lines.push(`- notion ${p.slug}: no dump exists yet, nothing to copy; ${fixLine(p)}`);
    }
    const names = secretNames(ctx);
    lines.push(`- manifest.json: timestamp, core ${readCoreVersion(ctx.paths.home) ?? "unknown"}, instance ${t.instance}, sha256 and size of every file; secret file NAMES only (${names.length ? names.join(", ") : "none"}); no secret is read or copied`);
    lines.push(doomed.length ? `- retention: keep the newest ${KEEP}; would delete ${doomed.map((s) => s.name).join(", ")}` : `- retention: keep the newest ${KEEP}; ${existing.length} snapshot(s) exist, nothing to delete`);
    return { ok: true, lines, dir: final };
  }

  mkdirSync(t.root, { recursive: true, mode: 0o700 });
  mkdirSync(stage, { mode: 0o700 });
  let ok = true;
  let dbCounts: { tables: number; rows: number } | undefined;
  try {
    if (existsSync(ctx.paths.db)) {
      mkdirSync(path.join(stage, "data"));
      const c = copyAndVerify(ctx.paths.db, path.join(stage, "data"), "app.db");
      if (c.integrity !== "ok") throw new BackupError(`the copy of data/app.db fails its integrity check (${c.integrity.slice(0, 120)}): no snapshot made; keep data/app.db and its -wal file as they are`);
      dbCounts = { tables: c.tables, rows: c.rows };
      lines.push(`data/app.db: copied (${kb(c.bytes)}), integrity_check ok, ${c.tables} tables, ${c.rows} rows`);
    } else lines.push("data/app.db: does not exist yet, skipped");
    if (existsSync(ctx.paths.configFile)) {
      const dest = path.join(stage, CONFIG_IN_SNAPSHOT);
      mkdirSync(path.dirname(dest));
      copyFileSync(ctx.paths.configFile, dest);
      lines.push("config/config.json: copied");
    }

    const notion: Manifest["notion"] = [];
    for (const p of projects) {
      const tokenFile = p.parsed.config.notion.tokenFile;
      if (opts.notionDump && !tokenPresent(ctx, tokenFile)) lines.push(`notion ${p.slug}: --notion-dump skipped, no ${tokenFile} in state/secrets (store it with \`hub token notion\`); copying the newest existing dump instead`);
      else if (opts.notionDump) {
        const r = await ctx.run(tsx, [cli, "dump", p.folder, "--out", path.join(stage, "projects", p.slug, "dumps"), "--date", dateOf(now), "--token-file", tokenFile], { env: { HOME: ctx.home, HUB_HOME: ctx.paths.home, HUB_CONFIG_DIR: ctx.configDir }, timeoutMs: DUMP_TIMEOUT_MS });
        const last = r.stderr.trim().split("\n").at(-1)?.slice(0, 160) ?? "";
        if (r.code === 0) { notion.push({ project: p.slug, status: "dumped", detail: r.stdout.split("\n")[0] ?? "" }); lines.push(`notion ${p.slug}: ${r.stdout.split("\n")[0]}`); }
        else if (r.code === 2) { ok = false; notion.push({ project: p.slug, status: "dumped-with-errors", detail: last }); lines.push(`notion ${p.slug}: dumped with database errors (see notion.access): ${last}`); }
        else {
          const cut = r.code === 124 || r.code === 143; // the runner's timeout kills the dump with SIGTERM
          ok = false;
          notion.push({ project: p.slug, status: "failed", detail: cut ? `cut off after ${DUMP_TIMEOUT_MS / 60_000} minutes` : `exit ${r.code}: ${last}` });
          lines.push(cut ? `notion ${p.slug}: dump cut off after ${DUMP_TIMEOUT_MS / 60_000} minutes (the files written are partial)` : `notion ${p.slug}: dump failed (exit ${r.code}): ${last}`);
        }
        continue;
      }
      const d = newestDump(p.folder, now.getTime());
      if (!d) { notion.push({ project: p.slug, status: "skipped", detail: "no dump exists yet" }); lines.push(`notion ${p.slug}: WARN no dump exists yet, nothing copied; ${fixLine(p)}`); continue; }
      cpSync(d.dir, path.join(stage, "projects", p.slug, "dumps", path.basename(d.dir)), { recursive: true });
      notion.push({ project: p.slug, status: "copied", detail: `dump ${d.date}, ${d.ageDays} day(s) old${d.errors ? `, ${d.errors} database error(s)` : ""}` });
      lines.push(`notion ${p.slug}: copied dump ${d.date} (${d.ageDays} day(s) old${d.errors ? `, with ${d.errors} database error(s)` : ""})${d.ageDays > MAX_AGE_DAYS ? ` WARN: older than ${MAX_AGE_DAYS} days; ${fixLine(p)}` : ""}`);
    }

    const files: ManifestFile[] = walk(stage).map((f) => ({ path: f, sha256: sha256File(path.join(stage, f)), size: statSync(path.join(stage, f)).size }));
    const manifest: Manifest = { format: 1, created: now.toISOString(), instance: t.instance, core_version: readCoreVersion(ctx.paths.home) ?? null, files, secrets_expected: secretNames(ctx), ...(dbCounts ? { db: dbCounts } : {}), notion };
    writeFileSync(path.join(stage, MANIFEST), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
    renameSync(stage, final);
  } catch (e) {
    rmSync(stage, { recursive: true, force: true });
    return { ok: false, lines: [...lines, `no snapshot made: ${(e as Error).message}`] };
  }
  const total = walk(final).reduce((n, f) => n + statSync(path.join(final, f)).size, 0);
  lines.push(`snapshot ${final} (${kb(total)})`);

  for (const s of doomed) { rmSync(s.dir, { recursive: true, force: true }); lines.push(`retention: deleted ${s.name}`); }
  return { ok, lines, dir: final, bytes: total };
}

// ---- verify -----------------------------------------------------------------------------------------------------------------------

/**
 * Restore the snapshot's `data/app.db` into a temporary folder (copy, open with the current migrations, integrity_check, counts) and compare with the manifest.
 * `problems` is empty when the database restores: the same tables and rows as recorded, nothing lost by the migrations. Only the temporary folder is written, and it is removed.
 */
export function restoreSnapshotDb(dir: string, manifest: Manifest): { problems: string[]; lines: string[] } {
  const tmp = mkdtempSync(path.join(tmpdir(), "hub-restore-"));
  try {
    const r = restoreCheck(path.join(dir, "data", "app.db"), tmp);
    if (r.before.integrity !== "ok") return { problems: [`data/app.db: integrity_check says ${r.before.integrity.slice(0, 120)}`], lines: [] };
    const problems: string[] = [];
    const rec = manifest.db;
    if (rec && (rec.tables !== r.before.tables || rec.rows !== r.before.rows)) problems.push(`data/app.db: restored copy has ${r.before.tables} tables and ${r.before.rows} rows, the manifest recorded ${rec.tables} and ${rec.rows}`);
    if (r.after.integrity !== "ok") problems.push(`data/app.db: integrity_check says ${r.after.integrity.slice(0, 120)} after the migrations`);
    if (r.after.dataRows !== r.before.dataRows) problems.push(`data/app.db: the migrations changed the row count from ${r.before.dataRows} to ${r.after.dataRows}`);
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
    }
  }
  if (problems.length) { lines.push(...problems.map((p) => `PROBLEM ${p}`)); return { ok: false, lines, dir }; }
  lines.push("all hashes match; the database was restored only into a temporary folder, which is removed; the live data was not opened");
  return { ok: true, lines, dir };
}

export const ageDays = (m: Manifest, now = Date.now()): number => Math.floor((now - Date.parse(m.created)) / DAY);

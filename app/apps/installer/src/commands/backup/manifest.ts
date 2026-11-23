import { readInstanceConfig } from "@hub/config/instance";
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { Ctx } from "../../context";

/** Snapshots kept; older ones are deleted by --apply (only folders with a valid manifest). */
export const KEEP = 14;
/** A snapshot older than this makes the doctor warn. */
export const MAX_AGE_DAYS = 7;
export const STAMP = /^\d{8}-\d{6}$/;
export const MANIFEST = "manifest.json";
/** A first dump reads every page at about 3 requests a second: a CRM of a few thousand pages needs well over 15 minutes. */
export const DUMP_TIMEOUT_MS = 2 * 60 * 60_000; // only `--notion-dump` waits on one
export const DAY = 864e5;
/** Where the instance config sits inside a snapshot. */
export const CONFIG_IN_SNAPSHOT = "config/config.json";

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

export function walk(dir: string, base = dir): string[] {
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
export const stampOf = (d: Date): string => { const p = (n: number, w = 2) => String(n).padStart(w, "0"); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
export const dateOf = (d: Date): string => { const s = stampOf(d); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };
export const kb = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

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


export const ageDays = (m: Manifest, now = Date.now()): number => Math.floor((now - Date.parse(m.created)) / DAY);

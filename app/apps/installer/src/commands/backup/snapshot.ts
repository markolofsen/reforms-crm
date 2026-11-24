import { copyAndVerify } from "@hub/db";
import { projectStore } from "@hub/projects/store";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Ctx } from "../../context";
import { readCoreVersion } from "@hub/config/core-version";
import { ops } from "@hub/log/ops";
import { BackupError, CONFIG_IN_SNAPSHOT, DAY, DUMP_TIMEOUT_MS, KEEP, MANIFEST, MAX_AGE_DAYS, type Manifest, type ManifestFile, type Target, dateOf, gitGuard, kb, listSnapshots, resolveTarget, sha256File, stampOf, walk } from "./manifest";
// `hub backup` (decision 0023): a manual, dated snapshot of what the instance cannot get back from git.
// Dry run unless --apply. Never reads or copies a secret: only the NAMES in state/secrets/ go into the manifest (a directory listing),
// and the Notion dump is a child process that loads its own token. Restore is never run here; a snapshot is verified, not applied.
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

/** P137 L2: a backup run that wrote (`--apply`) is one line at its outcome; a dry run says nothing. */
export async function backup(ctx: Ctx, opts: BackupOptions): Promise<BackupResult> {
  const t0 = Date.now();
  const r = await snapshot(ctx, opts);
  if (opts.apply) {
    const log = ops("installer", { fileOnly: true });
    if (r.ok) log.info("backup snapshot made", { bytes: r.bytes ?? null, ms: Date.now() - t0 });
    else log.error("backup failed: no snapshot made", { reason: r.lines.at(-1)?.slice(0, 300) ?? null, ms: Date.now() - t0 });
  }
  return r;
}

async function snapshot(ctx: Ctx, opts: BackupOptions): Promise<BackupResult> {
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

// The backup.* steps. Strictly read only and non-destructive: no push, no dump, no restore, no write to the database or to Notion.
// Each step PROVES something a backup needs and names the fix; none of them makes a backup (`git push` and `notion-dump dump` do).
import { copyAndVerify } from "@hub/db";
import { fileState, readValue } from "@hub/connections";
import { loadProjects, type LoadedProject } from "@hub/projects";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ageDays, checkManifest, isRemote, listSnapshots, gitGuard, MAX_AGE_DAYS as SNAPSHOT_MAX_AGE_DAYS, resolveTarget, BackupError } from "../backup.ts";
import { readJson, type Ctx } from "../context.ts";
import type { CheckResult, Step } from "../types.ts";
import { fail, pass, warn } from "./helpers.ts";

/** A dump older than this is not a backup the owner can lean on. */
export const MAX_DUMP_AGE_DAYS = 7;
const DAY = 864e5;
const DATED = /^\d{4}-\d{2}-\d{2}$/;
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

// ---- backup.git -------------------------------------------------------------------------------------------------------------------

/** git needs HOME and the ssh agent to reach `origin`; the runner passes nothing else. Never prompts. */
const gitEnv = (ctx: Ctx): Record<string, string> => ({ HOME: ctx.home, GIT_TERMINAL_PROMPT: "0", ...(process.env.SSH_AUTH_SOCK ? { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK } : {}) });

/** One repository: is its HEAD commit on `origin`? Returns a problem line, a note (cannot tell), or undefined when proven. */
async function headIsPushed(ctx: Ctx, name: string, dir: string): Promise<{ problem?: string; note?: string }> {
  const git = (args: string[], timeoutMs = 30_000) => ctx.run("git", ["-C", dir, ...args], { env: gitEnv(ctx), timeoutMs });
  const head = await git(["rev-parse", "HEAD"]);
  if (head.code !== 0) return { problem: `${name}: ${dir} is not a git repository with a commit` };
  const sha = head.stdout.trim();
  const remote = await git(["remote", "get-url", "origin"]);
  if (remote.code !== 0) return { problem: `${name}: no \`origin\` remote, so nothing is off this machine: \`git -C ${dir} remote add origin <private repo>\` and push` };
  const refs = await git(["ls-remote", "origin"]);
  if (refs.code !== 0) return { note: `${name}: cannot reach origin, so the push is not proven` };
  const tips = refs.stdout.split("\n").map((l) => l.split(/\s+/)[0] ?? "").filter((s) => /^[0-9a-f]{40}$/.test(s));
  if (tips.includes(sha)) return {};
  // A pinned core can sit behind the tip of its branch: HEAD is pushed when it is an ancestor of a tip we already hold.
  for (const tip of new Set(tips)) {
    if ((await git(["cat-file", "-e", `${tip}^{commit}`])).code !== 0) continue;
    if ((await git(["merge-base", "--is-ancestor", sha, tip])).code === 0) return {};
  }
  return { problem: `${name}: HEAD ${sha.slice(0, 9)} is not on origin: \`git -C ${dir} push\`` };
}

export async function backupGitCheck(ctx: Ctx): Promise<CheckResult> {
  const extra = readJson<{ backup_repos?: unknown }>(ctx.paths.configFile)?.backup_repos;
  const repos: [string, string][] = [["instance", ctx.paths.home], ["core", ctx.paths.core]];
  if (Array.isArray(extra)) for (const e of extra) if (typeof e === "string" && e.trim()) repos.push([path.basename(path.resolve(ctx.paths.home, e)), path.resolve(ctx.paths.home, e)]);
  const problems: string[] = [];
  const notes: string[] = [];
  for (const [name, dir] of repos) {
    const r = await headIsPushed(ctx, name, dir);
    if (r.problem) problems.push(r.problem);
    if (r.note) notes.push(r.note);
  }
  if (problems.length) return fail(problems.join("; "));
  if (notes.length) return warn(notes.join("; "));
  return pass(`HEAD of ${repos.map(([n]) => n).join(", ")} is on origin`);
}

// ---- backup.db --------------------------------------------------------------------------------------------------------------------

export async function backupDbCheck(ctx: Ctx): Promise<CheckResult> {
  if (!existsSync(ctx.paths.db)) return warn(`${path.relative(ctx.paths.home, ctx.paths.db) || ctx.paths.db} does not exist yet: nothing to back up (see files.app-db)`);
  const tmp = mkdtempSync(path.join(tmpdir(), "hub-backup-check-"));
  try {
    const c = copyAndVerify(ctx.paths.db, tmp);
    if (c.integrity !== "ok") return fail(`a copy of the app database fails its integrity check: ${c.integrity.slice(0, 120)}. Stop the server, keep data/app.db and its -wal file as they are and restore the last good copy`);
    return pass(`VACUUM INTO copy (${kb(c.bytes)}) passes integrity_check: ${c.tables} tables, ${c.rows} rows; the temporary copy is removed`);
  } catch (e) {
    return fail(`cannot copy the app database: ${(e as Error).message.slice(0, 160)}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- backup.notion ----------------------------------------------------------------------------------------------------------------

interface Newest { date: string; ageDays: number; errors: number }

function newestDump(folder: string): Newest | undefined {
  const dir = path.join(folder, "dumps");
  if (!existsSync(dir)) return undefined;
  for (const name of readdirSync(dir).filter((n) => DATED.test(n)).sort().reverse()) {
    try {
      const m = JSON.parse(readFileSync(path.join(dir, name, "manifest.json"), "utf8")) as { date?: string; totals?: { errors?: number } };
      const date = DATED.test(m.date ?? "") ? m.date! : name;
      return { date, ageDays: Math.floor((Date.now() - Date.parse(`${date}T00:00:00Z`)) / DAY), errors: m.totals?.errors ?? 0 };
    } catch { /* a folder without a readable manifest is an unfinished dump: skip it */ }
  }
  return undefined;
}

export async function backupNotionCheck(ctx: Ctx): Promise<CheckResult> {
  const projects = loadProjects(ctx.paths.projects).filter((p) => p.parsed.config.status !== "archived" && p.parsed.config.notion.databases.length > 0);
  if (!projects.length) return pass("no project lists Notion databases: nothing to dump");
  const problems: string[] = [];
  const fresh: { p: LoadedProject; d: Newest }[] = [];
  for (const p of projects) {
    const d = newestDump(p.folder);
    if (!d) problems.push(`${p.slug}: no complete dump (needs the Notion token): \`pnpm --filter @hub/notion notion-dump dump ${p.folder}\``);
    else if (d.errors > 0) problems.push(`${p.slug}: the dump of ${d.date} has ${d.errors} database error(s): fix access (notion.access), then dump again`);
    else if (d.ageDays > MAX_DUMP_AGE_DAYS) problems.push(`${p.slug}: newest dump is ${d.ageDays} days old (limit ${MAX_DUMP_AGE_DAYS}): dump again`);
    else fresh.push({ p, d });
  }
  if (problems.length) return fail(problems.join("; "));

  // Restorable: the dry run reads the dump and the live databases and says what a restore would do. It never writes to Notion.
  const tsx = path.join(ctx.paths.core, "app", "packages", "notion", "node_modules", ".bin", "tsx");
  const cli = path.join(ctx.paths.core, "app", "packages", "notion", "src", "cli.ts");
  const skipped: string[] = [];
  for (const { p } of fresh) {
    const tokenFile = p.parsed.config.notion.tokenFile;
    const token = readValue(ctx.configDir, tokenFile);
    if (!token) { skipped.push(p.slug); continue; }
    const r = await ctx.run(tsx, [cli, "restore", p.folder, "--dry-run"], { env: { HOME: ctx.home, HUB_HOME: ctx.paths.home, HUB_CONFIG_DIR: ctx.configDir, NOTION_TOKEN: token }, timeoutMs: 180_000 });
    if (r.code === 124) return warn(`${p.slug}: restore --dry-run did not finish in 180 s: not proven`);
    if (r.code !== 0) return fail(`${p.slug}: restore --dry-run exited ${r.code}${r.code === 2 ? " (a database cannot be read: see notion.access)" : ""}: ${r.stderr.trim().split("\n").at(-1)?.slice(0, 160) ?? "no output"}`);
  }
  const ages = fresh.map(({ p, d }) => `${p.slug} ${d.date}`).join(", ");
  return skipped.length
    ? warn(`newest dumps are fresh and error-free (${ages}); restore --dry-run not run for ${skipped.join(", ")}: no Notion token to read the live databases with`)
    : pass(`newest dumps are fresh and error-free (${ages}); restore --dry-run passes`);
}

// ---- backup.secrets ---------------------------------------------------------------------------------------------------------------

export async function backupSecretsCheck(ctx: Ctx): Promise<CheckResult> {
  const dir = ctx.configDir;
  if (!existsSync(dir)) return fail(`${dir} does not exist: \`hub install --only files.dirs\``);
  const problems: string[] = [];
  const mode = statSync(dir).mode & 0o777;
  if (mode & 0o077) problems.push(`the secrets folder is mode ${mode.toString(8)}, must be 700: \`chmod 700 ${dir}\``);
  const names = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
  const loose = names.filter((n) => (statSync(path.join(dir, n)).mode & 0o077) !== 0);
  if (loose.length) problems.push(`readable by others, must be 600: ${loose.join(", ")} (\`chmod 600 <file>\` in ${dir})`);
  // A project that names its own token file needs it (the shared token is optional: manual sessions use the connector).
  const own = [...new Set(loadProjects(ctx.paths.projects).filter((p) => p.parsed.config.notion.databases.length > 0).map((p) => p.parsed.config.notion.tokenFile).filter((f) => f !== "notion-token"))];
  const missing = own.filter((f) => fileState(dir, f).state === "missing");
  if (missing.length) problems.push(`named by a project but missing: ${missing.join(", ")}`);
  if (problems.length) return fail(problems.join("; "));
  return pass(names.length ? `${names.length} secret file(s), all mode 600 in a mode 700 folder: ${names.join(", ")}` : "folder is mode 700 and holds no secret yet");
}

// ---- backup.snapshot --------------------------------------------------------------------------------------------------------------

/** Device id of the nearest existing folder at or above `p`. */
const deviceOf = (p: string): number | undefined => {
  for (let cur = path.resolve(p); ; cur = path.dirname(cur)) {
    try { return statSync(cur).dev; } catch { if (path.dirname(cur) === cur) return undefined; }
  }
};

export async function backupSnapshotCheck(ctx: Ctx): Promise<CheckResult> {
  let t: ReturnType<typeof resolveTarget>;
  try { t = resolveTarget(ctx); } catch (e) { if (e instanceof BackupError) return fail(e.message); throw e; }
  const problems: string[] = [];
  const warnings: string[] = [];
  const unsafe = await gitGuard(ctx, t.root);
  if (unsafe) problems.push(unsafe);
  const facts: string[] = [];
  const snaps = listSnapshots(t.root);
  const fresh = !existsSync(ctx.paths.db);
  if (!snaps.length) {
    const msg = `no snapshot in ${t.root}: \`hub backup --apply\``;
    (fresh ? warnings : problems).push(fresh ? `${msg} (a fresh instance has nothing to back up yet)` : msg);
  } else {
    const newest = snaps[0]!;
    const age = ageDays(newest.manifest);
    if (age > SNAPSHOT_MAX_AGE_DAYS) warnings.push(`newest snapshot ${newest.name} is ${age} days old (limit ${SNAPSHOT_MAX_AGE_DAYS}): \`hub backup --apply\``);
    const bad = checkManifest(newest.dir).problems;
    if (bad.length) problems.push(`snapshot ${newest.name} does not match its manifest: ${bad.slice(0, 3).join("; ")}${bad.length > 3 ? `; and ${bad.length - 3} more` : ""}`);
    else facts.push(`newest snapshot ${newest.name} (${age} day(s) old), manifest hashes valid`);
  }
  // A copy on the same volume as the data does not survive that volume. A reachable second copy on another volume (or a remote one) makes up for it.
  let copyOk = false;
  if (t.copyTo) {
    if (isRemote(t.copyTo)) {
      const r = await ctx.run("rsync", ["--list-only", `${t.copyTo.replace(/\/+$/, "")}/`], { env: { HOME: ctx.home, ...(process.env.SSH_AUTH_SOCK ? { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK } : {}) }, timeoutMs: 30_000 });
      if (r.code === 0) { copyOk = true; facts.push(`backup_copy_to ${t.copyTo} is reachable`); } else warnings.push(`backup_copy_to ${t.copyTo} is not reachable (rsync exit ${r.code}): the second copy is not proven`);
    } else if (existsSync(t.copyTo) && statSync(t.copyTo).isDirectory()) {
      facts.push(`backup_copy_to ${t.copyTo} is reachable`);
      // The owner named this folder as the off-disk copy. A cloud-drive folder (Google Drive, iCloud) reports the system disk's device id, so the device cannot judge it: reachable means proven.
      copyOk = true;
    } else warnings.push(`backup_copy_to ${t.copyTo} does not exist (drive not mounted?): the second copy is not proven`);
  }
  const same = deviceOf(t.root) !== undefined && deviceOf(t.root) === deviceOf(ctx.paths.db);
  if (same && !copyOk) warnings.push(`the backup folder ${t.root} is on the same volume as the data: a dead disk takes both. Set backup_copy_to in config/config.json for an off-disk copy (or backup_dir on an external drive or in iCloud Drive)`);
  else if (!same) facts.push("backup folder is on another volume than the data");
  if (problems.length) return fail([...problems, ...warnings].join("; "));
  if (warnings.length) return warn([...warnings, ...facts].join("; "));
  return pass(facts.join("; "));
}

// -----------------------------------------------------------------------------------------------------------------------------------

export const backupSteps: Step[] = [
  {
    id: "backup.git", group: "Backup", title: "Code and instance are pushed off this machine",
    why: "The instance (projects, knowledge, config) and the core pin live in git. A commit that exists only on this laptop is lost with it.",
    verifies: "For the instance and the core (and any path listed in `backup_repos` of `config/config.json`): an `origin` remote exists and the local HEAD commit is on it (`git ls-remote origin`: the tip, or an ancestor of a tip already fetched). FAIL: no origin, or HEAD not pushed. WARN: origin cannot be reached. Nothing is pushed.",
    manual: { steps: ["No remote: create a PRIVATE repository, `git remote add origin <url>`, then push.", "HEAD not on origin: `git push` (for the core, push the commit the instance pins).", "Other repositories to watch (for example the plan repository): list their paths in `backup_repos` in `config/config.json`."] },
    check: backupGitCheck,
  },
  {
    id: "backup.db", group: "Backup", title: "The app database can be copied and the copy is sound",
    why: "`data/app.db` holds marks, the queue and the run log and is not in git. Its copy must open and pass SQLite's own check, or the copy is not a backup.",
    verifies: "`data/app.db` is opened READ-ONLY, `VACUUM INTO` writes a copy into a temporary folder, the copy passes `PRAGMA integrity_check` and its rows are counted; the temporary folder is then removed. The live file is never written. It proves a good copy is possible, not that one is kept: copy `data/app.db` somewhere off the machine yourself.",
    manual: { steps: ["Integrity failure: stop the server (`hub up` window), keep `data/app.db` and `data/app.db-wal` untouched and restore the last good copy.", "Keep a regular off-machine copy: `sqlite3 data/app.db \"VACUUM INTO '<folder>/app-<date>.db'\"` (safe while the server runs)."] },
    check: backupDbCheck,
  },
  {
    id: "backup.notion", group: "Backup", title: "The Notion dump is recent and restorable",
    why: "Notion is the CRM's source of truth and the only copy of its rows. `notion-dump` writes a dated copy under `projects/<slug>/dumps/`; a dump nobody can restore from is not a backup.",
    verifies: `For every project that lists Notion databases: the newest dump (a folder with \`manifest.json\`) is at most ${MAX_DUMP_AGE_DAYS} days old and recorded no database error, and \`notion-dump restore <project> --dry-run\` passes (it reads the dump and the live databases and says what a restore would do; it never writes to Notion, and a restore itself is never run). WARN when there is no token to read the live databases with.`,
    manual: { steps: ["Dump: `pnpm --filter @hub/notion notion-dump dump <project folder>` (needs the integration token and `notion.access` green).", "Dry run by hand: `pnpm --filter @hub/notion notion-dump restore <project folder> --dry-run`."] },
    check: backupNotionCheck,
  },
  {
    id: "backup.snapshot", group: "Backup", title: "A recent, intact `hub backup` snapshot exists off the repo",
    why: "`hub backup --apply` writes a dated snapshot (database copy, Notion dump, config, manifest) into the git-ignored `backups/` folder. Git covers the code; this covers what git cannot, and nothing runs it for you.",
    verifies: `The newest snapshot under the backup folder (\`backup_dir\` in \`config/config.json\`, default \`<instance>/backups/\`) is at most ${SNAPSHOT_MAX_AGE_DAYS} days old (WARN), its \`manifest.json\` hashes and sizes match every file (FAIL), the backup folder is on a different volume than \`data/\` by device id (WARN when the same, unless a reachable \`backup_copy_to\` is elsewhere), and \`backup_copy_to\` is reachable when set (WARN). No snapshot at all is a FAIL, a WARN on an instance with no database yet. FAIL when the folder is inside the instance and git tracks a file under it or does not ignore it, or when it is inside \`state/\` or the core. Read only: nothing is written, restored or sent.`,
    manual: { steps: ["Make one: `hub backup` (dry run), then `hub backup --apply`; check it with `hub backup --verify`.", "Same volume: set `backup_copy_to` in `config/config.json` to an rsync destination (an off-disk copy), and/or `backup_dir` to a folder on an external drive or in iCloud Drive.", "Secrets are never in a snapshot: keep your own off-machine copy of `state/secrets/` (see `backup.secrets`)."] },
    check: backupSnapshotCheck,
  },
  {
    id: "backup.secrets", group: "Backup", title: "Secret files exist with the right modes",
    why: "Tokens and mail logins sit in `state/secrets/`, outside git. A readable secret leaks; a missing one breaks a project at the worst moment.",
    verifies: "The secrets folder is mode 700, every secret file in it is mode 600, and each token file a project names (`notion.token_file`) exists. Only names and modes are read; no value is opened. Keeping an off-machine copy of the folder is yours to do and to remember: nothing here can see it.",
    manual: { steps: ["`chmod 700 state/secrets` and `chmod 600 state/secrets/*`.", "Keep one off-machine copy of `state/secrets/` (a password manager or an encrypted drive)."] },
    check: backupSecretsCheck,
  },
];

import { renameProjectInDb, type DbRenameResult } from "@hub/db";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// `hub project rename <old> <new>`: the slug is the folder name and the `project` column of every table, so a rename
// touches several places. Generic by construction: nothing here names a project, a table or an owner. Dry run by
// default; `apply` backs the database file up next to itself, changes the files first (each change is undoable),
// then the database in ONE immediate transaction, and undoes the files if the database refuses.

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface RenameOptions {
  projectsRoot: string;
  /** `<home>/state`: holds `projects/<slug>/` (generated session files) and `projects/binding.json`. */
  stateRoot: string;
  /** The folder of generated session files; default `<stateRoot>/projects` (`hubPaths().stateProjects`). */
  stateProjects?: string;
  dbPath: string;
  from: string;
  to: string;
  apply: boolean;
  now?: Date;
}

export interface RenameReport {
  ok: boolean;
  applied: boolean;
  /** What is (dry run) or was (apply) done, one line each. */
  actions: string[];
  /** Why it cannot run; empty when ok. */
  problems: string[];
  db: DbRenameResult;
}

/** The literal references to a slug that are safe to rewrite in a generated file. Prose is never touched. */
export function rewriteSlugTokens(text: string, from: string, to: string): string {
  const f = esc(from);
  return text
    .replace(new RegExp(`(?<![A-Za-z0-9@])((?:app/)?projects/)${f}(?![A-Za-z0-9._-])`, "g"), `$1${to}`)
    .replace(new RegExp(`("HUB_PROJECT"\\s*:\\s*")${f}(")`, "g"), `$1${to}$2`)
    .replace(new RegExp(`("project"\\s*:\\s*")${f}(")`, "g"), `$1${to}$2`)
    .replace(new RegExp(`(filters:hub-)${f}(?![A-Za-z0-9._-])`, "g"), `$1${to}`);
}

/** The slug as project.md states it: the `# <slug>` heading and a `name` row that equals it. Provenance cells stay as they are. */
export function rewriteProjectMd(text: string, from: string, to: string): string {
  const f = esc(from);
  return text
    .replace(new RegExp(`^(#\\s+)${f}(\\s*)$`, "m"), `$1${to}$2`)
    .replace(new RegExp(`^(\\|\\s*name\\s*\\|\\s*)${f}(\\s*\\|)`, "m"), `$1${to}$2`);
}

function filesUnder(dir: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p, keep));
    else if (keep(name)) out.push(p);
  }
  return out;
}

export function renameProject(o: RenameOptions): RenameReport {
  const { from, to } = o;
  const problems: string[] = [];
  const actions: string[] = [];
  const emptyDb: DbRenameResult = { tables: [], total: 0 };

  if (!SLUG.test(from)) problems.push(`"${from}" is not a slug ([a-z0-9-]+, no leading "_")`);
  if (!SLUG.test(to)) problems.push(`"${to}" is not a slug ([a-z0-9-]+, no leading "_")`);
  if (from === to) problems.push("old and new slug are the same");
  const oldDir = join(o.projectsRoot, from);
  const newDir = join(o.projectsRoot, to);
  if (!problems.length) {
    if (!existsSync(join(oldDir, "project.md"))) problems.push(`no project "${from}": ${join(oldDir, "project.md")} is missing`);
    if (existsSync(newDir)) problems.push(`${newDir} already exists`);
  }
  if (problems.length) return { ok: false, applied: false, actions, problems, db: emptyDb };

  const projectsState = o.stateProjects ?? join(o.stateRoot, "projects");
  const stateOld = join(projectsState, from);
  const stateNew = join(projectsState, to);
  if (existsSync(stateNew)) return { ok: false, applied: false, actions, problems: [`${stateNew} already exists`], db: emptyDb };

  // 1. what changes in files
  const mdFile = join(oldDir, "project.md");
  const mdText = readFileSync(mdFile, "utf8");
  const mdNew = rewriteProjectMd(mdText, from, to);
  const undo: Array<() => void> = [];
  const dryFileChanges: Array<{ file: string; next: string; prev: string }> = [];
  const consider = (file: string) => {
    const prev = readFileSync(file, "utf8");
    const next = rewriteSlugTokens(prev, from, to);
    if (next !== prev) dryFileChanges.push({ file, prev, next });
  };
  for (const f of filesUnder(join(oldDir, ".generated"), (n) => /\.(xml|json)$/.test(n))) consider(f);
  // other sessions' deny rules and every generated settings file name folders: rewrite the references everywhere in state/projects
  for (const f of filesUnder(projectsState, (n) => n.endsWith(".json") && n !== "binding.json")) consider(f);

  actions.push(`rename folder ${oldDir} -> ${newDir}`);
  actions.push(mdNew !== mdText ? "project.md: heading and name row say the new slug" : "project.md: no heading or name row equal to the old slug (left as is)");
  for (const c of dryFileChanges) actions.push(`rewrite slug references in ${c.file.startsWith(oldDir) ? join(newDir, c.file.slice(oldDir.length + 1)) : c.file}`);
  if (existsSync(stateOld)) actions.push(`rename generated session files ${stateOld} -> ${stateNew}`);
  let bindingText: string | null = null;
  const bindingFile = join(projectsState, "binding.json");
  try {
    bindingText = readFileSync(bindingFile, "utf8");
    if ((JSON.parse(bindingText) as { project?: string }).project !== from) bindingText = null;
  } catch { bindingText = null; }
  if (bindingText) actions.push(`agent binding ${bindingFile}: ${from} -> ${to}`);

  // 2. what changes in the database (counts only, in a dry run)
  const registry = (settingsJson: string) => {
    let j: Record<string, unknown>;
    try { j = JSON.parse(settingsJson) as Record<string, unknown>; } catch { return { settingsJson }; }
    if (j.slug === from) j.slug = to;
    if (j.name === from) j.name = to;
    return { settingsJson: JSON.stringify(j), hash: createHash("sha256").update(mdNew).digest("hex") };
  };
  let db: DbRenameResult;
  try {
    db = renameProjectInDb(o.dbPath, from, to, { apply: false, registry });
  } catch (e) {
    return { ok: false, applied: false, actions, problems: [(e as Error).message], db: emptyDb };
  }
  for (const t of db.tables) actions.push(`database ${t.table}.${t.column}: ${t.rows} row(s)`);
  if (!db.tables.length) actions.push("database: no rows under the old slug");

  if (!o.apply) return { ok: true, applied: false, actions, problems, db };

  // 3. apply: files first, each undoable
  try {
    for (const c of dryFileChanges) {
      writeFileSync(c.file, c.next);
      undo.push(() => writeFileSync(c.file, c.prev));
    }
    writeFileSync(mdFile, mdNew);
    undo.push(() => writeFileSync(mdFile, mdText));
    renameSync(oldDir, newDir);
    undo.push(() => renameSync(newDir, oldDir));
    if (existsSync(stateOld)) {
      renameSync(stateOld, stateNew);
      undo.push(() => renameSync(stateNew, stateOld));
    }
    if (bindingText) {
      writeFileSync(bindingFile, bindingText.replace(new RegExp(`("project"\\s*:\\s*")${esc(from)}(")`), `$1${to}$2`));
      const prev = bindingText;
      undo.push(() => writeFileSync(bindingFile, prev));
    }
    const applied = renameProjectInDb(o.dbPath, from, to, { apply: true, ...(o.now ? { now: o.now } : {}), registry });
    return { ok: true, applied: true, actions: [...actions, ...(applied.backup ? [`database backup ${applied.backup}`] : [])], problems, db: applied };
  } catch (e) {
    const failed: string[] = [];
    for (const u of undo.reverse()) {
      try { u(); } catch (x) { failed.push((x as Error).message); }
    }
    return { ok: false, applied: false, actions, problems: [`${(e as Error).message}; files restored${failed.length ? ` EXCEPT: ${failed.join("; ")}` : ""}`], db: emptyDb };
  }
}

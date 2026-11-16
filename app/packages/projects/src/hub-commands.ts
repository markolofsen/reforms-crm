// Registration module for the installer app (`pnpm hub ...`). The installer imports this file and calls
// `registerProjectCommands(program, ...)`; nothing here depends on the installer. Wiring left to its owner:
//   1. `registerProjectCommands(program, { mailAccounts, notionCheck, mcpMailAccounts })` once, next to the other commands;
//   2. `hub doctor --project <slug>` calls `runProjectDoctor(slug, sameOptions)` and sets its exit code.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { hubPaths } from "@hub/config/paths";
import { createRepos, defaultDbPath, openDb } from "@hub/db";
import type { Command } from "commander";
import { doctorFailed, doctorProject, formatChecks } from "./doctor.js";
import { formatIssue } from "./parse.js";
import { KINDS } from "./kinds.js";
import { projectJson, writeProjectJson } from "./generated.js";
import { renameProject } from "./rename.js";
import { defaultProjectsRoot, loadProject, loadProjects, syncProjects, type LoadedProject } from "./registry.js";

export interface ProjectCommandOptions {
  /** Default: `<app>/projects` (or HUB_PROJECTS). */
  projectsRoot?: string;
  /** Default: HUB_DB or `<app>/data/app.db`. */
  dbPath?: string;
  /** `<repo>/state` (generated session files, binding). Default: two folders above the projects root. */
  stateRoot?: string;
  out?: (line: string) => void;
  /** Account names from Mail.app (`list_accounts`). */
  mailAccounts?: () => Promise<string[]>;
  /** Reads every listed database of the project (`notion-dump check`). */
  notionCheck?: (p: LoadedProject) => Promise<{ ok: boolean; detail: string }>;
  /** Mail accounts the per-run MCP allow-list admits for the project. */
  mcpMailAccounts?: (slug: string) => string[] | undefined;
}

function countMarkdown(dir: string): number {
  let n = 0;
  try {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) n += countMarkdown(p);
      else if (name.endsWith(".md")) n++;
    }
  } catch {
    /* no knowledge folder */
  }
  return n;
}

export async function runSync(o: ProjectCommandOptions = {}): Promise<number> {
  const out = o.out ?? console.log;
  const handle = openDb(o.dbPath);
  try {
    const loaded = loadProjects(o.projectsRoot ?? defaultProjectsRoot());
    const r = await syncProjects(createRepos(handle.db), loaded);
    for (const w of r.warnings) out(`warning ${w}`);
    if (!r.ok) {
      for (const e of r.errors) out(`error ${e}`);
      out("sync failed: nothing was written");
      return 1;
    }
    writeProjectJson(loaded);
    out(`synced ${r.projects} project(s), ${r.addresses} address row(s)`);
    return 0;
  } finally {
    handle.close();
  }
}

export function runShow(slug: string, o: ProjectCommandOptions = {}, json = false): number {
  const out = o.out ?? console.log;
  const loaded = loadProject(o.projectsRoot ?? defaultProjectsRoot(), slug);
  if (json) {
    out(JSON.stringify(projectJson(loaded), null, 2));
    return loaded.parsed.issues.some((i) => i.severity === "error") ? 1 : 0;
  }
  const p = loaded.parsed;
  out(JSON.stringify({ slug, mode: p.mode, summary: p.summary, config: p.config, answers: p.answers.length }, null, 2));
  for (const i of p.issues) out(formatIssue(i));
  return p.issues.some((i) => i.severity === "error") ? 1 : 0;
}

/** `project kinds`: the kind registry (kinds.ts) as a table, or one kind as JSON (what `project-setup` reads to choose and to copy the taxonomy). */
export function runKinds(id: string | undefined, o: ProjectCommandOptions = {}): number {
  const out = o.out ?? console.log;
  if (id) {
    const k = KINDS[id];
    if (!k) {
      out(`unknown kind "${id}"; kinds: ${Object.keys(KINDS).join(", ")}`);
      return 1;
    }
    out(JSON.stringify(k, null, 2));
    return 0;
  }
  const w = Math.max(...Object.keys(KINDS).map((k) => k.length));
  for (const k of Object.values(KINDS)) out(`${k.id.padEnd(w)}  ${k.title}: ${k.description}\n${"".padEnd(w)}  modules: ${k.modules.join(", ")}; required: ${k.required.join(", ")}`);
  return 0;
}

/** `project rename <old> <new>`: dry run unless `apply`. Folder, project.md, every `project` column, registry, state files, agent binding. */
export async function runRename(from: string, to: string, apply: boolean, o: ProjectCommandOptions = {}): Promise<number> {
  const out = o.out ?? console.log;
  const projectsRoot = o.projectsRoot ?? defaultProjectsRoot();
  const r = renameProject({
    projectsRoot,
    stateRoot: o.stateRoot ?? hubPaths().state,
    ...(o.stateRoot ? {} : { stateProjects: hubPaths().stateProjects }),
    dbPath: o.dbPath ?? defaultDbPath(),
    from,
    to,
    apply,
  });
  if (!r.ok) {
    for (const p of r.problems) out(`refused: ${p}`);
    return 1;
  }
  out(`${r.applied ? "renamed" : "dry run, nothing changed"}: ${from} -> ${to}`);
  for (const a of r.actions) out(`  ${a}`);
  if (!r.applied) {
    out(`run again with --apply to do it (${r.db.total} database row(s))`);
    return 0;
  }
  const code = await runSync(o);
  out(code === 0 ? "registry rebuilt from the files" : "registry sync failed: fix the reported project.md problem, then run `hub project sync`");
  out(`next: regenerate .generated files if you use them (hub filters export ${to}), and fix prose that names "${from}" (docs, skills, rules)`);
  return 0;
}

export async function runProjectDoctor(slug: string, o: ProjectCommandOptions = {}): Promise<number> {
  const out = o.out ?? console.log;
  const root = o.projectsRoot ?? defaultProjectsRoot();
  const all = loadProjects(root);
  const project = all.find((p) => p.slug === slug);
  if (!project) {
    out(`FAIL    project exists  no ${join(root, slug, "project.md")}`);
    return 1;
  }
  const handle = openDb(o.dbPath);
  try {
    const repos = createRepos(handle.db);
    const registered = (await repos.projects.get(slug)) !== null;
    const mcp = o.mcpMailAccounts?.(slug);
    const checks = await doctorProject({
      project,
      all,
      ...(o.mailAccounts ? { mailAccounts: await o.mailAccounts() } : {}),
      ...(o.notionCheck ? { notionCheck: () => (o.notionCheck as NonNullable<typeof o.notionCheck>)(project) } : {}),
      ...(registered ? { knowledgeDocs: await repos.knowledge.count(slug) } : {}),
      knowledgeFiles: countMarkdown(join(project.folder, "knowledge")),
      ...(mcp ? { mcpMailAccounts: mcp } : {}),
    });
    out(formatChecks(checks));
    return doctorFailed(checks) ? 1 : 0;
  } finally {
    handle.close();
  }
}

/** Adds `project sync`, `project show <slug>`, `project kinds`, `project rename` and `project doctor <slug>` to a commander program. */
export function registerProjectCommands(program: Command, o: ProjectCommandOptions = {}): Command {
  const project = program.command("project").description("Projects: the registry built from <instance>/projects/*/project.md.");
  project
    .command("sync")
    .description("Validate every project.md and rebuild the registry (projects, addresses). All or nothing.")
    .action(async () => {
      process.exitCode = await runSync(o);
    });
  project
    .command("show")
    .description("Print one project's resolved settings and any problems found in its project.md.")
    .argument("<slug>")
    .option("--json", "the resolved project as skills read it (same as .generated/PROJECT.json)")
    .action((slug: string, opts: { json?: boolean }) => {
      process.exitCode = runShow(slug, o, !!opts.json);
    });
  project
    .command("kinds")
    .description("List the project kinds (modules, required fields); with <kind>, print that kind as JSON, taxonomy included.")
    .argument("[kind]")
    .action((kind: string | undefined) => {
      process.exitCode = runKinds(kind, o);
    });
  project
    .command("rename")
    .description("Rename a project slug everywhere (folder, project.md, every project column, registry, state files, binding). Dry run unless --apply; the database file is copied first.")
    .argument("<old>")
    .argument("<new>")
    .option("--apply", "do it (default: show what would change)")
    .action(async (from: string, to: string, opts: { apply?: boolean }) => {
      process.exitCode = await runRename(from, to, !!opts.apply, o);
    });
  project
    .command("doctor")
    .description("Run the project checks (same as `doctor --project <slug>`).")
    .argument("<slug>")
    .action(async (slug: string) => {
      process.exitCode = await runProjectDoctor(slug, o);
    });
  return project;
}

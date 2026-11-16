// Registration module for the installer app (`pnpm hub ...`). The installer imports this file and calls
// `registerProjectCommands(program, ...)`; nothing here depends on the installer. Wiring left to its owner:
//   1. `registerProjectCommands(program, { mailAccounts, notionCheck, mcpMailAccounts })` once, next to the other commands;
//   2. `hub doctor --project <slug>` calls `runProjectDoctor(slug, sameOptions)` and sets its exit code.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { hubPaths } from "@hub/config/paths";
import { createRepos, defaultDbPath, openDb } from "@hub/db";
import type { Command } from "commander";
import { doctorFailed, doctorProject, formatChecks } from "./doctor.js";
import { formatIssue } from "./parse.js";
import { KINDS } from "./kinds.js";
import { projectJson, writeProjectJson } from "./generated.js";
import { renameProject } from "./rename.js";
import { ProjectError } from "./parse.js";
import { writeSetting } from "./write.js";
import { proposeAddresses, type RoutingSnapshot } from "./addresses.js";
import { agentIndex, loadWorkflows, workflowErrors } from "./workflows.js";
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
  out(JSON.stringify({ slug, summary: p.summary, config: p.config, answers: p.answers.length }, null, 2));
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

export interface SetupFlags { tone?: string; signoff?: string; languages?: string }
export type Ask = (question: string, suggestion?: string) => Promise<string>;

/**
 * `project setup <slug>`: answer the open questions of a project (tone, signoff, languages) in one pass. A value from a flag is written as is;
 * a field that still has no value is asked (when `ask` is given: a terminal), with the kind's hint as the suggestion; Enter skips it. Rows are
 * written as the owner's answer (By = owner) through the same validator as every other write. `status` is never changed here: the project
 * leaves `draft` only when the owner edits it (project.md).
 */
export async function runProjectSetup(slug: string, flags: SetupFlags, o: ProjectCommandOptions = {}, ask?: Ask): Promise<number> {
  const out = o.out ?? console.log;
  const root = o.projectsRoot ?? defaultProjectsRoot();
  const before = loadProject(root, slug);
  const c = before.parsed.config;
  const kind = KINDS[c.kind];
  const plan = [
    { field: "tone", flag: flags.tone, current: c.tone, question: "How should replies sound (one line)?", suggestion: kind?.defaults.toneHint },
    { field: "signoff", flag: flags.signoff, current: c.signoff, question: "Sign-off line of drafts (for example: Best, <name>)?", suggestion: undefined },
    { field: "languages", flag: flags.languages, current: "set", question: "", suggestion: undefined }, // languages has a default: only a flag changes it
  ];
  let wrote = 0;
  for (const item of plan) {
    let value = item.flag;
    if (value === undefined) {
      if (item.current || !ask) continue;
      value = (await ask(item.question, item.suggestion)).trim();
      if (!value) { out(`skipped ${item.field}`); continue; }
    }
    try {
      writeSetting(before.folder, item.field, value, "owner");
      out(`${item.field} = ${value}`);
      wrote++;
    } catch (e) {
      if (e instanceof ProjectError) { out(`error ${item.field}: ${e.message}`); return 1; }
      throw e;
    }
  }
  const after = loadProject(root, slug);
  for (const i of after.parsed.issues) out(formatIssue(i));
  out(wrote ? `wrote ${wrote} setting(s) to ${slug}/project.md; run \`hub project sync\` to refresh the registry` : "nothing to change");
  return after.parsed.issues.some((i) => i.severity === "error") ? 1 : 0;
}

/**
 * `project addresses <slug> --routes <file>`: which addresses reach the project through forwarding rules (an exported routing snapshot), compared with
 * the addresses it lists. Read-only unless `--apply`, which appends the missing ones to `mail.aliases` as the owner's answer. Never calls an API.
 */
export function runAddresses(slug: string, routesFile: string, apply: boolean, o: ProjectCommandOptions = {}): number {
  const out = o.out ?? console.log;
  const root = o.projectsRoot ?? defaultProjectsRoot();
  const loaded = loadProject(root, slug);
  const m = loaded.parsed.config.mail;
  let snapshot: RoutingSnapshot;
  try {
    snapshot = JSON.parse(readFileSync(routesFile === "-" ? 0 : routesFile, "utf8")) as RoutingSnapshot;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("expected an object of zone -> { rules }");
  } catch (e) {
    out(`error cannot read the routing snapshot ${routesFile}: ${(e as Error).message}`);
    return 1;
  }
  const r = proposeAddresses(snapshot, { accounts: m.accounts, addresses: m.addresses, aliases: m.aliases });
  out(`${slug}: ${r.known.length} routed address(es) already listed, ${r.add.length} missing`);
  for (const a of r.add) out(`  + ${a}`);
  for (const z of r.catchAll) out(`  catch-all at ${z} forwards here: every address arrives (mail routes by account; nothing to list)`);
  if (!r.add.length) return 0;
  if (!apply) { out("dry run: add --apply to append them to mail.aliases"); return 0; }
  writeSetting(loaded.folder, "mail.aliases", [...m.aliases, ...r.add].join(", "), "owner");
  out(`mail.aliases now has ${m.aliases.length + r.add.length} address(es); run \`hub project sync\``);
  return 0;
}


/** `workflows list <slug>`: the project's workflows with how an agent may use each; `--json` is the index an agent reads (only what it may pick). */
export function runWorkflowsList(slug: string, json: boolean, o: ProjectCommandOptions = {}): number {
  const out = o.out ?? console.log;
  const loaded = loadProject(o.projectsRoot ?? defaultProjectsRoot(), slug);
  const all = loadWorkflows(loaded.folder);
  if (json) {
    out(JSON.stringify({ project: slug, workflows: agentIndex(all) }, null, 2));
    return 0;
  }
  if (!all.length) {
    out(`${slug}: no workflows (put one file per workflow in ${slug}/workflows/; the starter pack is app/projects/_template/workflows/)`);
    return 0;
  }
  const w = (k: "name") => Math.max(...all.map((x) => x[k].length));
  for (const x of all) {
    const bad = x.issues.filter((i) => i.severity === "error").length;
    out(`${x.usage.padEnd(7)} ${(x.status ?? "?").padEnd(7)} ${(x.runMode ?? "?").padEnd(14)} ${x.name.padEnd(w("name"))}${bad ? `  (${bad} error(s): run \`hub workflows check ${slug}\`)` : ""}`);
  }
  const n = (u: string) => all.filter((x) => x.usage === u).length;
  out(`${all.length} workflow(s): ${n("agent")} the agent may pick, ${n("request")} only on the owner's request, ${n("never")} retired`);
  return 0;
}

/** `workflows check <slug>`: every file parses; exit 1 on an error, warnings do not fail. */
export function runWorkflowsCheck(slug: string, o: ProjectCommandOptions = {}): number {
  const out = o.out ?? console.log;
  const loaded = loadProject(o.projectsRoot ?? defaultProjectsRoot(), slug);
  const all = loadWorkflows(loaded.folder);
  for (const x of all) for (const i of x.issues) out(`${i.severity} workflows/${x.file}: ${i.message}`);
  const errors = workflowErrors(all);
  out(errors ? `${slug}: ${errors} error(s) in ${all.length} workflow(s)` : `${slug}: ${all.length} workflow(s) ok`);
  return errors ? 1 : 0;
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
    .command("setup")
    .description("Answer the open questions of a project: tone, signoff, languages. Flags write directly; without flags a terminal asks for what is still empty (Enter skips).")
    .argument("<slug>")
    .option("--tone <text>", "how replies sound, one line")
    .option("--signoff <text>", "sign-off line of drafts")
    .option("--languages <tags>", "BCP-47 tags, comma separated")
    .action(async (slug: string, opts: SetupFlags) => {
      let rl: import("node:readline/promises").Interface | undefined;
      let ask: Ask | undefined;
      if (process.stdin.isTTY && process.stdout.isTTY) {
        const { createInterface } = await import("node:readline/promises");
        rl = createInterface({ input: process.stdin, output: process.stdout });
        ask = (q, hint) => rl!.question(hint ? `${q} [${hint}] ` : `${q} `).then((a) => (a.trim() === "" && hint ? "" : a));
      }
      try {
        process.exitCode = await runProjectSetup(slug, opts, o, ask);
      } finally {
        rl?.close();
      }
    });
  project
    .command("addresses")
    .description("Compare the addresses a project lists with the forwarding rules of an exported routing snapshot (JSON: zone -> { rules }; `-` reads stdin). Dry run unless --apply, which appends the missing ones to mail.aliases.")
    .argument("<slug>")
    .requiredOption("--routes <file>", "routing snapshot file")
    .option("--apply", "write the missing addresses (default: show them)")
    .action((slug: string, opts: { routes: string; apply?: boolean }) => {
      process.exitCode = runAddresses(slug, opts.routes, !!opts.apply, o);
    });
  project
    .command("doctor")
    .description("Run the project checks (same as `doctor --project <slug>`).")
    .argument("<slug>")
    .action(async (slug: string) => {
      process.exitCode = await runProjectDoctor(slug, o);
    });
  const workflows = program.command("workflows").description("Workflows: the playbooks in <project>/workflows/*.md. An agent picks only Active ones whose run mode allows it.");
  workflows
    .command("list")
    .description("List a project's workflows and how an agent may use each. --json prints the index an agent reads (name, description, file; only the ones it may pick).")
    .argument("<slug>")
    .option("--json", "the agent index as JSON")
    .action((slug: string, opts: { json?: boolean }) => {
      process.exitCode = runWorkflowsList(slug, !!opts.json, o);
    });
  workflows
    .command("check")
    .description("Check every workflow file of a project: front matter, status, run mode, required sections. Exit 1 on an error.")
    .argument("<slug>")
    .action((slug: string) => {
      process.exitCode = runWorkflowsCheck(slug, o);
    });
  return project;
}

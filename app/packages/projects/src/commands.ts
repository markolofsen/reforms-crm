// Registration module for the installer app (`pnpm hub ...`). The installer imports this file and calls
// `registerProjectCommands(program, ...)`; nothing here depends on the installer. Wiring left to its owner:
//   1. `registerProjectCommands(program, { mailAccounts, notionCheck, mcpMailAccounts })` once, next to the other commands;
//   2. `hub doctor --project <slug>` calls `runProjectDoctor(slug, sameOptions)` and sets its exit code.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { hubPaths } from "@hub/config/paths";
import { createRepos, defaultDbPath, openDb } from "@hub/db";
import { doctorFailed, doctorProject, formatChecks } from "./doctor";
import type { BookingProbe } from "./booking-doctor";
import { formatIssue } from "./md/issues";
import { KINDS } from "./kinds";
import { projectJson, writeProjectJson } from "./generated";
import { renameProject } from "./rename";
import { ProjectError } from "./md/issues";
import { writeBrandRow, writeSetting, type BrandRowInput } from "./write";
import type { Brand } from "./schema";
import { splitSignature } from "./brands";
import { proposeAddresses, type RoutingSnapshot } from "./addresses";
import { agentIndex, loadWorkflows, workflowErrors } from "./workflows";
import { devFolder, indexDev, initDev } from "./dev";
import { defaultProjectsRoot, syncProjects } from "./registry";
import { projectStore, type LoadedProject } from "./store";

export interface ProjectCommandOptions {
  /** Default: `<app>/projects` (or HUB_PROJECTS). */
  projectsRoot?: string;
  /** Default: HUB_DB or `<app>/data/app.db`. */
  dbPath?: string;
  /** `<repo>/state` (generated session files, binding). Default: two folders above the projects root. */
  stateRoot?: string;
  /** Where send-policy.json lives (`hubPaths().stateProjects`). Default: the instance's, unless `projectsRoot` is given (tests). */
  policyDir?: string;
  out?: (line: string) => void;
  /** Account names from Mail.app (`list_accounts`). */
  /** `undefined`: Mail could not be asked (Mail.app closed, mail-mcp down); the check is then skipped, not failed. `[]` is an answer. */
  mailAccounts?: () => Promise<string[] | undefined>;
  /** Reads every listed database of the project (`notion-dump check`). */
  notionCheck?: (p: LoadedProject) => Promise<{ ok: boolean; detail: string; skipped?: boolean }>;
  /** P155: one GET of a booking link for the doctor's booking rows (the installer's `probeBookingLink`). */
  bookingProbe?: (url: string) => Promise<BookingProbe>;
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
    const loaded = projectStore({ projects: o.projectsRoot ?? defaultProjectsRoot() }).list();
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
  const loaded = projectStore({ projects: o.projectsRoot ?? defaultProjectsRoot() }).file(slug);
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
  const policyDir = o.policyDir ?? (o.projectsRoot ? undefined : hubPaths().stateProjects);
  const all = projectStore({ projects: root, ...(policyDir ? { stateProjects: policyDir } : {}) }).list();
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
      ...(o.mailAccounts ? await o.mailAccounts().then((m) => (m ? { mailAccounts: m } : {})) : {}),
      ...(o.notionCheck ? { notionCheck: () => (o.notionCheck as NonNullable<typeof o.notionCheck>)(project) } : {}),
      ...(registered ? { knowledgeDocs: await repos.knowledge.count(slug) } : {}),
      knowledgeFiles: countMarkdown(join(project.folder, "knowledge")),
      ...(mcp ? { mcpMailAccounts: mcp } : {}),
      ...(o.bookingProbe ? { bookingProbe: o.bookingProbe } : {}),
    });
    out(formatChecks(checks));
    return doctorFailed(checks) ? 1 : 0;
  } finally {
    handle.close();
  }
}

export interface SetupFlags { tone?: string; signoff?: string; languages?: string; /** `<Brand>=<addresses and domains>` (P60): adds or updates a `## Brands` row. */ brand?: string[]; /** `<Brand>=<line><br><line>` (P60): the Signature of an existing brand row. */ brandSignature?: string[]; /** `<Brand>=<visible From name>` (P107): optional name shown before the technical sender address. */ brandDisplayName?: string[]; /** P155: the project's booking link (`booking.url`), an https URL or `none`. */ booking?: string; /** P155: `<Brand>=<https URL or none or empty>`: the Booking of an existing brand row. */ brandBooking?: string[] }

const pair = (v: string): [string, string] | null => {
  const i = v.indexOf("=");
  return i > 0 ? [v.slice(0, i).trim(), v.slice(i + 1).trim()] : null;
};
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
  const before = projectStore({ projects: root }).file(slug);
  const c = before.parsed.config;
  const kind = KINDS[c.kind];
  const plan = [
    { field: "tone", flag: flags.tone, current: c.tone, question: "How should replies sound (one line)?", suggestion: kind?.defaults.toneHint },
    { field: "signoff", flag: flags.signoff, current: c.signoff, question: "Sign-off line of drafts (for example: Best, <name>)?", suggestion: undefined },
    { field: "languages", flag: flags.languages, current: "set", question: "", suggestion: undefined }, // languages has a default: only a flag changes it
    // P155 verdict 10: one skippable question; per brand with --brand-booking.
    { field: "booking.url", flag: flags.booking, current: c.booking.url, question: "Booking link for a call (Calendly, Cal.com, a Google appointment page), or none? Per brand: --brand-booking <Brand>=<url>.", suggestion: undefined },
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
  // P60: brand rows, then their signatures. One brand per flag; each write is validated against the project's own addresses and domains.
  for (const raw of flags.brand ?? []) {
    const p = pair(raw);
    if (!p) { out(`error brand: expected <Brand>=<addresses and domains>, got "${raw}"`); return 1; }
    const old = projectStore({ projects: root }).config(slug).brands.find((b) => b.name.toLowerCase() === p[0].toLowerCase());
    try {
      writeBrandRow(before.folder, slug, { name: old?.name ?? p[0], receivesAt: p[1].split(",").map((x) => x.trim()).filter(Boolean), signature: old?.signature ?? [], displayName: old?.displayName, booking: old?.booking ?? null, by: "owner" });
      out(`brand ${p[0]} receives at ${p[1]}`);
      wrote++;
    } catch (e) {
      if (e instanceof ProjectError) { out(`error brand ${p[0]}: ${e.message}`); return 1; }
      throw e;
    }
  }
  // One existing brand row's cell per flag (P60 signature, P107 display name, P155 booking); the other cells are kept.
  const edits: Array<{ flag: string; raws: string[] | undefined; shape: string; set: (old: Brand, v: string) => Partial<BrandRowInput>; say: (old: Brand, v: string) => string }> = [
    { flag: "brand-signature", raws: flags.brandSignature, shape: "<line><br><line>", set: (_, v) => ({ signature: splitSignature(v.replace(/\\n/g, "<br>")) }), say: (o, v) => `brand ${o.name} signs with ${splitSignature(v.replace(/\\n/g, "<br>")).join(" / ")}` },
    { flag: "brand-display-name", raws: flags.brandDisplayName, shape: "<display name>", set: (_, v) => ({ displayName: v }), say: (o, v) => `brand ${o.name} displays as ${v}` },
    { flag: "brand-booking", raws: flags.brandBooking, shape: "<https URL, none or empty>", set: (_, v) => ({ booking: v || null }), say: (o, v) => (v ? `brand ${o.name} books with ${v}` : `brand ${o.name} books with the project's booking.url`) },
  ];
  for (const e of edits) {
    for (const raw of e.raws ?? []) {
      const p = pair(raw);
      if (!p) { out(`error ${e.flag}: expected <Brand>=${e.shape}, got "${raw}"`); return 1; }
      const old = projectStore({ projects: root }).config(slug).brands.find((b) => b.name.toLowerCase() === p[0].toLowerCase());
      if (!old) { out(`error ${e.flag}: no ## Brands row named ${p[0]} (add it with --brand ${p[0]}=<addresses and domains>)`); return 1; }
      try {
        writeBrandRow(before.folder, slug, { name: old.name, receivesAt: old.receivesAt, signature: old.signature, displayName: old.displayName, booking: old.booking ?? null, by: "owner", ...e.set(old, p[1]) });
        out(e.say(old, p[1]));
        wrote++;
      } catch (err) {
        if (err instanceof ProjectError) { out(`error ${e.flag} ${p[0]}: ${err.message}`); return 1; }
        throw err;
      }
    }
  }
  const after = projectStore({ projects: root }).file(slug);
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
  const loaded = projectStore({ projects: root }).file(slug);
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
  const loaded = projectStore({ projects: o.projectsRoot ?? defaultProjectsRoot() }).file(slug);
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
  const loaded = projectStore({ projects: o.projectsRoot ?? defaultProjectsRoot() }).file(slug);
  const all = loadWorkflows(loaded.folder);
  for (const x of all) for (const i of x.issues) out(`${i.severity} workflows/${x.file}: ${i.message}`);
  const errors = workflowErrors(all);
  out(errors ? `${slug}: ${errors} error(s) in ${all.length} workflow(s)` : `${slug}: ${all.length} workflow(s) ok`);
  return errors ? 1 : 0;
}

/** `dev index [<slug>] [--path <@dev folder>] [--check]`: regenerate (or check) the track table of a project's `@dev`. No argument: every project that has one. */
export function runDevIndex(slug: string | undefined, path: string | undefined, check: boolean, o: ProjectCommandOptions = {}): number {
  const out = o.out ?? console.log;
  if (slug && path) { out("error: give a project or --path, not both"); return 2; }
  if (path) {
    const r = indexDev(path, check, `hub dev index --path ${path}`);
    for (const l of r.lines) out(l);
    return r.ok ? 0 : 1;
  }
  const root = o.projectsRoot ?? defaultProjectsRoot();
  const slugs = slug ? [slug] : projectStore({ projects: root }).list().map((p) => p.slug).filter((s) => existsSync(devFolder(join(root, s))));
  if (!slugs.length) { out("no project has an @dev folder: hub dev init <project> --apply"); return 0; }
  let code = 0;
  for (const s of slugs) {
    const dev = devFolder(join(root, s));
    if (!existsSync(dev)) { out(`${s}: no @dev folder: hub dev init ${s} --apply`); code = 1; continue; }
    const r = indexDev(dev, check, `hub dev index ${s}`);
    for (const l of r.lines) out(slugs.length > 1 ? `${s}: ${l}` : l);
    if (!r.ok) code = 1;
  }
  return code;
}

/** `dev init <slug>`: the project's `@dev` skeleton from the core template. Dry run unless `apply`; never overwrites. */
export function runDevInit(slug: string, apply: boolean, o: ProjectCommandOptions = {}): number {
  const out = o.out ?? console.log;
  const r = initDev(slug, join(o.projectsRoot ?? defaultProjectsRoot(), slug), apply);
  for (const l of r.lines) out(l);
  return r.ok ? 0 : 1;
}

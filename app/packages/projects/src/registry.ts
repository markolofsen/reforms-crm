import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { hubPaths } from "@hub/config/paths";
import type { AddressRow, Repos } from "@hub/db";
import { formatIssue, normalizeAddress, parseProjectMd, type ParsedProject } from "./parse.js";
import { ProjectBase } from "./schema.js";
import { registryEntry, type RegistryProject } from "./route.js";

/** Where the project folders live: HUB_PROJECTS, else the instance's projects folder (`@hub/config/paths`). */
export function defaultProjectsRoot(): string {
  return hubPaths().projects;
}

export interface LoadedProject {
  slug: string;
  folder: string;
  file: string;
  hash: string;
  parsed: ParsedProject;
}

/** Every `<root>/<slug>/project.md`. Folders starting with `_` or `.` (the archive) and folders without one are skipped. */
export function loadProjects(root: string = defaultProjectsRoot()): LoadedProject[] {
  if (!existsSync(root)) return [];
  const out: LoadedProject[] = [];
  for (const name of readdirSync(root).sort()) {
    if (name.startsWith("_") || name.startsWith(".")) continue;
    const folder = join(root, name);
    const file = join(folder, "project.md");
    if (!statSync(folder).isDirectory() || !existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    out.push({ slug: name, folder, file, hash: createHash("sha256").update(text).digest("hex"), parsed: parseProjectMd(text, name) });
  }
  return out;
}

export function loadProject(root: string, slug: string): LoadedProject {
  const found = loadProjects(root).find((p) => p.slug === slug);
  if (!found) throw new Error(`no such project "${slug}" under ${root} (expected ${join(root, slug, "project.md")})`);
  return found;
}

export interface DuplicateClaim {
  address: string;
  projects: string[];
}

/** Addresses (not accounts) claimed by more than one project. Accounts may be shared through aliases. */
export function duplicateClaims(projects: LoadedProject[]): DuplicateClaim[] {
  const by = new Map<string, string[]>();
  for (const p of projects) {
    for (const a of new Set(p.parsed.config.mail.addresses.map(normalizeAddress))) by.set(a, [...(by.get(a) ?? []), p.slug]);
  }
  return [...by.entries()].filter(([, s]) => s.length > 1).map(([address, slugs]) => ({ address, projects: slugs.sort() }));
}

export type SyncResult =
  | { ok: true; projects: number; addresses: number; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

/**
 * Replaces the `projects` and `project_addresses` rows from the files, in one transaction. All or nothing: a project
 * with an error, or an address claimed by two projects, stops the sync and nothing is written (the old index stays).
 */
export async function syncProjects(repos: Repos, projects: LoadedProject[], at?: string): Promise<SyncResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const p of projects) {
    for (const i of p.parsed.issues) (i.severity === "error" ? errors : warnings).push(`${p.slug}: ${formatIssue(i)}`);
  }
  for (const d of duplicateClaims(projects)) errors.push(`duplicate_claim: address ${d.address} is claimed by ${d.projects.join(" and ")}`);
  if (errors.length) return { ok: false, errors, warnings };

  const addresses: AddressRow[] = [];
  for (const p of projects) {
    const c = p.parsed.config;
    for (const a of new Set(c.mail.accounts.map((x) => x.trim().toLowerCase()))) addresses.push({ address: a, project: p.slug, kind: "account" });
    for (const a of new Set(c.mail.addresses)) addresses.push({ address: a, project: p.slug, kind: "address" });
  }
  await repos.projects.replaceRegistry({
    projects: projects.map((p) => ({ slug: p.slug, name: p.parsed.name, status: p.parsed.config.status, kind: p.parsed.config.kind, archived: p.parsed.config.status === "archived", settingsJson: JSON.stringify(p.parsed.config), hash: p.hash })),
    addresses,
    ...(at ? { at } : {}),
  });
  return { ok: true, projects: projects.length, addresses: addresses.length, warnings };
}

/** The router's input, read back from the synced index (what the gate uses at run time). A row written by an older schema throws: the sync is cheap, rerun it (`hub project sync`, done on every `hub agent` and `hub up`). */
export async function registryFromDb(repos: Repos): Promise<RegistryProject[]> {
  const { projects } = await repos.projects.registry();
  return projects.map((p) => registryEntry(ProjectBase.parse(JSON.parse(p.settingsJson))));
}

export const registryFromLoaded = (projects: LoadedProject[]): RegistryProject[] => projects.map((p) => registryEntry(p.parsed.config));


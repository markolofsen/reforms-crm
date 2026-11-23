// P126 P3: the one reader of a project's config. Every reader of project.md goes through `projectStore`: `config` is
// project.md with the send policy applied (when the store knows `stateProjects`), `file` the raw file for writers and the
// doctor, `list` every project. The registry table's `settings_json` snapshot is not a config source (it goes stale
// after an edit in a session until the next `hub agent` or `hub up`, and fell back to defaults silently).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseProjectMd, type ParsedProject, type ProjectConfig } from "./parse";
import { applySendPolicy, readSendPolicy, type PolicyState } from "./send-policy";

export interface LoadedProject {
  slug: string;
  folder: string;
  file: string;
  hash: string;
  parsed: ParsedProject;
  /** Set when read through a store that knows `stateProjects`: the send policy, already applied to `parsed.config`. */
  policy?: PolicyState;
}

export interface StoreDirs {
  /** `hubPaths().projects`. */
  projects: string;
  /**
   * `hubPaths().stateProjects`: where each project's send-policy.json lives. Without it `send` and `draft` keep the
   * safe defaults (drafts only, the test list): the direction a missing policy must fail in.
   */
  stateProjects?: string;
}

export interface ProjectStore {
  readonly dirs: StoreDirs;
  /** project.md of `slug` with the send policy applied. Throws when the project has no folder or no project.md. */
  config(slug: string): ProjectConfig;
  /** `config`, or null when the project has no folder or no project.md (a registry row without its files). */
  find(slug: string): ProjectConfig | null;
  /** The whole read of `slug` (folder, hash, parse, issues, policy). Throws like `config`. */
  file(slug: string): LoadedProject;
  /** Every `<projects>/<slug>/project.md`; folders starting with `_` or `.` (the archive) and folders without one are skipped. */
  list(): LoadedProject[];
}

/** The parse of a file, kept while its hash is the same: a read costs a hash, a parse only when the text changed. */
const parses = new Map<string, { hash: string; parsed: ParsedProject }>();

const SLUG_FOLDER = /^[a-z0-9][a-z0-9._-]*$/;

/** One project folder, or null when it has no project.md. Reads nothing else: a session sandboxed to its own project can call it. */
function readOne(dirs: StoreDirs, name: string): LoadedProject | null {
  const folder = join(dirs.projects, name);
  const file = join(folder, "project.md");
  if (!existsSync(folder) || !statSync(folder).isDirectory() || !existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  const hash = createHash("sha256").update(text).digest("hex");
  const cached = parses.get(file);
  const parsed = cached?.hash === hash ? cached.parsed : parseProjectMd(text, name);
  if (cached?.hash !== hash) parses.set(file, { hash, parsed });
  if (!dirs.stateProjects) return { slug: name, folder, file, hash, parsed };
  const policy = readSendPolicy(dirs.stateProjects, name, parsed.config.kind);
  return { slug: name, folder, file, hash, parsed: { ...parsed, config: applySendPolicy(parsed.config, policy.policy) }, policy };
}

/**
 * The store over one instance's project folders. `file`, `config` and `find` read only `<projects>/<slug>/`, never the
 * other project folders (an agent's sandbox may not read them, and `hub mcp` reads only the bound project's): a slug that
 * is a template (`_`), hidden or missing is not read.
 */
export function projectStore(dirs: StoreDirs): ProjectStore {
  const tryFile = (slug: string): LoadedProject | null => (SLUG_FOLDER.test(slug) ? readOne(dirs, slug) : null);
  const file = (slug: string): LoadedProject => {
    const found = tryFile(slug);
    if (!found) throw new Error(`no such project "${slug}" under ${dirs.projects} (expected ${join(dirs.projects, slug, "project.md")})`);
    return found;
  };
  return {
    dirs,
    file,
    config: (slug) => file(slug).parsed.config,
    find: (slug) => tryFile(slug)?.parsed.config ?? null,
    list: () => {
      if (!existsSync(dirs.projects)) return [];
      const out: LoadedProject[] = [];
      for (const name of readdirSync(dirs.projects).sort()) {
        if (name.startsWith("_") || name.startsWith(".")) continue;
        const p = readOne(dirs, name);
        if (p) out.push(p);
      }
      return out;
    },
  };
}

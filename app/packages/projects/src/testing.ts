// P126 P3: a project store over configs held in memory, for tests that used to seed the registry's `settings_json`.
// The configs are read at each call, so a test may change the record between requests. It holds no files: `list()`
// is empty, so the doctor and other folder walkers see nothing.
import { ProjectBase, type ProjectConfig } from "./schema";
import type { LoadedProject, ProjectStore } from "./store";

export function projectStoreOf(configs: Record<string, Record<string, unknown>>): ProjectStore {
  const configOf = (slug: string): ProjectConfig | null => {
    const raw = configs[slug];
    return raw ? ProjectBase.parse({ schema: 1, kind: "generic", name: slug, ...raw, slug }) : null;
  };
  const loaded = (slug: string, config: ProjectConfig): LoadedProject => ({
    slug,
    folder: `/memory/${slug}`,
    file: `/memory/${slug}/project.md`,
    hash: slug,
    parsed: { slug, name: config.name, summary: "", settings: {}, databases: config.notion.databases, links: config.links, answers: [], issues: [], incomplete: false, config, policyRows: {} },
  });
  const file = (slug: string): LoadedProject => {
    const c = configOf(slug);
    if (!c) throw new Error(`no such project "${slug}" in the test store`);
    return loaded(slug, c);
  };
  return {
    dirs: { projects: "/memory" },
    config: (slug) => file(slug).parsed.config,
    find: configOf,
    file,
    /** No folders: a reader that walks the files (the doctor) finds none, as with a registry row and no project.md. */
    list: () => [],
  };
}

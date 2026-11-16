import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KINDS, hasValue } from "./kinds.js";
import type { LoadedProject } from "./registry.js";

// `<project>/.generated/PROJECT.json`: the resolved project for skills and tools to read instead of its prose.
// Derived on every sync from project.md and the kind; never edited by hand (the folder is git-ignored).

export const PROJECT_JSON = "PROJECT.json";

export function projectJson(p: LoadedProject): Record<string, unknown> {
  const c = p.parsed.config;
  const kind = KINDS[c.kind];
  return {
    schema: 1,
    slug: p.slug,
    kind: c.kind,
    status: c.status,
    name: c.name,
    modules: kind?.modules ?? [],
    skills: kind?.skills ?? [],
    mailClasses: kind?.mailClasses ?? [],
    send: c.send,
    notionModules: kind?.notionModules ?? [],
    required: kind?.required ?? [],
    missing: (kind?.required ?? []).filter((path) => !hasValue(c, path)),
    config: c,
  };
}

/** Writes `.generated/PROJECT.json` for each project; returns the files written. A folder that cannot be written is skipped, not fatal. */
export function writeProjectJson(projects: LoadedProject[]): string[] {
  const out: string[] = [];
  for (const p of projects) {
    if (p.parsed.issues.some((i) => i.severity === "error")) continue;
    try {
      const dir = join(p.folder, ".generated");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, PROJECT_JSON);
      writeFileSync(file, `${JSON.stringify(projectJson(p), null, 2)}\n`);
      out.push(file);
    } catch {
      /* read-only checkout: the registry still works */
    }
  }
  return out;
}

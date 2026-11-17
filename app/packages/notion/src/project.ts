import { readFile, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { Project } from "./types";
import { extractDatabases, normalizeId } from "@hub/projects/parse";

export { normalizeId };

/**
 * project.md: the `# name` heading and the list `- <slug>: <data source id>` under `## Notion databases`. The parser
 * is the shared one of @hub/projects, so the Settings table and every other section are invisible here. A list item with a slug but no valid id is an
 * error: a silently skipped database would be a silently missing backup.
 */
export function parseProject(text: string, folder: string): Project {
  const { name, databases, issues } = extractDatabases(text);
  const first = issues.find((i) => i.severity === "error");
  if (first) throw new Error(`project.md${first.line ? ` line ${first.line}` : ""}: ${first.message}`);
  if (databases.length === 0) throw new Error("project.md lists no databases (expected lines like `- clients: <id>` under `## Notion databases`)");
  return { name: name ?? basename(folder), folder, databases };
}

/** Accepts the project folder or the path of its project.md. */
export async function loadProject(path: string): Promise<Project> {
  const abs = resolve(path);
  const info = await stat(abs).catch(() => null);
  if (!info) throw new Error(`No such project folder or project.md: ${path}`);
  const file = info.isDirectory() ? resolve(abs, "project.md") : abs;
  const folder = info.isDirectory() ? abs : dirname(abs);
  const text = await readFile(file, "utf8").catch(() => {
    throw new Error(`Cannot read ${file}`);
  });
  return parseProject(text, folder);
}

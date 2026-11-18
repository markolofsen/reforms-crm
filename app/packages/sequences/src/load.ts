import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSequence, type SequenceDefinition } from "./definition";

// The one `node:fs` file of the package: reads `<project folder>/sequences/*.md` (README.md excepted).

export type LoadedSequence = SequenceDefinition & { /** sha256 of the file: what an enrollment records it was made from. */ hash: string };

export const sequenceHash = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Every sequence file of a project, sorted by file name. A missing folder is an empty list. Two files with one name is an error on the second. */
export function loadSequences(projectFolder: string): LoadedSequence[] {
  const dir = join(projectFolder, "sequences");
  if (!existsSync(dir)) return [];
  const out: LoadedSequence[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.toLowerCase().endsWith(".md") || name.toLowerCase() === "readme.md") continue;
    const text = readFileSync(join(dir, name), "utf8");
    out.push({ ...parseSequence(text, name), hash: sequenceHash(text) });
  }
  const seen = new Map<string, string>();
  for (const d of out) {
    const key = d.name.trim().toLowerCase();
    const prev = seen.get(key);
    if (prev) d.issues.push({ severity: "error", message: `name "${d.name}" is also used by ${prev}` });
    else seen.set(key, d.file);
  }
  return out;
}

/** One sequence by id, or null. */
export const findSequence = (all: readonly LoadedSequence[], id: string): LoadedSequence | null => all.find((d) => d.id === id) ?? null;

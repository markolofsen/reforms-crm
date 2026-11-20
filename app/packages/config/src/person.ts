import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * P89 (decision 0043 point 4): the person who runs this Hub, on this Mac only: `<state>/person.json`, `{ "name": … }`, mode 600,
 * git-ignored with the rest of `state/`. Written by `hub setup` (asked once, or `--person`); read when a send is stamped in Notion
 * (`Last sent by`). Never in the shared repo: two teammates on one instance each have their own.
 */
export interface Person { name: string }

export const personFile = (paths: { state: string }): string => join(paths.state, "person.json");

export function readPerson(paths: { state: string }): Person | undefined {
  try {
    const j = JSON.parse(readFileSync(personFile(paths), "utf8")) as { name?: unknown };
    return typeof j.name === "string" && j.name.trim() ? { name: j.name.trim() } : undefined;
  } catch {
    return undefined;
  }
}

/** A name is one line of plain text, 1 to 80 characters. */
export function personProblem(name: string): string | undefined {
  const n = name.trim();
  if (!n) return "a name is needed";
  if (n.length > 80) return "at most 80 characters";
  if (/[\r\n\t]/.test(n)) return "one line";
  return undefined;
}

export function writePerson(paths: { state: string }, name: string): void {
  const f = personFile(paths);
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ name: name.trim() }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, f);
}

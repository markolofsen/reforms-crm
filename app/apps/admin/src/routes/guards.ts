import { formatDest } from "./paths";
import { destOf, type Resolved } from "./resolve";

/** The cookie that remembers the project (`hub_project`): written by `lib/storage.ts`, read by `proxy.ts` and the guard. */
export const PROJECT_COOKIE = "hub_project";

/** The sections whose address must name a project; `proxy.ts` and the tests read the same list. */
export const PROJECT_SCOPED = /^\/(drafts|bulk|log|project)(\/[1-9]\d*)?$/;

/**
 * Old addresses that still lead somewhere, each with a reason and a removal condition, or it does not exist.
 * Empty: `/clients` was a local alias nobody was handed (decision 0013); an unknown path is Not found.
 */
export const REDIRECTS: readonly { from: string; to: string; reason: string; remove: string }[] = [];

/** The project the address must name: its own if it exists, else the remembered one, else the first. Null with no projects. */
export function pickProject(addressed: string | null, stored: string | null, projects: readonly string[]): string | null {
  return [addressed, stored].find((p): p is string => p != null && projects.includes(p)) ?? projects[0] ?? null;
}

/**
 * The address a route must be rewritten to (replace, no history entry), or null when it is already canonical:
 * the project is named, a bad filter is gone, the default value's key is gone. Not-found is never rewritten.
 */
export function canonicalAddress(r: Resolved, project: string | null, current: string): string | null {
  const d = destOf(r);
  if (!d || !project) return null;
  const wanted = formatDest(d, project);
  return wanted === current ? null : wanted;
}

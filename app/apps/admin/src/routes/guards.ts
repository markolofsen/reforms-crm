import { dest, formatDest, type Place } from "./paths";
import { destOf, type Resolved } from "./resolve";

/** The cookie that remembers the project (`hub_project`) of a multi-project instance: written and read by `lib/storage.ts`. */
export const PROJECT_COOKIE = "hub_project";

/**
 * Old addresses that still lead somewhere, each with a reason and a removal condition, or it does not exist.
 * Empty: `/clients` was a local alias nobody was handed (decision 0013); an unknown path is Not found. The query-string
 * project of saved links is not an entry here: `resolveRoute` reads it and `canonicalAddress` writes the path form.
 */
export const REDIRECTS: readonly { from: string; to: string; reason: string; remove: string }[] = [];

/** The project the address must name: its own if it exists, else the remembered one, else the first. Null with no projects. */
export function pickProject(addressed: string | null, stored: string | null, projects: readonly string[]): string | null {
  return [addressed, stored].find((p): p is string => p != null && projects.includes(p)) ?? projects[0] ?? null;
}

/**
 * The address a route must be rewritten to (replace, no history entry), or null when it is already canonical. The one place
 * that normalises: the entry `/` opens Mail (Overview with two or more projects; Overview itself is a page on every instance,
 * P63), a one-project address drops its project, a multi-project one carries it in the path, a legacy `?project=` and a dead filter
 * (or `?new=1`) are dropped, a default value's key is gone. Not found is never rewritten.
 */
export function canonicalAddress(r: Resolved, place: Place, current: string): string | null {
  if (!place.project) return null;
  const d = r.entry ? (place.multi ? dest("overview.page") : dest("mail.list")) : destOf(r);
  if (!d) return null;
  const wanted = formatDest(d, place);
  return wanted === current ? null : wanted;
}

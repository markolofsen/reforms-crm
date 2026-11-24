import type { Repos } from "@hub/db";
import { planProject, sameBrands, storedBrands } from "./indexer";

// P140 K1: the files are the source; the index must say what they say. The live bug: an index kept `brands: []` for every entry
// for a week after the files were tagged, because nothing reindexed. The server now reindexes on a change and at start; this is
// the doctor's read-only proof that the two agree.

/** One entry where the index and its file disagree. */
export interface IndexDrift {
  path: string;
  /** `not_indexed`: a valid file has no row; `orphan_row`: a row whose file is gone or refused; `hash`: the text changed; `brands`: the row's brands differ from the file's. */
  reason: "not_indexed" | "orphan_row" | "hash" | "brands";
}

/** Compares every indexable entry file of a project with its index row (hash and brands). Read only. Empty: they agree. */
export async function indexDrift(repos: Repos, root: string, slug: string): Promise<IndexDrift[]> {
  const plan = planProject(root, slug);
  const rows = new Map((await repos.knowledge.list(slug)).map((r) => [r.path, r]));
  const out: IndexDrift[] = [];
  for (const e of plan.entries) {
    const row = rows.get(e.path);
    rows.delete(e.path);
    if (!row) out.push({ path: e.path, reason: "not_indexed" });
    else if (row.contentHash !== e.hash) out.push({ path: e.path, reason: "hash" });
    else if (!sameBrands(storedBrands(row.brands), e.brands)) out.push({ path: e.path, reason: "brands" });
  }
  for (const path of rows.keys()) out.push({ path, reason: "orphan_row" });
  return out;
}

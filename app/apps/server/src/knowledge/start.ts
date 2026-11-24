import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Repos } from "@hub/db";
import { indexProject } from "@hub/knowledge/indexer";
import { watchKnowledge, type KnowledgeWatchOptions } from "@hub/knowledge/watch";
import { errFields, ops } from "@hub/log/ops";

// P140 K1: the knowledge index follows the files. Once at server start, every active project's knowledge is reindexed (by hash
// and brands, so an unchanged entry costs one read); then a watcher reindexes a project when a file under its `knowledge/`
// changes. `hub knowledge index <slug>` stays the manual door; the doctor row `knowledge.index` proves they agree.

export interface KnowledgeIndexStart {
  repos: Repos;
  projectsDir: string;
  /** Injected in tests. */
  watch?: KnowledgeWatchOptions["watch"];
  debounceMs?: number;
}

/** Reindexes one project and logs what moved (nothing when nothing moved). Never throws. */
export async function reindexKnowledge(repos: Repos, projectsDir: string, slug: string, why: "start" | "change"): Promise<void> {
  try {
    const r = await indexProject(repos, projectsDir, slug);
    if (r.added || r.updated || r.deleted || (why === "change" && r.invalid.length)) ops("knowledge").info("knowledge index followed the files", { project: slug, why, added: r.added, updated: r.updated, deleted: r.deleted, invalid: r.invalid.length });
  } catch (e) {
    ops("knowledge").warn("reindexing a project's knowledge failed", { project: slug, why, ...errFields(e) });
  }
}

/** The start pass, then the watcher. Resolves after the start pass; `stop()` closes the watcher. */
export async function startKnowledgeIndex(o: KnowledgeIndexStart): Promise<{ stop(): void }> {
  let slugs: string[] = [];
  try {
    slugs = (await o.repos.projects.registry()).projects
      .filter((p) => p.status === "active" && !p.archived && !p.slug.startsWith("_") && existsSync(join(o.projectsDir, p.slug, "knowledge")))
      .map((p) => p.slug);
  } catch (e) {
    ops("knowledge").warn("reading the project registry for the knowledge index failed", errFields(e));
  }
  for (const slug of slugs) await reindexKnowledge(o.repos, o.projectsDir, slug, "start");
  const w = watchKnowledge({ root: o.projectsDir, slugs, reindex: (slug) => reindexKnowledge(o.repos, o.projectsDir, slug, "change"), ...(o.watch ? { watch: o.watch } : {}), ...(o.debounceMs !== undefined ? { debounceMs: o.debounceMs } : {}) });
  return { stop: () => w.stop() };
}

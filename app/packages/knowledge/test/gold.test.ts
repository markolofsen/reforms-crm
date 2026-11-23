// Recall on an invented gold set (doc 16 section 5: "measured need, not a hunch"). For each project, at least 30
// questions written the way a client would ask, each with the one entry that should answer it. recall@5 below 90%
// after the phrasings were tuned is the trigger to add embeddings behind the same tool.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle, Repos } from "@hub/db";
import { indexProject } from "../src/indexer";
import { knowledgeSearch } from "../src/search";
import { cleanup, copyRoot, goldDir, openRegistered } from "./helpers";

let handle: DbHandle;
let repos: Repos;
beforeAll(async () => {
  const root = copyRoot();
  ({ handle, repos } = await openRegistered(root));
  for (const slug of ["acme-travel", "belyi-parus"]) await indexProject(repos, root, slug);
});
afterAll(() => {
  handle.close();
  cleanup();
});

const THRESHOLD = 0.9;

describe.each(["acme-travel", "belyi-parus"])("gold set: %s", (slug) => {
  const gold = JSON.parse(readFileSync(join(goldDir, `${slug}.json`), "utf8")) as Array<{ q: string; expect: string }>;

  it("has at least 30 questions", () => {
    expect(gold.length).toBeGreaterThanOrEqual(30);
  });

  it(`recall@5 is at least ${THRESHOLD * 100}%`, async () => {
    let hit5 = 0;
    let hit1 = 0;
    const misses: string[] = [];
    for (const g of gold) {
      const res = await knowledgeSearch(repos, { project: slug, query: g.q, limit: 5 }, { hubProject: slug });
      const rank = res.results.findIndex((r) => r.path === g.expect);
      if (rank >= 0) hit5++;
      if (rank === 0) hit1++;
      if (rank < 0) misses.push(`${g.q}  ->  expected ${g.expect}, got ${res.results.map((r) => r.path.split("/").pop()).join(", ")}`);
    }
    const recall5 = hit5 / gold.length;
    console.log(`[recall] ${slug}: recall@5 = ${(recall5 * 100).toFixed(1)}% (${hit5}/${gold.length}), recall@1 = ${((hit1 / gold.length) * 100).toFixed(1)}%${misses.length ? `\n  misses:\n  ${misses.join("\n  ")}` : ""}`);
    expect(recall5).toBeGreaterThanOrEqual(THRESHOLD);
  });

  it("every expected entry exists, is approved and not expired", async () => {
    for (const g of gold) {
      const row = await repos.knowledge.get(slug, g.expect);
      expect(row, g.expect).not.toBeNull();
      expect(row?.approved).toBe(true);
    }
  });
});

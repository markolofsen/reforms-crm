import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexDrift } from "../src/drift";
import { parseEntry } from "../src/entry";
import { indexProject } from "../src/indexer";
import { watchKnowledge } from "../src/watch";
import { cleanup, openRegistered, tmp } from "./helpers";

// P140 K1: the index follows the files. Invented names (core tests name no owner).

const projectMd = `# acme

## Settings

| Field | Value | Answered | By |
|---|---|---|---|
| schema | 1 | 2026-11-19 | agent |
| status | draft | 2026-11-19 | agent |
| mail.accounts | desk@acme.example | 2026-11-19 | agent |
| mail.domains | acme.example, villas.example | 2026-11-19 | agent |
| knowledge.scope | by-brand | 2026-11-19 | owner |

## Brands

| Brand | Receives at | Signature | Answered | By |
|---|---|---|---|---|
| Acme Travel | acme.example | Acme Travel team | 2026-11-19 | owner |
| Acme Villas | villas.example | Acme Villas team | 2026-11-19 | owner |

## Notion databases

- clients: 00000000-0000-4000-8000-000000000001
`;

/** The shape of a real entry file: block lists, brands under audiences. */
const entry = (brand: string, body: string) => `---\ntitle: How many requests a day?\napproved: true\nuse: STATE\naudiences:\n  - CLIENT\n  - LEAD\nbrands:\n  - ${brand}\ncategory: API\nkind: FIGURE\n---\n\n${body}\n`;

function project(): { root: string; file: string } {
  const root = tmp();
  const files = join(root, "acme", "knowledge", "files");
  mkdirSync(files, { recursive: true });
  writeFileSync(join(root, "acme", "project.md"), projectMd);
  const file = join(files, "requests.md");
  writeFileSync(file, entry("Acme Travel", "100 a day on the free key."));
  return { root, file };
}

afterEach(cleanup);

describe("P140 K1 the knowledge index follows the files", () => {
  it("reads brands from a block list in the front matter", () => {
    expect(parseEntry(entry("Acme Travel", "x")).front.brands).toEqual(["Acme Travel"]);
  });

  it("an edited file is reindexed by the watcher, debounced to one reindex", async () => {
    const { root, file } = project();
    const { handle, repos } = await openRegistered(root);
    try {
      await indexProject(repos, root, "acme");
      let fire: (() => void) | undefined;
      const reindexed: string[] = [];
      let done: () => void = () => undefined;
      const finished = new Promise<void>((r) => (done = r));
      const w = watchKnowledge({
        root,
        slugs: ["acme"],
        debounceMs: 10,
        watch: (_dir, onChange) => {
          fire = onChange;
          return { close: () => undefined };
        },
        reindex: async (slug) => {
          reindexed.push(slug);
          await indexProject(repos, root, slug);
          done();
        },
      });
      writeFileSync(file, entry("Acme Villas", "No free key; a trial week."));
      fire?.();
      fire?.();
      await finished;
      w.stop();
      expect(reindexed).toEqual(["acme"]);
      const row = (await repos.knowledge.list("acme")).find((r) => r.path === "knowledge/files/requests.md");
      expect(JSON.parse(row!.brands)).toEqual(["Acme Villas"]);
      expect(await indexDrift(repos, root, "acme")).toEqual([]);
    } finally {
      handle.close();
    }
  });

  it("a row whose brands differ from its file is drift (the doctor row fails), and a reindex heals it without a file edit", async () => {
    const { root } = project();
    const { handle, repos } = await openRegistered(root);
    try {
      await indexProject(repos, root, "acme");
      expect(await indexDrift(repos, root, "acme")).toEqual([]);
      // The live bug: the row kept `brands: []` while the file named a brand (same text, same hash).
      handle.db.$client.prepare("UPDATE knowledge_docs SET brands = '[]' WHERE project = 'acme'").run();
      expect(await indexDrift(repos, root, "acme")).toEqual([{ path: "knowledge/files/requests.md", reason: "brands" }]);
      const r = await indexProject(repos, root, "acme");
      expect(r.updated).toBe(1);
      expect(await indexDrift(repos, root, "acme")).toEqual([]);
    } finally {
      handle.close();
    }
  });

  it("a changed text, a missing row and a row without its file are drift too", async () => {
    const { root, file } = project();
    const { handle, repos } = await openRegistered(root);
    try {
      expect(await indexDrift(repos, root, "acme")).toEqual([{ path: "knowledge/files/requests.md", reason: "not_indexed" }]);
      await indexProject(repos, root, "acme");
      writeFileSync(file, entry("Acme Travel", "200 a day now."));
      expect(await indexDrift(repos, root, "acme")).toEqual([{ path: "knowledge/files/requests.md", reason: "hash" }]);
      writeFileSync(join(root, "acme", "knowledge", "files", "requests.md"), "no front matter");
      expect(await indexDrift(repos, root, "acme")).toEqual([{ path: "knowledge/files/requests.md", reason: "orphan_row" }]);
    } finally {
      handle.close();
    }
  });
});

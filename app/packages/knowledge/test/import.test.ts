import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkProject, formatReport, importFromDump, importFromFiles, indexProject, ImportError, mapPage, parseEntry, walkMarkdown } from "../src/index.js";
import { cleanup, copyRoot, openRegistered, PAGES, tmp, writeDump } from "./helpers.js";

afterEach(cleanup);

const slug = "acme-travel";
const dumpRoot = () => {
  const root = copyRoot();
  // an import target with an empty knowledge folder
  rmSync(join(root, slug, "knowledge"), { recursive: true, force: true });
  writeDump(root, slug, PAGES);
  return root;
};
const notionPath = (id8: string, name: string, folder = "") => join("knowledge", "notion", folder, `${name}-${id8}.md`);

describe("importFromDump: the mapping of doc 16", () => {
  it("maps every property of the table", () => {
    const root = dumpRoot();
    const r = importFromDump(root, slug, { now: new Date("2026-11-14T12:00:00") });
    expect(r).toMatchObject({ dump: "2026-11-10", pages: 5, written: 5, unchanged: 0, removed: 0, truncated: 1, approved: 4 });

    const file = join(root, slug, notionPath("aaaaaaaa", "acme-passport-fee", "programmes/grenada"));
    const e = parseEntry(readFileSync(file, "utf8"));
    expect(e.front).toEqual({
      title: "Acme passport fee",
      approved: true,
      use: "STATE",
      audiences: ["CLIENT", "LEAD"],
      category: "FEES",
      kind: "FIGURE",
      stages: ["ENQUIRY", "DISCOVERY"],
      folder: "programmes/grenada",
      phrasings: ["how much is the passport", "fee for citizenship"],
      valid_until: "2099-01-01",
      last_confirmed: "2026-10-01",
      source: "Gov notice 12",
      supersedes: "old-fee",
      notion_id: "aaaaaaaa-1111-4111-8111-000000000001",
      notion_edited: "2026-11-09T10:00:00.000Z",
    });
    expect(e.body).toBe("The government fee is 5,000 EUR.\n\n- paid on approval\n- not refundable");
    // properties outside the table (Sync hash) are not carried over
    expect(readFileSync(file, "utf8")).not.toContain("not-mapped");
  });

  it("an unchecked Approved stays unapproved, a set Use is kept, an empty Use becomes MARKER", () => {
    const root = dumpRoot();
    importFromDump(root, slug);
    const unreviewed = parseEntry(readFileSync(join(root, slug, notionPath("bbbbbbbb", "unreviewed-idea")), "utf8")).front;
    expect(unreviewed).toMatchObject({ approved: false, use: "STATE", audiences: ["ANY"] });
    const blank = parseEntry(readFileSync(join(root, slug, notionPath("cccccccc", "empty-use")), "utf8")).front;
    expect(blank).toMatchObject({ approved: true, use: "MARKER" });
  });

  it("slugs a non-Latin title to `entry`, keeps the id prefix, drops the truncation mark from the body", () => {
    const root = dumpRoot();
    importFromDump(root, slug);
    const file = join(root, slug, notionPath("eeeeeeee", "entry", "playbooks/lead"));
    const text = readFileSync(file, "utf8");
    expect(parseEntry(text).front.title).toBe("Сроки оформления");
    expect(parseEntry(text).body).toBe("Шесть недель.");
  });

  it("mapPage reads the title from whichever property is the title", () => {
    const f = mapPage({ id: "ffffffff-0000-4000-8000-000000000009", properties: { Name: { type: "title", title: [{ plain_text: "X" }] } } });
    expect(f.title).toBe("X");
  });
});

describe("importFromDump: idempotence and vanished pages", () => {
  it("a second import changes no byte and no mtime", () => {
    const root = dumpRoot();
    const now = new Date("2026-11-14T12:00:00");
    importFromDump(root, slug, { now });
    const files = walkMarkdown(join(root, slug, "knowledge"), join(root, slug));
    const snap = () => files.map((f) => [readFileSync(join(root, slug, f), "utf8"), statSync(join(root, slug, f)).mtimeMs] as const);
    const record = readFileSync(join(root, slug, ".generated", "knowledge-import.json"), "utf8");
    const before = snap();
    const again = importFromDump(root, slug, { now });
    expect(again).toMatchObject({ written: 0, unchanged: 5, removed: 0 });
    expect(snap()).toEqual(before);
    expect(readFileSync(join(root, slug, ".generated", "knowledge-import.json"), "utf8")).toBe(record);
  });

  it("removes the file of a page that is gone, and its empty folder", () => {
    const root = dumpRoot();
    importFromDump(root, slug);
    const gone = PAGES[0]!;
    rmSync(join(root, slug, "dumps", "2026-11-10", "knowledge", "pages", `${gone.id}.json`));
    rmSync(join(root, slug, "dumps", "2026-11-10", "knowledge", "pages", `${gone.id}.md`));
    const r = importFromDump(root, slug);
    expect(r).toMatchObject({ pages: 4, removed: 1 });
    expect(existsSync(join(root, slug, "knowledge", "notion", "programmes"))).toBe(false);
    expect(walkMarkdown(join(root, slug, "knowledge", "notion"), join(root, slug))).toHaveLength(4);
  });

  it("records the source, date, counts and a hash per file in _import.json", () => {
    const root = dumpRoot();
    importFromDump(root, slug, { now: new Date("2026-11-14T12:00:00") });
    const rec = JSON.parse(readFileSync(join(root, slug, ".generated", "knowledge-import.json"), "utf8")) as { notion: Record<string, unknown> };
    expect(rec.notion).toMatchObject({ source: "notion-dump", date: "2026-11-14", dump: "2026-11-10", pages: 5, files: 5, approved: 4, truncated: 1 });
    expect(Object.keys(rec.notion.sha256 as object)).toHaveLength(5);
  });

  it("never touches knowledge/files", () => {
    const root = dumpRoot();
    mkdirSync(join(root, slug, "knowledge", "files"), { recursive: true });
    writeFileSync(join(root, slug, "knowledge", "files", "mine.md"), "---\ntitle: Mine\n---\nx\n");
    importFromDump(root, slug);
    expect(readFileSync(join(root, slug, "knowledge", "files", "mine.md"), "utf8")).toContain("Mine");
  });

  it("refuses when there is no complete dump", () => {
    const root = copyRoot();
    expect(() => importFromDump(root, slug)).toThrow(ImportError);
    const day = writeDump(root, slug, PAGES, "2026-11-01");
    rmSync(join(day, "manifest.json"));
    expect(() => importFromDump(root, slug)).toThrow(/no complete dump/);
  });
});

describe("importFromFiles", () => {
  const source = () => {
    const src = tmp();
    mkdirSync(join(src, "sub"), { recursive: true });
    writeFileSync(join(src, "a.md"), "---\ntitle: A\naudiences: [ANY]\n---\nAlpha\n");
    writeFileSync(join(src, "sub", "b.md"), "---\ntitle: B\n---\nBeta\n");
    writeFileSync(join(src, "bad.md"), "no front matter\n");
    return src;
  };

  it("copies the valid files, reports the invalid one, and is idempotent", () => {
    const root = copyRoot();
    rmSync(join(root, slug, "knowledge"), { recursive: true, force: true });
    const src = source();
    const r = importFromFiles(root, slug, src, { now: new Date("2026-11-14T12:00:00") });
    expect(r.copied).toBe(2);
    expect(r.invalid).toEqual([{ path: "bad.md", error: expect.stringMatching(/no front matter/) }]);
    expect(existsSync(join(root, slug, "knowledge", "files", "sub", "b.md"))).toBe(true);
    expect(existsSync(join(root, slug, "knowledge", "files", "bad.md"))).toBe(false);
    expect(importFromFiles(root, slug, src)).toMatchObject({ copied: 0, unchanged: 2 });
  });

  it("keeps the notion record when both sources are imported", () => {
    const root = dumpRoot();
    importFromDump(root, slug);
    importFromFiles(root, slug, source());
    const rec = JSON.parse(readFileSync(join(root, slug, ".generated", "knowledge-import.json"), "utf8")) as Record<string, unknown>;
    expect(Object.keys(rec)).toEqual(["files", "notion"]);
  });

  it("refuses the Notion mirror as a source", () => {
    const root = dumpRoot();
    importFromDump(root, slug);
    expect(() => importFromFiles(root, slug, join(root, slug, "knowledge", "notion"))).toThrow(/Notion mirror/);
  });
});

describe("counts agree across dump, files and knowledge_docs", () => {
  it("5 pages -> 5 files -> 5 rows; check reports the gaps", async () => {
    const root = dumpRoot();
    const { handle, repos } = await openRegistered(root);
    try {
      importFromDump(root, slug);
      const idx = await indexProject(repos, root, slug);
      expect(idx).toMatchObject({ files: 5, added: 5, unchanged: 0, deleted: 0, invalid: [] });
      expect(await repos.knowledge.count(slug)).toBe(5);

      const rep = await checkProject(repos, root, slug, "2026-11-14");
      expect(rep).toMatchObject({ indexed: 5, approved: 4, unapproved: 1, expired: 1, noAudiences: 0, noPhrasings: 3, consistent: true });
      expect(rep.files).toEqual({ files: 0, notion: 5 });
      expect(rep.byUse).toEqual({ STATE: 4, MARKER: 1 });
      expect(rep.examples.expired).toEqual([notionPath("dddddddd", "old-promotion").split("\\").join("/")]);
      expect(formatReport(rep)).toContain("consistent");

      // incremental: unchanged files are skipped; a vanished page deletes its row
      expect(await indexProject(repos, root, slug)).toMatchObject({ added: 0, updated: 0, unchanged: 5, deleted: 0 });
      rmSync(join(root, slug, "knowledge", "notion", "programmes"), { recursive: true });
      expect(await indexProject(repos, root, slug)).toMatchObject({ deleted: 1, unchanged: 4 });
      expect(await repos.knowledge.count(slug)).toBe(4);
    } finally {
      handle.close();
    }
  });

  it("a file edit reindexes one row; an invalid file is reported and not indexed; check turns inconsistent", async () => {
    const root = copyRoot();
    const { handle, repos } = await openRegistered(root);
    try {
      const first = await indexProject(repos, root, slug);
      expect(first.invalid).toEqual([]);
      expect(first.files).toBe(17);
      const f = join(root, slug, "knowledge", "files", "terms", "deposit.md");
      writeFileSync(f, readFileSync(f, "utf8").replace("20 percent", "25 percent"));
      expect(await indexProject(repos, root, slug)).toMatchObject({ updated: 1, unchanged: 16 });
      expect((await repos.knowledge.search(slug, "25 percent")).hits[0]?.path).toBe("knowledge/files/terms/deposit.md");

      writeFileSync(join(root, slug, "knowledge", "files", "broken.md"), "---\ntitle: [x\n---\n");
      const r = await indexProject(repos, root, slug);
      expect(r.invalid).toHaveLength(1);
      const rep = await checkProject(repos, root, slug);
      expect(rep.consistent).toBe(false);
      expect(rep.invalid[0]?.path).toBe("knowledge/files/broken.md");
    } finally {
      handle.close();
    }
  });

  it("indexing an unregistered project fails with unknown_project", async () => {
    const root = copyRoot();
    const { handle, repos } = await openRegistered(root);
    try {
      mkdirSync(join(root, "ghost"), { recursive: true });
      await expect(indexProject(repos, root, "ghost")).rejects.toMatchObject({ code: "unknown_project" });
    } finally {
      handle.close();
    }
  });
});

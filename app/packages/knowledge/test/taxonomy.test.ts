import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkAgainstTaxonomy, checkProject, indexProject, parseTaxonomy, TaxonomyError, type FrontMatter } from "../src/index.js";
import { cleanup, copyRoot, openRegistered } from "./helpers.js";

afterEach(cleanup);

const entry = (audiences: string, extra = "") => `---\ntitle: T\naudiences: [${audiences}]\n${extra}---\nBody\n`;

describe("parseTaxonomy", () => {
  it("reads sections of comma, space or bullet separated words; prose before the first heading is ignored", () => {
    const t = parseTaxonomy("# Taxonomy\n\nWords.\n\n## audiences\nCLIENT, LEAD\n\n## category\n- PRICING\n- API\n\n## stages\nA B\n");
    expect(t).toEqual({ audiences: ["CLIENT", "LEAD"], category: ["PRICING", "API"], stages: ["A", "B"] });
  });
  it.each([
    ["## colour\nRED\n", /unknown section/],
    ["## audiences\nclient\n", /UPPER_SNAKE/],
    ["## audiences\n\n", /empty/],
    ["## audiences\nA\n## audiences\nB\n", /twice/],
  ])("rejects %j", (text, re) => expect(() => parseTaxonomy(text)).toThrow(re));
  it("throws a TaxonomyError", () => expect(() => parseTaxonomy("## x\nA")).toThrow(TaxonomyError));
});

describe("checkAgainstTaxonomy", () => {
  const t = { audiences: ["CLIENT", "LEAD"], category: ["PRICING"] };
  const front = (o: Partial<FrontMatter>): FrontMatter => ({ title: "T", approved: true, use: "STATE", audiences: [], ...o });
  it("an unknown audience is an error with the nearest word; an unknown category is a warning", () => {
    const issues = checkAgainstTaxonomy(front({ audiences: ["CLINT", "LEAD"], category: "PRICNG" }), t);
    expect(issues.map((i) => [i.axis, i.severity])).toEqual([["audiences", "error"], ["category", "warning"]]);
    expect(issues[0]?.message).toContain("did you mean CLIENT");
    expect(issues[1]?.message).toContain("did you mean PRICING");
  });
  it("an axis the file does not declare is not checked", () => {
    expect(checkAgainstTaxonomy(front({ stages: ["ANYTHING"], kind: "X" }), t)).toEqual([]);
  });
});

describe("index and check", () => {
  const setup = async (taxonomy: string | null) => {
    const root = copyRoot();
    const files = join(root, "acme-travel", "knowledge", "files");
    rmSync(files, { recursive: true, force: true }); // the invented project already has entries; these tests want only their own
    mkdirSync(files, { recursive: true });
    writeFileSync(join(files, "good.md"), entry("CLIENT", "category: PRICING\n"));
    writeFileSync(join(files, "typo.md"), entry("CLINT"));
    writeFileSync(join(files, "odd-category.md"), entry("LEAD", "category: PRICNG\n"));
    if (taxonomy !== null) writeFileSync(join(root, "acme-travel", "knowledge", "taxonomy.md"), taxonomy);
    return { root, ...(await openRegistered(root)) };
  };
  const TAX = "## audiences\nCLIENT, LEAD\n## category\nPRICING\n";

  it("without a taxonomy file nothing is validated (zero-config start)", async () => {
    const { root, repos } = await setup(null);
    const r = await indexProject(repos, root, "acme-travel");
    expect(r.invalid).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.added).toBe(3);
  });
  it("with one: a wrong audience is invalid and not indexed, a wrong category only warns, the taxonomy file is not an entry", async () => {
    const { root, repos } = await setup(TAX);
    const r = await indexProject(repos, root, "acme-travel");
    expect(r.files).toBe(3);
    expect(r.invalid.map((i) => i.path)).toEqual(["knowledge/files/typo.md"]);
    expect(r.invalid[0]?.error).toContain("did you mean CLIENT");
    expect(r.warnings.map((w) => w.path)).toEqual(["knowledge/files/odd-category.md"]);
    expect(r.added).toBe(2);
    expect((await repos.knowledge.list("acme-travel")).map((x) => x.path).sort()).toEqual(["knowledge/files/good.md", "knowledge/files/odd-category.md"]);
  });
  it("an entry that becomes invalid leaves the index on the next run", async () => {
    const { root, repos } = await setup(null);
    await indexProject(repos, root, "acme-travel");
    writeFileSync(join(root, "acme-travel", "knowledge", "taxonomy.md"), TAX);
    const r = await indexProject(repos, root, "acme-travel");
    expect(r.deleted).toBe(1);
    expect((await repos.knowledge.list("acme-travel")).map((x) => x.path)).not.toContain("knowledge/files/typo.md");
  });
  it("a malformed taxonomy file is reported, not thrown", async () => {
    const { root, repos } = await setup("## colour\nRED\n");
    const r = await indexProject(repos, root, "acme-travel");
    expect(r.invalid.map((i) => i.path)).toContain("knowledge/taxonomy.md");
  });
  it("check lists the same findings and is not consistent while an audience is wrong", async () => {
    const { root, repos } = await setup(TAX);
    await indexProject(repos, root, "acme-travel");
    const c = await checkProject(repos, root, "acme-travel");
    expect(c.taxonomy).toBe(true);
    expect(c.invalid.map((i) => i.path)).toEqual(["knowledge/files/typo.md"]);
    expect(c.warnings).toHaveLength(1);
    expect(c.consistent).toBe(false);
  });
});

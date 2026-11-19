import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkProject, indexProject, knowledgeSearch } from "../src/index";
import { cleanup, openRegistered, tmp } from "./helpers";

// P60 B3: the brand axis. One project with two brands keeps their facts apart (knowledge.scope by-brand); the same
// entries in a shared project are all visible. Invented names (core tests name no owner).

const projectMd = (scope: "by-brand" | "shared") => `# acme

## Settings

| Field | Value | Answered | By |
|---|---|---|---|
| schema | 1 | 2026-11-19 | agent |
| status | draft | 2026-11-19 | agent |
| mail.accounts | desk@acme.example | 2026-11-19 | agent |
| mail.domains | acme.example, villas.example | 2026-11-19 | agent |
| tone | short | 2026-11-19 | owner |
${scope === "by-brand" ? "| knowledge.scope | by-brand | 2026-11-19 | owner |\n" : ""}
## Brands

| Brand | Receives at | Signature | Answered | By |
|---|---|---|---|---|
| Acme Travel | acme.example, desk@acme.example | Acme Travel team | 2026-11-19 | owner |
| Acme Villas | villas.example | Acme Villas team | 2026-11-19 | owner |

## Notion databases

- clients: 00000000-0000-4000-8000-000000000001
`;

const entry = (title: string, brands: string | null, body: string) => `---\ntitle: ${title}\naudiences: [CLIENT]\n${brands === null ? "" : `brands: ${brands}\n`}---\n\n${body}\n`;

function project(scope: "by-brand" | "shared"): string {
  const root = tmp();
  const files = join(root, "acme", "knowledge", "files");
  mkdirSync(files, { recursive: true });
  writeFileSync(join(root, "acme", "project.md"), projectMd(scope));
  writeFileSync(join(files, "free-plan.md"), entry("Is there a free plan?", "[Acme Travel]", "Yes: the free plan has 100 requests a day."));
  writeFileSync(join(files, "villas-free-plan.md"), entry("Is there a free plan for villas?", "[acme villas]", "No free plan; a trial week."));
  writeFileSync(join(files, "code.md"), entry("Why has my verification code not arrived?", "[ANY]", "Check the spam folder; the free plan sends codes too."));
  writeFileSync(join(files, "untagged.md"), entry("How is the free plan priced?", null, "Untagged free plan answer."));
  writeFileSync(join(files, "typo.md"), entry("Free plan limits", "[Acme Travle]", "Typo free plan answer."));
  return root;
}

afterEach(cleanup);

describe("knowledge.scope by-brand", () => {
  it("indexes only entries with known brands; an untagged or unknown-brand entry is invalid, as an unknown audience", async () => {
    const root = project("by-brand");
    const { handle, repos } = await openRegistered(root);
    try {
      const r = await indexProject(repos, root, "acme");
      expect(r.added).toBe(3);
      expect(r.invalid.map((i) => i.path).sort()).toEqual(["knowledge/files/typo.md", "knowledge/files/untagged.md"]);
      expect(r.invalid.find((i) => i.path.endsWith("untagged.md"))?.error).toMatch(/no brands/);
      expect(r.invalid.find((i) => i.path.endsWith("typo.md"))?.error).toMatch(/unknown brand "Acme Travle"/);
      const check = await checkProject(repos, root, "acme");
      expect(check.invalid.map((i) => i.path).sort()).toEqual(["knowledge/files/typo.md", "knowledge/files/untagged.md"]);
    } finally {
      handle.close();
    }
  });

  it("search needs a brand and returns that brand's entries and the shared ones, never another brand's", async () => {
    const root = project("by-brand");
    const { handle, repos } = await openRegistered(root);
    try {
      await indexProject(repos, root, "acme");
      const q = (brand?: string) => knowledgeSearch(repos, { project: "acme", query: "free plan", ...(brand ? { brand } : {}) }, { today: "2026-11-19" });
      await expect(q()).rejects.toMatchObject({ code: "brand_required" });
      await expect(q("Nobody")).rejects.toMatchObject({ code: "unknown_brand" });
      const travel = await q("acme travel");
      expect(travel.results.map((x) => x.path).sort()).toEqual(["knowledge/files/code.md", "knowledge/files/free-plan.md"]);
      expect(travel.results.find((x) => x.path.endsWith("free-plan.md"))?.brands).toEqual(["Acme Travel"]);
      const villas = await q("Acme Villas");
      expect(villas.results.map((x) => x.path).sort()).toEqual(["knowledge/files/code.md", "knowledge/files/villas-free-plan.md"]);
      expect(villas.results.find((x) => x.path.endsWith("villas-free-plan.md"))?.brands).toEqual(["Acme Villas"]);
      const unbranded = await q("ANY");
      expect(unbranded.results.map((x) => x.path)).toEqual(["knowledge/files/code.md"]);
    } finally {
      handle.close();
    }
  });
});

describe("knowledge.scope shared (the default)", () => {
  it("ignores brands: every parsed entry is indexed and a search needs no brand", async () => {
    const root = project("shared");
    const { handle, repos } = await openRegistered(root);
    try {
      const r = await indexProject(repos, root, "acme");
      expect(r.added).toBe(5);
      expect(r.invalid).toEqual([]);
      const all = await knowledgeSearch(repos, { project: "acme", query: "free plan", limit: 10 }, { today: "2026-11-19" });
      expect(all.total).toBe(5);
      const withBrand = await knowledgeSearch(repos, { project: "acme", query: "free plan", brand: "Acme Villas", limit: 10 }, { today: "2026-11-19" });
      expect(withBrand.total).toBe(5);
    } finally {
      handle.close();
    }
  });
});

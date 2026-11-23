import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCheck, runColors, runExportApi, runExportXml, runPropose } from "../src/commands";

const here = dirname(fileURLToPath(import.meta.url));
const projectMd = `# Acme Travel

Invented.

## Settings

| Field | Value | Answered | By |
|---|---|---|---|
| schema | 1 | 2026-11-14 | agent |
| name | Acme Travel | 2026-11-14 | owner |
| status | active | 2026-11-14 | agent |
| mail.accounts | owner@acme.example | 2026-11-14 | agent |
| mail.sender | owner@acme.example | 2026-11-14 | owner |
| tone | warm | 2026-11-14 | owner |
| knowledge.source | files | 2026-11-14 | owner |
`;

function setup(withRules = true) {
  const root = mkdtempSync(join(tmpdir(), "mf-"));
  const dir = join(root, "acme-travel");
  mkdirSync(dir);
  writeFileSync(join(dir, "project.md"), projectMd);
  if (withRules) cpSync(join(here, "fixtures", "rules.md"), join(dir, "mail-filters.md"));
  const lines: string[] = [];
  return { root, dir, lines, o: { projectsRoot: root, out: (l: string) => lines.push(l), now: () => "2026-11-14T00:00:00.000Z" } };
}

describe("hub mail-filters", () => {
  it("check passes on the fixture and fails on a conflicting rule", () => {
    const t = setup();
    expect(runCheck("acme-travel", t.o)).toBe(0);
    const f = join(t.dir, "mail-filters.md");
    writeFileSync(f, readFileSync(f, "utf8").replace("## Client whitelist", "| domain:clientco.example | marketing | hub/marketing | label+skip+read | x | 2026-11-14 | agent |\n\n## Client whitelist"));
    expect(runCheck("acme-travel", t.o)).toBe(1);
    expect(t.lines.join("\n")).toContain("whitelist_conflict");
  });
  it("export-xml writes the golden file into .generated/, and refuses on errors", () => {
    const t = setup();
    expect(runExportXml("acme-travel", t.o)).toBe(0);
    expect(readFileSync(join(t.dir, ".generated", "mail-filters.xml"), "utf8")).toBe(readFileSync(join(here, "fixtures", "mailFilters.golden.xml"), "utf8"));
    expect(runExportApi("acme-travel", t.o)).toBe(0);
    expect(JSON.parse(readFileSync(join(t.dir, ".generated", "mail-filters.api.json"), "utf8")).version).toBe(1);
    const t2 = setup(false);
    expect(runExportXml("acme-travel", t2.o)).toBe(1);
    expect(existsSync(join(t2.dir, ".generated", "mail-filters.xml"))).toBe(false);
  });
  it("propose --apply writes confident rules and leaves uncertain ones for the owner", () => {
    const t = setup(false);
    const sample = join(t.root, "sample.json");
    writeFileSync(sample, JSON.stringify([
      { from: "hello@shopexample.example", subject: "Newsletter", hasUnsubscribe: true },
      { from: "x@growthpitch.example", subject: "Quick question about your site" },
      { from: "owner@acme.example", subject: "me" },
    ]));
    expect(runPropose("acme-travel", { ...t.o, sample, apply: true })).toBe(0);
    const written = readFileSync(join(t.dir, "mail-filters.md"), "utf8");
    expect(written).toContain("| domain:shopexample.example | marketing | hub/marketing | label+skip+read |");
    expect(written).not.toContain("growthpitch.example");
    expect(runCheck("acme-travel", t.o)).toBe(0);
    expect(runPropose("acme-travel", { ...t.o, sample, apply: true, accept: ["growthpitch.example"] })).toBe(0);
    expect(readFileSync(join(t.dir, "mail-filters.md"), "utf8")).toContain("domain:growthpitch.example | cold-outreach | hub/cold-outreach | label |");
  });
});

describe("hub mail-filters colors", () => {
  it("prints the universal palette, applies project overrides, and rejects unknown class or color", async () => {
    const { parseRulesFile, writeRulesFile, DEFAULT_COLORS, GMAIL_PALETTE } = await import("../src/index");
    const t = setup();
    expect(runColors("acme-travel", t.o)).toBe(0);
    const text = t.lines.join("\n");
    expect(text).toContain("| hub/client | client | Green | #16a766 | #ffffff | default |");
    expect(text).toContain("Only hub/*");
    for (const name of Object.values(DEFAULT_COLORS)) expect(GMAIL_PALETTE.some((c) => c.name === name)).toBe(true);

    const f = join(t.dir, "mail-filters.md");
    writeFileSync(f, `${readFileSync(f, "utf8")}\n## Label colors\n\n| Class | Color |\n|---|---|\n| partner | Dark blue |\n| nope | Green |\n| spam | Neon |\n`);
    const parsed = parseRulesFile(readFileSync(f, "utf8"));
    expect(parsed.file.colors).toEqual({ partner: "Dark blue" });
    expect(parsed.issues.map((i) => i.code).sort()).toEqual(["bad_color", "bad_color_class"]);
    const t2 = { ...t, lines: [] as string[] };
    expect(runColors("acme-travel", { ...t.o, out: (l) => t2.lines.push(l) })).toBe(1);
    expect(t2.lines.join("\n")).toContain("| hub/partner | partner | Dark blue | #285bac | #ffffff | project |");

    const round = parseRulesFile(writeRulesFile(parsed.file, "acme-travel"));
    expect(round.file.colors).toEqual({ partner: "Dark blue" });
    expect(round.issues).toEqual([]);
  });
});

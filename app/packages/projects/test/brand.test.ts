import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyBrandRow, brandChecks, headersFromText, parseProjectMd, resolveBrand, signatureFor, signatureLines, signBody, type LoadedProject } from "../src/index";

// P60 B1/B2: the `## Brands` table, the resolver and the signature, on fixtures shaped like the two live instances.
// The names live in test/fixtures/brands (core test code names no owner, `@docs/LAYERS.md`).

const fx = path.join(__dirname, "fixtures", "brands");
const read = (f: string) => readFileSync(path.join(fx, f), "utf8");
const project = (slug: "one-mailbox" | "two-accounts") => parseProjectMd(read(`${slug}.md`), slug);
const cases = JSON.parse(read("cases.json")) as {
  forwarded: { project: "one-mailbox"; headersFile: string; wroteTo: string; brand: string; via: string; signature: string[] };
  cases: Array<{ name: string; project: "one-mailbox" | "two-accounts"; headers: string; wroteTo: string | null; brand: string | null; via: string }>;
};
const loaded = (slug: string, text: string): LoadedProject => ({ slug, folder: "/nowhere", file: "/nowhere/project.md", hash: "x", parsed: parseProjectMd(text, slug) });

describe("## Brands parses", () => {
  it("both fixture projects parse without errors and carry their rows", () => {
    for (const slug of ["one-mailbox", "two-accounts"] as const) {
      const p = project(slug);
      expect(p.issues.filter((i) => i.severity === "error"), slug).toEqual([]);
      expect(p.config.brands.length).toBeGreaterThanOrEqual(2);
    }
    const one = project("one-mailbox").config;
    expect(one.knowledge.scope).toBe("by-brand");
    expect(one.brands[0]?.signature).toHaveLength(2);
    expect(project("two-accounts").config.knowledge.scope).toBe("shared");
  });

  it("refuses a domain in two rows, an address that is not the project's, a duplicate brand and a bad header", () => {
    const base = read("one-mailbox.md");
    const row = (r: string) => base.replace(/(\| Reforms \|[^\n]*\n)/, `$1${r}\n`);
    const errs = (text: string) => parseProjectMd(text, "one-mailbox").issues.filter((i) => i.field === "brands" && i.severity === "error").map((i) => i.message);
    const [domain] = (parseProjectMd(base, "one-mailbox").config.brands[0]?.receivesAt ?? []);
    expect(errs(row(`| Twice | ${domain} |  | 2026-11-19 | owner |`)).join()).toMatch(/listed by brand .* and brand Twice/);
    expect(errs(row("| Stranger | someone@example.org |  | 2026-11-19 | owner |")).join()).toMatch(/not one of the project's/);
    expect(errs(row("| stranger.example |  |  | 2026-11-19 | owner |")).join()).toMatch(/receives at nothing/);
    const first = parseProjectMd(base, "one-mailbox").config.brands[0]?.name ?? "";
    expect(errs(row(`| ${first.toUpperCase()} | ${domain} |  | 2026-11-19 | owner |`)).join()).toMatch(/listed twice/);
    expect(errs(base.replace("| Brand | Receives at | Signature | Answered | By |", "| Brand | Domains | Answered | By |")).join()).toMatch(/needs a table/);
    expect(errs(row("| Odd | not-a-domain |  | 2026-11-19 | coordinator |")).length).toBeGreaterThanOrEqual(2);
  });

  it("the writer adds and replaces a row in place and refuses a row the parser would refuse", () => {
    const base = read("two-accounts.md");
    const p = project("two-accounts").config;
    const second = p.brands[1];
    if (!second) throw new Error("fixture");
    const next = applyBrandRow(base, "two-accounts", { name: second.name, receivesAt: second.receivesAt, signature: ["Line one", "Line | two"], by: "owner", date: "2026-11-20" });
    const again = parseProjectMd(next, "two-accounts");
    expect(again.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(again.config.brands[1]?.signature).toEqual(["Line one", "Line | two"]);
    expect(next.split("\n").length).toBe(base.split("\n").length);
    expect(() => applyBrandRow(base, "two-accounts", { name: "Other", receivesAt: ["someone@example.org"], signature: [], by: "owner", date: "2026-11-20" })).toThrow(/not one of the project's/);
    const noTable = base.replace(/## Brands[\s\S]*?(?=## Notion databases)/, "");
    const created = applyBrandRow(noTable, "two-accounts", { name: second.name, receivesAt: second.receivesAt, signature: [], by: "owner", date: "2026-11-20" });
    expect(created.indexOf("## Brands")).toBeGreaterThan(created.indexOf("## Settings"));
    expect(created.indexOf("## Brands")).toBeLessThan(created.indexOf("## Notion databases"));
  });
});

describe("resolveBrand", () => {
  it("the real forwarded mail: the brand address in To and X-Forwarded-For wins over Delivered-To and X-Forwarded-To", () => {
    const c = project(cases.forwarded.project).config;
    const r = resolveBrand(headersFromText(read(cases.forwarded.headersFile)), c);
    expect(r).toMatchObject({ wroteTo: cases.forwarded.wroteTo, brand: cases.forwarded.brand, via: cases.forwarded.via });
    expect(signatureFor(c, r)).toEqual({ lines: cases.forwarded.signature, placeholder: false });
  });

  for (const k of cases.cases) {
    it(k.name, () => {
      const r = resolveBrand(headersFromText(k.headers), project(k.project).config);
      expect(r).toMatchObject({ wroteTo: k.wroteTo, brand: k.brand, via: k.via });
      expect(r.reason.length).toBeGreaterThan(0);
    });
  }

  it("never a default brand: an own address in no row resolves to null with the reason", () => {
    const c = project("one-mailbox").config;
    const r = resolveBrand([{ name: "to", addresses: [`x@${c.mail.domains[0]}`] }], { ...c, brands: c.brands.filter((b) => !b.receivesAt.includes(c.mail.domains[0] ?? "")) });
    expect(r).toMatchObject({ brand: null, via: "none" });
    expect(r.reason).toMatch(/in no brand row/);
  });
});

describe("the signature", () => {
  const c = project("one-mailbox").config;
  const unsigned = c.brands.find((b) => b.signature.length === 0);
  const signed = c.brands.find((b) => b.signature.length > 0);
  if (!unsigned || !signed) throw new Error("fixture needs a signed and an unsigned brand");

  it("no table: signoff alone; unresolved or unanswered: the placeholder, never another brand's lines", () => {
    expect(signatureFor({ signoff: "Thanks,", brands: [] }, null)).toEqual({ lines: ["Thanks,"], placeholder: false });
    expect(signatureFor({ signoff: "", brands: [] }, null)).toEqual({ lines: [], placeholder: false });
    expect(signatureFor(c, { brand: null, wroteTo: "x@example.org" }).lines.at(-1)).toBe("[Owner: signature for x@example.org]");
    expect(signatureFor(c, null).lines.at(-1)).toBe("[Owner: signature for unknown brand]");
    expect(signatureFor(c, { brand: unsigned.name, wroteTo: null })).toMatchObject({ placeholder: true, lines: [c.signoff, `[Owner: signature for ${unsigned.name}]`] });
  });

  it("signs once: a sign-off the agent typed, or an earlier block, is replaced", () => {
    const block = signatureFor(c, { brand: signed.name, wroteTo: null });
    const once = signBody("Hello,\n\nAnswer.", block, signatureLines(c));
    expect(once).toBe(`Hello,\n\nAnswer.\n\n${block.lines.join("\n")}`);
    expect(signBody(`${once}\n`, block, signatureLines(c))).toBe(once);
    expect(signBody(`Hello,\n\nAnswer.\n\n${c.signoff.toUpperCase()}`, block, signatureLines(c))).toBe(once);
    const placeholder = signatureFor(c, null);
    expect(signBody(signBody("Answer.", placeholder), block, signatureLines(c))).toBe(`Answer.\n\n${block.lines.join("\n")}`);
  });
});

describe("doctor rows", () => {
  it("draft: an unsigned brand and a brandless domain warn; active: they fail; no table: skipped", () => {
    const text = read("one-mailbox.md").replace("| mail.domains | reforms.ai,", "| mail.domains | spare.example, reforms.ai,");
    const draft = brandChecks(loaded("one-mailbox", text));
    expect(draft.map((k) => [k.name, k.outcome])).toEqual([["brands table parses", "pass"], ["every project domain has a brand", "warn"], ["every brand has a signature", "warn"]]);
    const active = brandChecks(loaded("one-mailbox", text.replace("| status | draft |", "| status | active |")));
    expect(active.filter((k) => k.outcome === "fail").map((k) => k.name)).toEqual(["every project domain has a brand", "every brand has a signature"]);
    const none = brandChecks(loaded("one-mailbox", text.replace(/## Brands[\s\S]*?(?=## Notion databases)/, "")));
    expect(none.every((k) => k.outcome === "skipped")).toBe(true);
    const broken = brandChecks(loaded("one-mailbox", text.replace("| Brand | Receives at |", "| Brand | Where |")));
    expect(broken).toMatchObject([{ name: "brands table parses", outcome: "fail" }]);
  });

  it("a domain listed by two projects is a duplicate claim at sync", async () => {
    const { duplicateDomains } = await import("../src/registry");
    const a = loaded("one-mailbox", read("one-mailbox.md"));
    const b = loaded("other", read("two-accounts.md").replace("| signoff |", `| mail.domains | ${a.parsed.config.mail.domains[0]} | 2026-11-19 | agent |\n| signoff |`));
    expect(duplicateDomains([a, b]).map((d) => d.projects)).toEqual([["one-mailbox", "other"]]);
  });

  it("project setup --brand and --brand-signature write rows through the validator", async () => {
    const { runProjectSetup } = await import("../src/hub-commands");
    const root = mkdtempSync(path.join(tmpdir(), "hub-brand-setup-"));
    try {
      mkdirSync(path.join(root, "two-accounts"));
      writeFileSync(path.join(root, "two-accounts", "project.md"), read("two-accounts.md").replace(/## Brands[\s\S]*?(?=## Notion databases)/, ""));
      const c = project("two-accounts").config;
      const [a, b] = c.brands;
      if (!a || !b) throw new Error("fixture");
      const out: string[] = [];
      const code = await runProjectSetup("two-accounts", { brand: [`${a.name}=${a.receivesAt.join(", ")}`, `${b.name}=${b.receivesAt.join(", ")}`], brandSignature: [`${b.name}=One<br>Two`] }, { projectsRoot: root, out: (l) => out.push(l) });
      expect(code, out.join("\n")).toBe(0);
      const after = parseProjectMd(readFileSync(path.join(root, "two-accounts", "project.md"), "utf8"), "two-accounts").config.brands;
      expect(after.map((x) => [x.name, x.signature])).toEqual([[a.name, []], [b.name, ["One", "Two"]]]);
      expect(await runProjectSetup("two-accounts", { brandSignature: ["Nobody=x"] }, { projectsRoot: root, out: () => {} })).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

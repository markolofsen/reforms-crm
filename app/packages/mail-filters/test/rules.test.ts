import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildFilters, checkRules, exportApi, exportXml, hasErrors, normalizeRules, parseRulesFile, UnsafeRulesError, writeRulesFile, type Rule, type RulesFile } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const text = readFileSync(join(here, "fixtures", "rules.md"), "utf8");
const parsed = parseRulesFile(text);
const NOW = "2026-11-14T00:00:00.000Z";
const rule = (over: Partial<Rule> & Pick<Rule, "match" | "category">): Rule => ({ label: `hub/${over.category}`, action: "label", why: "t", date: "2026-11-14", by: "agent", ...over });
const file = (rules: Rule[], whitelist: RulesFile["whitelist"] = []): RulesFile => ({ rules, whitelist, notes: "" });
const codes = (f: RulesFile) => checkRules(f).filter((i) => i.severity === "error").map((i) => i.code);

describe("rules file", () => {
  it("parses the fixture without issues", () => {
    expect(parsed.issues).toEqual([]);
    expect(parsed.file.rules).toHaveLength(9);
    expect(parsed.file.whitelist).toHaveLength(2);
    expect(checkRules(parsed.file)).toEqual([]);
  });

  it("is idempotent and stable-sorted: write(parse(write(x))) equals write(x), order independent", () => {
    const once = writeRulesFile(parsed.file, "acme-travel");
    const twice = writeRulesFile(parseRulesFile(once).file, "acme-travel");
    expect(twice).toBe(once);
    const shuffled = { ...parsed.file, rules: [...parsed.file.rules].reverse(), whitelist: [...parsed.file.whitelist].reverse() };
    expect(writeRulesFile(shuffled, "acme-travel")).toBe(once);
    expect(parseRulesFile(once).file.rules.map((r) => r.category)[0]).toBe("partner");
  });

  it("drops exact duplicates, keeping the earliest date", () => {
    const a = rule({ match: { kind: "domain", value: "x.example" }, category: "marketing", date: "2026-11-15" });
    const n = normalizeRules(file([a, { ...a, date: "2026-11-10" }]));
    expect(n.rules).toHaveLength(1);
    expect(n.rules[0]?.date).toBe("2026-11-10");
  });

  it("reports bad rows by line and skips them", () => {
    const bad = text.replace("| domain:news.example.org | marketing", "| domain:*.example.org | marketing").replace("| from:pitch@growth.example.biz | cold-outreach | hub/cold-outreach | label |", "| from:pitch@growth.example.biz | cold-outreach | hub/cold-outreach | delete |");
    const p = parseRulesFile(bad);
    expect(p.issues.map((i) => i.code).sort()).toEqual(["bad_match", "forbidden_action"]);
    expect(p.issues.every((i) => i.line !== null)).toBe(true);
    expect(p.file.rules).toHaveLength(7);
  });

  it.each(["delete", "trash", "forward", "spam", "archive"])("action %s does not exist", (a) => {
    const p = parseRulesFile(text.replace("| label | invites |", `| ${a} | invites |`));
    expect(p.issues.map((i) => i.code)).toEqual(["forbidden_action"]);
  });
});

describe("safety", () => {
  const d = (value: string) => ({ kind: "domain" as const, value });
  it.each(["client", "partner", "security", "calendar", "cold-outreach", "spam"] as const)("never skips the inbox for %s", (category) => {
    expect(codes(file([rule({ match: d("x.example"), category, action: "label+skip+read" })]))).toEqual(["skip_not_allowed"]);
  });
  it("allows skipping for service and marketing only", () => {
    expect(codes(file([rule({ match: d("a.example"), category: "service", action: "label+skip+read" }), rule({ match: d("b.example"), category: "marketing", action: "label+skip+read" })]))).toEqual([]);
  });
  it("never skips on a subject pattern", () => {
    expect(codes(file([rule({ match: { kind: "subject", value: "weekly digest" }, category: "marketing", action: "label+skip+read" })]))).toEqual(["skip_on_subject"]);
  });
  it("the client whitelist wins: any other category overlapping it is an error", () => {
    const wl = [{ match: { kind: "from" as const, value: "jane@clientco.example" }, why: "", date: "2026-11-14", by: "owner" as const }];
    expect(codes(file([rule({ match: d("clientco.example"), category: "marketing", action: "label+skip+read" })], wl))).toContain("whitelist_conflict");
    expect(codes(file([rule({ match: { kind: "from", value: "jane@clientco.example" }, category: "service" })], wl))).toEqual(["whitelist_conflict"]);
    expect(codes(file([rule({ match: d("other.example"), category: "marketing" })], wl))).toEqual([]);
  });
  it("rejects a label outside hub/<category>", () => {
    expect(codes(file([rule({ match: d("x.example"), category: "service", label: "INBOX" })]))).toEqual(["bad_label"]);
    expect(codes(file([rule({ match: d("x.example"), category: "service", label: "hub/service/ci" })]))).toEqual([]);
  });
  it("rejects values that are Gmail operators or too long", () => {
    for (const value of ['a "b" c', "x OR y z", "-negated", "a*b cd", "x".repeat(101)]) {
      expect(codes(file([rule({ match: { kind: "subject", value }, category: "marketing" })]))).toEqual(["bad_criteria"]);
    }
    expect(codes(file([rule({ match: { kind: "from", value: "NotAnAddress" }, category: "marketing" })]))).toEqual(["bad_criteria"]);
  });
  it("flags one match in two categories", () => {
    expect(codes(file([rule({ match: d("x.example"), category: "marketing" }), rule({ match: d("x.example"), category: "service" })]))).toEqual(["duplicate_match"]);
  });
  it("respects Gmail's filter count", () => {
    const many = Array.from({ length: 1001 }, (_, i) => rule({ match: { kind: "subject", value: `phrase number ${i}` }, category: "marketing" }));
    expect(codes(file(many))).toEqual(["too_many_filters"]);
  });
});

describe("filters", () => {
  it("merges from/domain terms into OR queries under the length limit", () => {
    const many = Array.from({ length: 200 }, (_, i) => rule({ match: { kind: "domain", value: `site${i}.example.org` }, category: "marketing" }));
    const specs = buildFilters(file(many));
    expect(specs.length).toBeGreaterThan(1);
    expect(specs.every((s) => (s.criteria.from ?? "").length <= 1000)).toBe(true);
    expect(specs.flatMap((s) => (s.criteria.from ?? "").split(" OR "))).toHaveLength(200);
  });
  it("adds the whitelist as an explicit client rule that never skips the inbox", () => {
    const [first] = buildFilters(parsed.file);
    expect(first).toMatchObject({ category: "client", label: "hub/client", archive: false, markRead: false, neverSpam: true });
    expect(first?.criteria.from).toBe("@bigclient.example OR jane@clientco.example");
  });
});

describe("exporters", () => {
  const xml = exportXml(parsed.file, { slug: "acme-travel", now: NOW });
  it("matches the golden mailFilters.xml", () => {
    expect(xml).toBe(readFileSync(join(here, "fixtures", "mailFilters.golden.xml"), "utf8"));
  });
  it("never emits delete, forward or spam properties", () => {
    expect(xml).not.toMatch(/shouldTrash|forwardTo|shouldSpam|shouldStar|shouldAlwaysMarkAsImportant|delete/i);
    for (const name of xml.match(/name='(\w+)'/g) ?? []) {
      expect(["name='from'", "name='subject'", "name='hasTheWord'", "name='label'", "name='shouldArchive'", "name='shouldMarkAsRead'", "name='shouldNeverSpam'", "name='sizeOperator'", "name='sizeUnit'"]).toContain(name);
    }
  });
  it("is reproducible", () => {
    expect(exportXml(parseRulesFile(writeRulesFile(parsed.file, "acme-travel")).file, { slug: "acme-travel", now: NOW })).toBe(xml);
  });
  it("refuses an unsafe file", () => {
    const f = file([rule({ match: { kind: "domain", value: "x.example" }, category: "client", action: "label+skip+read" })]);
    expect(() => exportXml(f, { slug: "s", now: NOW })).toThrow(UnsafeRulesError);
    expect(() => exportApi(f, { slug: "s" })).toThrow(UnsafeRulesError);
  });
  it("escapes XML metacharacters", () => {
    const f = file([rule({ match: { kind: "subject", value: "q&a session" }, category: "marketing" })]);
    expect(exportXml(f, { slug: "s", now: NOW })).toContain("value='&quot;q&amp;a session&quot;'");
  });
  it("the API list creates labels then filters, with only label add and INBOX/UNREAD removal", () => {
    const api = exportApi(parsed.file, { slug: "acme-travel" });
    expect(api.requests.filter((r) => r.method === "labels.create").map((r) => (r.body as { name: string }).name)).toEqual(["hub", "hub/calendar", "hub/client", "hub/cold-outreach", "hub/marketing", "hub/partner", "hub/security", "hub/service"]);
    const labelIdx = api.requests.findIndex((r) => r.method === "filters.create");
    expect(api.requests.slice(0, labelIdx).every((r) => r.method === "labels.create")).toBe(true);
    const json = JSON.stringify(api);
    expect(json).not.toMatch(/TRASH|SPAM|forward/i);
    for (const r of api.requests.filter((x) => x.method === "filters.create")) {
      const a = (r.body as { action: { addLabelIds: string[]; removeLabelIds?: string[] } }).action;
      expect(Object.keys(a).every((k) => k === "addLabelIds" || k === "removeLabelIds")).toBe(true);
      for (const id of a.removeLabelIds ?? []) expect(["INBOX", "UNREAD"]).toContain(id);
    }
    expect(hasErrors([])).toBe(false);
  });
});

describe("mail classes come from the kind", () => {
  const row = (cat: string, action = "label") => `## Rules\n\n| Match | Category | Label | Action | Why | Date | By |\n|---|---|---|---|---|---|---|\n| from:pay@example.com | ${cat} | hub/${cat} | ${action} | invoice | 2026-11-15 | owner |\n`;

  it("accepts a class of the kind and refuses it under the generic set", async () => {
    const { KINDS } = await import("@hub/projects");
    const saas = KINDS["software-support"]!.mailClasses;
    expect(parseRulesFile(row("billing"), saas).issues).toEqual([]);
    expect(parseRulesFile(row("billing")).issues.map((i) => i.code)).toEqual(["bad_category"]);
  });

  it("takes skippable, never-spam and color from the class data", async () => {
    const { KINDS } = await import("@hub/projects");
    const { colorTable } = await import("../src/index.js");
    const saas = KINDS["software-support"]!.mailClasses;
    const f = parseRulesFile(row("billing", "label+skip+read"), saas).file;
    expect(checkRules(f).map((i) => i.code)).toContain("skip_not_allowed");
    const ok = parseRulesFile(row("billing"), saas).file;
    expect(buildFilters(ok)[0]!.neverSpam).toBe(true);
    expect(colorTable(ok).find((r) => r.label === "hub/billing")?.color.name).toBe("Light green");
  });
});

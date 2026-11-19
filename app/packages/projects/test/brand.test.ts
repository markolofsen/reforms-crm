import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyBrandRow, brandChecks, headersFromText, lineVariants, ownSignoff, parseProjectMd, replyLanguage, resolveBrand, signatureFor, signatureLines, signBody, signingNames, type LoadedProject } from "../src/index";

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
    expect(signatureFor({ signoff: "Thanks,", brands: [], languages: ["en"] }, null)).toEqual({ lines: ["Thanks,"], placeholder: false });
    expect(signatureFor({ signoff: "", brands: [], languages: ["en"] }, null)).toEqual({ lines: [], placeholder: false });
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

// P65 S2 (P60 findings 1 and 2): the agent's own closing is found, never edited; the signature follows the reply's language.
describe("the reply's language and the agent's own closing (P65 S2)", () => {
  it("a reply is Russian when more than half its letters are Cyrillic; the quote does not count", () => {
    expect(replyLanguage("Здравствуйте, Марк! API отдаёт цены.")).toBe("ru");
    expect(replyLanguage("Hello Mark, the API is fine.\n\n> Здравствуйте, длинная цитата на русском языке")).toBe("en");
    expect(replyLanguage("")).toBe("en");
  });

  it("a configured line splits into language variants; untagged parts are for every language", () => {
    expect(lineVariants("en: Best regards, | ru: С уважением,")).toEqual([{ lang: "en", text: "Best regards," }, { lang: "ru", text: "С уважением," }]);
    expect(lineVariants("Carapis team")).toEqual([{ lang: "*", text: "Carapis team" }]);
  });

  it("signatureFor picks the reply's language, keeps untagged lines, and falls back to English with `fallback`", () => {
    const brands = [{ name: "B", receivesAt: ["b.example"], signature: ["en: B team | ru: Команда B", "b.example"], answered: "2026-11-19", by: "owner" as const }];
    const r = { brand: "B", wroteTo: "info@b.example" };
    const languages = ["en"];
    expect(signatureFor({ signoff: "en: Best regards, | ru: С уважением,", brands, languages }, r, "ru")).toEqual({ lines: ["С уважением,", "Команда B", "b.example"], placeholder: false });
    expect(signatureFor({ signoff: "en: Best regards, | ru: С уважением,", brands, languages }, r, "en")).toEqual({ lines: ["Best regards,", "B team", "b.example"], placeholder: false });
    expect(signatureFor({ signoff: "en: Best regards,", brands: [], languages: ["en", "ru"] }, null, "ru")).toEqual({ lines: ["Best regards,"], placeholder: false, fallback: "ru" });
    // Untagged lines are written in the project's languages (P65 live send check: send_log 1 was a Russian reply signed
    // "Best regards," under `languages: en` with no check). Outside them: the check; inside: none.
    expect(signatureFor({ signoff: "Warm regards,", brands: [], languages }, null, "ru")).toEqual({ lines: ["Warm regards,"], placeholder: false, fallback: "ru" });
    expect(signatureFor({ signoff: "Warm regards,", brands: [], languages: ["en", "ru-RU"] }, null, "ru")).toEqual({ lines: ["Warm regards,"], placeholder: false });
    expect(signatureFor({ signoff: "Warm regards,", brands: [], languages }, null, "en")).toEqual({ lines: ["Warm regards,"], placeholder: false });
    expect(signatureFor({ signoff: "", brands: [], languages }, null, "ru")).toEqual({ lines: [], placeholder: false });
    expect(signatureLines({ signoff: "en: Best regards, | ru: С уважением,", brands })).toEqual(["Best regards,", "С уважением,", "B team", "Команда B", "b.example"]);
  });

  it("ownSignoff finds a closing in the last four lines (a phrase alone or with a short name, or the project's own lines), and nothing else", () => {
    expect(ownSignoff("Здравствуйте!\n\nОтвет.\n\nС теплом,\nкоманда Carapis")).toBe("С теплом,");
    expect(ownSignoff("Hi,\n\nAnswer.\n\nBest regards, Mark")).toBe("Best regards, Mark");
    expect(ownSignoff("Hi,\n\nAnswer.\n\nCarapis team", ["en: Carapis team | ru: Команда Carapis"].flatMap((l) => lineVariants(l).map((v) => v.text)))).toBe("Carapis team");
    expect(ownSignoff("Hi,\n\nThank you for your patience, we will answer tomorrow.")).toBeNull();
    expect(ownSignoff("Hi,\n\nThanks, we will answer tomorrow.")).toBeNull();
    expect(ownSignoff("Best regards,\nline 2\nline 3\nline 4\nline 5\nline 6")).toBeNull();
    expect(ownSignoff("Hi,\n\nAnswer.\n\n> Best regards,\n> Client")).toBeNull();
  });

  // P65 live send check: send_log 1 ended "С теплом и дружеским поклоном,\nКоманда Carapis" above the writer's signature.
  describe("ownSignoff in any language, by structure (P65 live send check)", () => {
    const names = ["Carapis", "GPT-Kino", "MLS Bali", "Dan Merriam", "Carapis team"];
    const own = ["Best regards,", "Carapis team", "carapis.com"];
    const refused: Array<[string, string]> = [
      ["Здравствуйте, Марк!\n\nВот стихотворение.\n\nС теплом и дружеским поклоном,\nКоманда Carapis", "С теплом и дружеским поклоном,"],
      ["Здравствуйте!\n\nОтвет.\n\nКоманда Carapis", "Команда Carapis"],
      ["Hi,\n\nAnswer.\n\nCarapis team", "Carapis team"],
      ["Hi,\n\nAnswer.\n\nThe GPT-Kino team", "The GPT-Kino team"],
      ["Hi,\n\nAnswer.\n\nThanks,\nMark", "Thanks,"],
      ["Hi,\n\nAnswer.\n\nWith gratitude and every good wish,\nDan Merriam", "With gratitude and every good wish,"],
      ["Hallo,\n\nDie Antwort.\n\nMit freundlichen Grüßen\nIhr Carapis Team", "Mit freundlichen Grüßen"],
      ["Hola,\n\nLa respuesta.\n\nUn cordial saludo,\nEl equipo de Carapis", "Un cordial saludo,"],
      ["Bonjour,\n\nLa réponse.\n\nBien à vous,\nL'équipe Carapis", "Bien à vous,"],
      ["Bonjour,\n\nLa réponse.\n\nCordialement", "Cordialement"],
      ["Olá,\n\nA resposta.\n\nAtenciosamente,\nEquipa Carapis", "Atenciosamente,"],
      ["Ciao,\n\nLa risposta.\n\nCordiali saluti,\nIl team Carapis", "Cordiali saluti,"],
      ["Добрий день,\n\nВідповідь.\n\nЗ повагою,\nКоманда Carapis", "З повагою,"],
      ["Hi,\n\nAnswer.\n\nWarm wishes from all of us,\nMLS Bali", "Warm wishes from all of us,"],
      ["Hi,\n\nAnswer.\n\nCarapis team\ncarapis.com", "Carapis team"],
    ];
    for (const [body, line] of refused) it(`refuses ${JSON.stringify(body.split("\n").slice(-2).join(" / "))}`, () => expect(ownSignoff(body, own, names)).toBe(line));

    const kept = [
      "Hi Mark,\n\nThe API returns prices for every market. Let me know if anything is unclear.",
      "Hi,\n\nThanks, we will answer tomorrow.",
      "Hi,\n\nDetails: carapis.com/pricing",
      "Hi,\n\nThe plans are:\nBasic,\nPro",
      "Hi,\n\nHere is what changed,\n- the price field\n- the VIN field",
      "Hi,\n\nIn the night,\nthe stars came out over the sea.",
      "Hi,\n\nCarapis returns the price, the mileage and the VIN for every listing.",
      "Здравствуйте!\n\nДа, API Carapis отдаёт цены по всем рынкам. Если нужно, пришлём пример запроса.",
      "Hallo,\n\nVielen Dank für Ihre Geduld, wir antworten morgen.",
      "Hi,\n\nAnswer.\n\n> Best regards,\n> Carapis team",
      "Hi Anna,\nYes",
    ];
    for (const body of kept) it(`keeps ${JSON.stringify(body.split("\n").slice(-2).join(" / "))}`, () => expect(ownSignoff(body, own, names)).toBeNull());

    it("signingNames: brand names and the non-domain signature lines, never the sign-off", () => {
      const brands = [{ name: "Carapis", receivesAt: ["carapis.com"], signature: ["Carapis team", "carapis.com"], answered: "2026-11-19", by: "owner" as const }];
      expect(signingNames({ signoff: "Best regards,", brands })).toEqual(["Carapis", "Carapis team"]);
    });
  });
});

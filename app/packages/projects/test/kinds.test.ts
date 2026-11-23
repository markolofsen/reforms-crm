import { describe, expect, it } from "vitest";
import { DEFAULT_KIND, FIELDS, hasValue, hasErrors, Kind, KINDS, KIND_IDS, MODULES, parseProjectMd, ProjectBase, checkValue, type ProjectConfig } from "../src/index";

const ID = "00000000-0000-4000-8000-000000000001";
const ID2 = ID.replace(/1$/, "2");
const doc = (rows: string[], dbs = ["clients", "documents"]) =>
  [
    "# T",
    "",
    "## Settings",
    "",
    "| Field | Value | Answered | By |",
    "|---|---|---|---|",
    "| schema | 1 | 2026-11-14 | agent |",
    "| status | active | 2026-11-14 | agent |",
    ...rows,
    "",
    "## Notion databases",
    "",
    ...dbs.map((d, i) => `- ${d}: ${i ? ID2 : ID}`),
    "",
  ].join("\n");
const row = (f: string, v: string) => `| ${f} | ${v} | 2026-11-14 | agent |`;
const MAIL = [row("mail.accounts", "a@t.example"), row("tone", "brief")];
const errors = (text: string) => parseProjectMd(text, "t").issues.filter((i) => i.severity === "error");

describe("the kind registry is data", () => {
  it("ships generic, sales-pipeline, software-support and shop; every entry passes the Kind schema", () => {
    expect(KIND_IDS).toEqual(["generic", "sales-pipeline", "software-support", "shop"]);
    for (const k of Object.values(KINDS)) expect(Kind.safeParse(k).success, k.id).toBe(true);
    expect(DEFAULT_KIND).toBe("generic");
  });
  it("every required path is a path the resolved config has, and every module is a known module", () => {
    const empty = ProjectBase.parse({ schema: 1, slug: "x", kind: "generic", name: "x" });
    for (const k of Object.values(KINDS)) {
      for (const m of k.modules) expect(MODULES).toContain(m);
      for (const path of k.required) {
        const top = path.split(".")[0] as string;
        expect(top in empty || top === "tone", `${k.id}: ${path}`).toBe(true);
        if (path.startsWith("notion.")) expect(k.modules, `${k.id} requires ${path} without the notion module`).toContain("notion");
        if (path.startsWith("mail.")) expect(k.modules).toContain("mail");
      }
      if (k.notionModules.length) expect(k.modules, k.id).toContain("notion");
      if (!k.modules.includes("notion")) expect(k.notionModules, k.id).toEqual([]);
    }
  });
  it("software-support runs campaigns (P85) but has no calendar until a connector is attached (decision 0045 point 12)", () => {
    const k = KINDS["software-support"];
    expect(k?.skills).toContain("bulk-drafts");
    expect(k?.modules).toContain("bulk");
    expect(k?.skills).not.toContain("calendar");
  });
  it("generic reproduces the required set that was hard-coded before kinds existed", () => {
    expect([...(KINDS.generic?.required ?? [])].sort()).toEqual(["mail.accounts", "mail.sender", "notion.databases.clients", "tone"]);
  });
  it("mail classes: unique ids; the generic set is the eight classes every rule file uses", () => {
    for (const k of Object.values(KINDS)) expect(new Set(k.mailClasses.map((c) => c.id)).size, k.id).toBe(k.mailClasses.length);
    expect(KINDS.generic?.mailClasses.map((c) => c.id)).toEqual(["client", "partner", "security", "calendar", "service", "marketing", "cold-outreach", "spam"]);
  });
  it("kinds are neutral: no owner, product or place names", () => {
    // no domain, no e-mail address: a kind is a profile, not an instance
    expect(JSON.stringify(KINDS)).not.toMatch(/@|\.(com|ai|io)\b/i);
  });
  it("allowed skills of a kind exist as folders in skills/", async () => {
    const { existsSync } = await import("node:fs");
    const { join, resolve } = await import("node:path");
    const skills = resolve(import.meta.dirname, "../../../../skills");
    if (!existsSync(skills)) return;
    for (const k of Object.values(KINDS)) for (const s of k.skills) expect(existsSync(join(skills, s, "SKILL.md")), `${k.id}: ${s}`).toBe(true);
  });
});

describe("kind row in project.md", () => {
  it("defaults to generic and is stored in the config with the kind's modules", () => {
    const c = parseProjectMd(doc(MAIL), "t").config;
    expect(c.kind).toBe("generic");
    expect(c.modules).toEqual(KINDS.generic?.modules);
  });
  it("an unknown kind is an error naming the known ones; the writer refuses it too", () => {
    const e = errors(doc([...MAIL, row("kind", "retail")]));
    expect(e.map((i) => i.code)).toEqual(["bad_value"]);
    expect(e[0]?.message).toMatch(/unknown kind "retail"; kinds: generic, sales-pipeline, software-support, shop/);
    expect(checkValue("kind", "retail")).toMatch(/unknown kind/);
    expect(checkValue("kind", "shop")).toBeNull();
  });
  it("the kind decides what is required: sales-pipeline wants leads, shop wants no Notion", () => {
    const realty = errors(doc([...MAIL, row("kind", "sales-pipeline")]));
    expect(realty).toHaveLength(1);
    expect(realty[0]).toMatchObject({ code: "missing_required", field: "notion.databases" });
    expect(realty[0]?.message).toContain('"leads"');
    expect(errors(doc([...MAIL, row("kind", "sales-pipeline")], ["clients", "leads", "documents"]))).toEqual([]);
    expect(errors(doc([...MAIL, row("kind", "shop")], []))).toEqual([]);
    expect(errors(doc(MAIL, []))).toHaveLength(1); // generic: clients (reports are documents, decision 0022; documents are optional)
  });
  it("a missing required field is a warning while the project is a draft", () => {
    const p = parseProjectMd(doc([row("kind", "sales-pipeline"), row("status", "draft")]).replace("| status | active | 2026-11-14 | agent |\n", ""), "t");
    expect(hasErrors(p.issues)).toBe(false);
    expect(p.incomplete).toBe(true);
  });
  it("archived is a status; nothing else is", () => {
    expect(parseProjectMd(doc(MAIL).replace("| status | active |", "| status | archived |"), "t").config.status).toBe("archived");
    expect(checkValue("status", "gone")).toMatch(/expected one of draft, active, paused, archived/);
  });
});

describe("one schema", () => {
  it("every Settings field lands on a path ProjectBase has", () => {
    const c = ProjectBase.parse({ schema: 1, slug: "x", kind: "generic", name: "x" }) as unknown as Record<string, unknown>;
    for (const [f, def] of Object.entries(FIELDS)) {
      let cur: unknown = c;
      for (const seg of def.path.split(".")) {
        expect(cur !== null && typeof cur === "object" && seg in (cur as object), `${f} -> ${def.path}`).toBe(true);
        cur = (cur as Record<string, unknown>)[seg];
      }
    }
  });
  it("ProjectBase rejects a drifted registry row", () => {
    expect(ProjectBase.safeParse({ schema: 1, slug: "x" }).success).toBe(false);
    expect(ProjectBase.safeParse({ schema: 1, slug: "x", kind: "generic", name: "x", status: "retired" }).success).toBe(false);
  });
  it("hasValue reads dotted paths, array elements by slug and text", () => {
    const c: ProjectConfig = parseProjectMd(doc(MAIL), "t").config;
    expect(hasValue(c, "tone")).toBe(true);
    expect(hasValue(c, "mail.accounts")).toBe(true);
    expect(hasValue(c, "notion.databases.clients")).toBe(true);
    expect(hasValue(c, "notion.databases.leads")).toBe(false);
    expect(hasValue(c, "calendar.name")).toBe(false);
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkValue, extractDatabases, hasErrors, normalizeAddress, parseProjectMd, readProject, ProjectError } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const schemaV1Fixture = (name: string) => readFileSync(join(here, "fixtures", name, "project.md"), "utf8");
const fixture = (name: string) => readFileSync(join(here, "fixtures", "projects", name, "project.md"), "utf8");

const ID = "00000000-0000-4000-8000-000000000001";
/** A minimal valid active project; tests break one thing at a time. */
const base = (rows: string[] = []) =>
  [
    "# T",
    "",
    "## Settings",
    "",
    "| Field | Value | Answered | By |",
    "|---|---|---|---|",
    "| schema | 1 | 2026-11-14 | agent |",
    "| status | active | 2026-11-14 | agent |",
    "| mail.accounts | a@t.example | 2026-11-14 | agent |",
    "| tone | brief | 2026-11-14 | owner |",
    ...rows,
    "",
    "## Notion databases",
    "",
    `- clients: ${ID}`,
    `- reports: ${ID.replace(/1$/, "2")}`,
    "",
  ].join("\n");

const codes = (text: string) => parseProjectMd(text, "t").issues.filter((i) => i.severity === "error").map((i) => i.code);

describe("the example of doc 16", () => {
  const p = parseProjectMd(fixture("acme-travel"), "acme-travel");
  it("has no issue", () => expect(p.issues).toEqual([]));
  it("reads every field with its type", () => {
    expect(p.config).toMatchObject({
      schema: 1,
      name: "Acme Travel",
      status: "active",
      languages: ["en", "de"],
      timezone: null,
      mail: { accounts: ["owner@acme.example"], addresses: ["owner@acme.example", "hello@acme.example"], aliases: [], mailboxes: ["INBOX"], sentMailbox: "Sent Mail", sender: "hello@acme.example" },
      draft: { recipients: "test" },
      tone: "warm, brief, no exclamation marks",
      signoff: "",
      knowledge: { source: "files" },
      setup: { completed: null, doctor: "2026-11-15 pass" },
    });
    expect(p.config.notion.databases.map((d) => d.slug)).toEqual(["clients", "reports"]);
    expect(p.summary).toContain("Boutique travel agency");
    expect(p.answers).toHaveLength(1);
    expect(p.settings["status"]).toMatchObject({ value: "active", answered: "2026-11-15", by: "agent" });
  });
  it("applies defaults", () => {
    const d = parseProjectMd(base(), "t").config;
    expect(d.languages).toEqual(["en"]);
    expect(d.draft.recipients).toBe("test");
    expect(d.mail.addresses).toEqual(["a@t.example"]);
    expect(d.mail.sender).toBe("a@t.example");
    expect(d.notion.tokenFile).toBe("notion-token");
    expect(d.knowledge.source).toBe("files");
  });
  it("mail.aliases is routable: merged into addresses after the declared ones, normalised, no duplicates", () => {
    const d = parseProjectMd(base(["| mail.aliases | INFO@t.example, a@t.example, Info+x@t.example | 2026-11-14 | owner |"]), "t").config;
    expect(d.mail.aliases).toEqual(["info@t.example", "a@t.example"]);
    expect(d.mail.addresses).toEqual(["a@t.example", "info@t.example"]);
    expect(d.mail.sender).toBe("a@t.example");
    expect(parseProjectMd(base(["| mail.aliases | not-an-address | 2026-11-14 | owner |"]), "t").issues.map((i) => i.code)).toContain("bad_value");
  });
  it("reads notion.parent_page and normalises the id", () => {
    expect(parseProjectMd(base(), "t").config.notion.parentPage).toBeNull();
    const p = parseProjectMd(base(["| notion.parent_page | AAAA3333000040008000000000000003 | 2026-11-14 | agent |"]), "t");
    expect(hasErrors(p.issues)).toBe(false);
    expect(p.config.notion.parentPage).toBe("aaaa3333-0000-4000-8000-000000000003");
  });
  it("knowledge.source is files: an old knowledge database line is ignored, notion/both are errors", () => {
    const withDb = `${base()}- knowledge: ${ID.replace(/1$/, "3")}\n`;
    expect(parseProjectMd(withDb, "t").config.knowledge.source).toBe("files");
    for (const v of ["notion", "both"]) {
      const p = parseProjectMd(base([`| knowledge.source | ${v} | 2026-11-14 | owner |`]), "t");
      expect(p.config.knowledge.source).toBe("files");
      expect(hasErrors(p.issues)).toBe(true);
    }
  });
});

describe("schema 1 is the only format", () => {
  it("the demo fixture parses with its five databases and no error", () => {
    const p = parseProjectMd(schemaV1Fixture("schema-v1-demo"), "demo");
    expect(hasErrors(p.issues)).toBe(false);
    expect(p.databases.map((d) => d.slug)).toEqual(["clients", "leads", "workflows", "knowledge", "reports"]);
  });
  it("a file with no ## Settings is an error that names the fix, not a half-read project", () => {
    const p = parseProjectMd(`# x\n\nTeamspace "CRM: x".\n\n- clients: 00000000-0000-4000-8000-000000000001\n`, "x");
    expect(p.issues.find((i) => i.code === "schema_required")).toMatchObject({ severity: "error", message: expect.stringContaining("schema 1 required: this project.md has no ## Settings table; run the project-setup skill") });
    // the loose list is not read as databases
    expect(p.databases).toEqual([]);
    expect(p.issues.some((i) => i.code === "stray_list_item")).toBe(true);
  });
});

describe("precise errors", () => {
  it("unknown schema version", () => {
    const p = parseProjectMd(base().replace("| schema | 1 |", "| schema | 2 |"), "t");
    expect(p.issues).toHaveLength(1);
    expect(p.issues[0]).toMatchObject({ code: "unknown_schema", field: "schema", severity: "error" });
    expect(p.issues[0]?.message).toMatch(/schema 2 is not supported/);
    expect(p.issues[0]?.line).toBe(7);
  });

  it("missing required field on an active project, with the field named", () => {
    const text = base().replace("| tone | brief | 2026-11-14 | owner |\n", "");
    const issue = parseProjectMd(text, "t").issues.find((i) => i.code === "missing_required");
    expect(issue).toMatchObject({ severity: "error", field: "tone" });
  });

  it("the same gap is only a warning while the project is a draft", () => {
    const text = base().replace("| status | active |", "| status | draft |").replace("| tone | brief | 2026-11-14 | owner |\n", "");
    const p = parseProjectMd(text, "t");
    expect(hasErrors(p.issues)).toBe(false);
    expect(p.incomplete).toBe(true);
    expect(p.issues.some((i) => i.code === "missing_required" && i.severity === "warning")).toBe(true);
  });

  it("requires the clients and reports databases, ; a notion knowledge source does not require a knowledge database", () => {
    const noReports = base().replace(/- reports: .*\n/, "");
    expect(parseProjectMd(noReports, "t").issues.find((i) => i.code === "missing_required")?.message).toMatch(/"reports"/);
    const notionSource = base(["| knowledge.source | notion | 2026-11-14 | owner |"]);
    expect(parseProjectMd(notionSource, "t").issues.find((i) => i.code === "missing_required")).toBeUndefined();
  });

  it("bad date", () => {
    const p = parseProjectMd(base(["| languages | en | 2026-13-40 | owner |"]), "t");
    expect(p.issues.find((i) => i.code === "bad_date")).toMatchObject({ field: "languages", line: 11 });
    expect(codes(base(["| languages | en | 14.11.2026 | owner |"]))).toContain("bad_date");
  });

  it("a `- key: value` item outside the databases section", () => {
    const text = `${base()}\n## Notes\n\n- remember: call on Monday\n`;
    const issue = parseProjectMd(text, "t").issues.find((i) => i.code === "stray_list_item");
    expect(issue?.severity).toBe("error");
    expect(issue?.line).toBe(19);
    expect(issue?.message).toMatch(/outside "## Notion databases"/);
  });

  it("a list item in a fenced block is prose", () => {
    const text = `${base()}\n## Notes\n\n\`\`\`\n- remember: call on Monday\n\`\`\`\n`;
    expect(codes(text)).toEqual([]);
  });

  it("bad values per type", () => {
    expect(codes(base(["| languages | english | 2026-11-14 | owner |"]))).toContain("bad_value");
    expect(codes(base(["| timezone | Mars/Base | 2026-11-14 | owner |"]))).toContain("bad_value");
    expect(codes(base(["| run.quiet_hours | 22-07 | 2026-11-14 | owner |"]))).toContain("bad_value");
    expect(codes(base(["| run.max_messages | 0 | 2026-11-14 | owner |"]))).toContain("bad_value");
    expect(codes(base(["| draft.recipients | everyone | 2026-11-14 | owner |"]))).toContain("bad_value");
    expect(codes(base(["| notion.token_file | /var/secrets/token | 2026-11-14 | owner |"]))).toContain("bad_value");
    expect(codes(base(["| notion.parent_page | reforms-crm deploy scratch | 2026-11-14 | owner |"]))).toContain("bad_value");
    expect(codes(base(["| setup.doctor | pass | 2026-11-14 | agent |"]))).toContain("bad_value");
    expect(codes(base().replace("| status | active |", "| status | live |"))).toContain("bad_value");
  });

  it("clients.high_value_eur is gone: the old row is an unknown field", () => {
    expect(codes(base(["| clients.high_value_eur | 400000 | 2026-11-14 | owner |"]))).toContain("unknown_field");
  });

  it("unknown field, duplicate row, bad By, bad table", () => {
    expect(codes(base(["| colour | blue | 2026-11-14 | owner |"]))).toContain("unknown_field");
    expect(codes(base(["| tone | loud | 2026-11-14 | owner |"]))).toContain("duplicate_row");
    expect(codes(base(["| languages | en | 2026-11-14 | boss |"]))).toContain("bad_by");
    expect(codes(base(["| languages | en | 2026-11-14 |"]))).toContain("bad_table");
    expect(codes(base().replace("| Field | Value | Answered | By |", "| Name | Value |"))).toContain("bad_table");
  });

  it("databases need a valid, unique id", () => {
    expect(codes(base().replace(`- clients: ${ID}`, "- clients: not-an-id"))).toContain("bad_database_id");
    expect(codes(`${base()}- reports: ${ID}\n`)).toContain("duplicate_database");
  });

  it("the folder name must be a slug", () => {
    expect(parseProjectMd(base(), "Bad Name").issues.some((i) => i.code === "bad_slug")).toBe(true);
  });

  it("readProject throws a ProjectError carrying the issues", () => {
    expect(() => readProject(base().replace("| schema | 1 |", "| schema | 9 |"), "t")).toThrow(ProjectError);
  });
});

describe("cells and addresses", () => {
  it("reads an escaped pipe inside a value", () => {
    const p = parseProjectMd(base(["| signoff | Best \\| Acme | 2026-11-14 | owner |"]), "t");
    expect(p.config.signoff).toBe("Best | Acme");
  });
  it("an empty value is an empty cell", () => {
    expect(parseProjectMd(base(["| signoff |  | 2026-11-14 | default |"]), "t").config.signoff).toBe("");
    expect(checkValue("languages", "")).toBeNull();
  });
  it("normalises addresses", () => {
    expect(normalizeAddress("Hello <Hello+Form@Acme.Example>")).toBe("hello@acme.example");
    expect(normalizeAddress("  A@B.C ")).toBe("a@b.c");
  });
});

describe("the notion view of the file", () => {
  it("the Settings table is invisible to the databases reader", () => {
    const r = extractDatabases(fixture("acme-travel"));
    expect(r.issues).toEqual([]);
    expect(r.databases).toHaveLength(2);
    expect(r.name).toBe("Acme Travel");
  });
  it("a loose list with no `## Notion databases` heading is not read as databases", () => {
    const r = extractDatabases(`# acme\n\nprose\n\n- clients: ${ID}\n`);
    expect(r.databases).toEqual([]);
  });
});


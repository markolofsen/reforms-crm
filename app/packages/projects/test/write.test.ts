import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { appendAnswer, applyAnswer, applySetting, ensureDatabasesHeading, hasErrors, parseProjectMd, ProjectError, writeSetting } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const acme = readFileSync(join(here, "fixtures", "projects", "acme-travel", "project.md"), "utf8");
const ID = "00000000-0000-4000-8000-000000000001";

/** Lines that differ between two texts (as a multiset), to prove everything else is untouched. */
const changed = (a: string, b: string) => {
  const al = a.split("\n");
  const bl = b.split("\n");
  return { removed: al.filter((l) => !bl.includes(l)), added: bl.filter((l) => !al.includes(l)) };
};

describe("applySetting", () => {
  it("writes run.max_messages and the parser reads it back", () => {
    const out = applySetting(acme, "run.max_messages", "40", "owner", "2026-11-20");
    expect(parseProjectMd(out, "acme-travel").config.run.maxMessages).toBe(40);
  });

  it("replaces one row and touches nothing else", () => {
    const out = applySetting(acme, "tone", "formal", "owner", "2026-11-20");
    expect(changed(acme, out)).toEqual({
      removed: ["| tone | warm, brief, no exclamation marks | 2026-11-14 | owner |"],
      added: ["| tone | formal | 2026-11-20 | owner |"],
    });
    expect(out.split("\n")).toHaveLength(acme.split("\n").length);
    expect(parseProjectMd(out, "acme-travel").config.tone).toBe("formal");
  });

  it("adds a new row after the last row of the table", () => {
    const out = applySetting(acme, "timezone", "Europe/Berlin", "default", "2026-11-20");
    expect(changed(acme, out)).toEqual({ removed: [], added: ["| timezone | Europe/Berlin | 2026-11-20 | default |"] });
    const lines = out.split("\n");
    const idx = lines.indexOf("| timezone | Europe/Berlin | 2026-11-20 | default |");
    expect(lines[idx - 1]).toBe("| setup.doctor | 2026-11-15 pass | 2026-11-15 | agent |");
    expect(lines[idx + 1]).toBe("");
    expect(parseProjectMd(out, "acme-travel").config.timezone).toBe("Europe/Berlin");
  });

  it("round-trips: setting a row to its own value changes nothing but the date", () => {
    const out = applySetting(acme, "languages", "en, de", "owner", "2026-11-14");
    expect(out).toBe(acme);
  });

  it("escapes a pipe, and refuses a value with a line break", () => {
    const out = applySetting(acme, "signoff", "Best | Acme Team", "owner", "2026-11-20");
    expect(out).toContain("| signoff | Best \\| Acme Team | 2026-11-20 | owner |");
    expect(parseProjectMd(out, "acme-travel").config.signoff).toBe("Best | Acme Team");
    expect(() => applySetting(acme, "signoff", "Best\nTeam", "owner", "2026-11-20")).toThrow(/expected one line/);
  });

  it("keeps CRLF files CRLF", () => {
    const crlf = acme.replace(/\n/g, "\r\n");
    const out = applySetting(crlf, "tone", "formal", "owner", "2026-11-20");
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    expect(parseProjectMd(out, "acme-travel").config.tone).toBe("formal");
    const added = applySetting(crlf, "timezone", "UTC", "agent", "2026-11-20");
    expect(added.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("refuses an invalid value, an unknown field and the databases pseudo-field", () => {
    expect(() => applySetting(acme, "status", "live", "owner", "2026-11-20")).toThrow(ProjectError);
    expect(() => applySetting(acme, "colour", "blue", "owner", "2026-11-20")).toThrow(/unknown field/);
    expect(() => applySetting(acme, "notion.databases", "x", "owner", "2026-11-20")).toThrow(ProjectError);
    expect(() => applySetting(acme, "tone", "x", "owner", "20-11-2026")).toThrow(/ISO date/);
  });

  it("adopts a legacy file: heading above the untouched list, then a Settings section", () => {
    const legacy = `# acme\n\nTeamspace "CRM: acme".\n\n- clients: ${ID}\n- reports: ${ID.replace(/1$/, "2")}\n`;
    const out = applySetting(legacy, "schema", "1", "agent", "2026-11-20");
    expect(out).toContain(`## Settings\n\n| Field | Value | Answered | By |\n|---|---|---|---|\n| schema | 1 | 2026-11-20 | agent |\n\n## Notion databases\n\n- clients: ${ID}\n- reports:`);
    const p = parseProjectMd(out, "acme");
    expect(p.mode).toBe("v1");
    expect(hasErrors(p.issues)).toBe(false);
    expect(p.databases).toHaveLength(2);
    // the list lines are byte-identical
    expect(out).toContain(`- clients: ${ID}\n- reports: ${ID.replace(/1$/, "2")}\n`);
    expect(out.startsWith('# acme\n\nTeamspace "CRM: acme".\n\n')).toBe(true);
  });

  it("creates Settings at the end of a file that has sections but no Settings", () => {
    const text = `# x\n\n## Notes\n\nhello\n`;
    const out = applySetting(text, "schema", "1", "agent", "2026-11-20");
    expect(out.indexOf("## Settings")).toBeLessThan(out.indexOf("## Notes"));
    expect(out.endsWith("hello\n")).toBe(true);
  });

  it("ensureDatabasesHeading leaves a sectioned file alone", () => {
    expect(ensureDatabasesHeading(acme)).toBe(acme);
  });
});

describe("applyAnswer", () => {
  it("appends to the Answers table and keeps the log append-only", () => {
    const out = applyAnswer(acme, { date: "2026-11-20", field: "tone", question: "Which tone?", answer: "formal" });
    expect(changed(acme, out)).toEqual({ removed: [], added: ["| 2026-11-20 | tone | Which tone? | formal |"] });
    const p = parseProjectMd(out, "acme-travel");
    expect(p.answers.map((a) => a.field)).toEqual(["draft.recipients", "tone"]);
    expect(out.indexOf("| 2026-11-20 | tone")).toBeLessThan(out.indexOf("## Notes"));
  });

  it("creates the section before Notes when missing", () => {
    const out = applyAnswer(`# x\n\n## Settings\n\n| Field | Value | Answered | By |\n|---|---|---|---|\n\n## Notes\n\nn\n`, { date: "2026-11-20", field: "a", question: "q|q", answer: "yes" });
    expect(out).toContain("## Answers\n\n| Date | Field | Question | Answer |\n|---|---|---|---|\n| 2026-11-20 | a | q\\|q | yes |\n\n## Notes");
  });
});

describe("file wrappers", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it("write in place and leave no temp file", () => {
    const dir = mkdtempSync(join(tmpdir(), "hub-proj-"));
    dirs.push(dir);
    cpSync(join(here, "fixtures", "projects", "acme-travel", "project.md"), join(dir, "project.md"));
    writeSetting(dir, "tone", "calm", "owner", "2026-11-21");
    appendAnswer(dir, { field: "tone", question: "Tone?", answer: "calm", date: "2026-11-21" });
    const text = readFileSync(join(dir, "project.md"), "utf8");
    const p = parseProjectMd(text, "acme-travel");
    expect(p.config.tone).toBe("calm");
    expect(p.answers).toHaveLength(2);
    expect(hasErrors(p.issues)).toBe(false);
    writeFileSync(join(dir, "x"), "");
  });
});

import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { personalChecklist, personalText, type PersonalFacts } from "../src/setup/personal";
import { personFile, personProblem, readPerson, situationOf, syncedFolder, writePerson } from "../src/setup/situation";

// P89 verdicts 6, 7 and 15: the smart setup's situation, the person file, the personal checklist and the synced-folder guard.
const project = (projects: string, slug: string, rows: string) => {
  mkdirSync(path.join(projects, slug), { recursive: true });
  writeFileSync(path.join(projects, slug, "project.md"), `# ${slug}\n\n## Settings\n\n| Field | Value | Answered | By |\n|---|---|---|---|\n| schema | 1 | 2026-11-20 | default |\n${rows}`);
};
const place = () => {
  const home = mkdtempSync(path.join(tmpdir(), "hub-team-"));
  return { home, projects: path.join(home, "projects"), db: path.join(home, "data", "app.db"), state: path.join(home, "state") };
};

describe("situationOf", () => {
  it("new: no project, or only draft projects (a fresh new-instance or a starter)", () => {
    const p = place();
    expect(situationOf(p).situation).toBe("new");
    project(p.projects, "my-product", "| status | draft | 2026-11-20 | default |\n");
    project(p.projects, "_template", "| status | active | 2026-11-20 | owner |\n");
    expect(situationOf(p)).toMatchObject({ situation: "new", sentence: expect.stringContaining("my-product") });
  });
  it("joined: a project someone set up came with the clone, and this Mac has no database", () => {
    const p = place();
    project(p.projects, "realty", "| status | active | 2026-11-19 | agent |\n");
    expect(situationOf(p)).toMatchObject({ situation: "joined", sentence: expect.stringContaining("joining an instance the team already set up (realty)") });
  });
  it("existing: this Mac has the database", () => {
    const p = place();
    project(p.projects, "saas", "| status | active | 2026-11-19 | agent |\n");
    mkdirSync(path.dirname(p.db), { recursive: true });
    writeFileSync(p.db, "");
    expect(situationOf(p).situation).toBe("existing");
  });
});

describe("the person file", () => {
  it("is state/person.json, mode 600, one trimmed line; a bad name is named", () => {
    const p = place();
    expect(readPerson(p)).toBeUndefined();
    writePerson(p, "  Anna K  ");
    expect(readPerson(p)).toEqual({ name: "Anna K" });
    expect(statSync(personFile(p)).mode & 0o777).toBe(0o600);
    expect(personProblem("")).toBeDefined();
    expect(personProblem("a\nb")).toBe("one line");
    expect(personProblem("x".repeat(81))).toBeDefined();
  });
});

describe("syncedFolder", () => {
  it("finds Google Drive, iCloud, Dropbox and OneDrive under the home; a local folder is fine", () => {
    expect(syncedFolder("/Users/a/Library/CloudStorage/GoogleDrive-a@x.com/My Drive/hub-saas", "/Users/a")).toBe("/Users/a/Library/CloudStorage");
    expect(syncedFolder("/Users/a/Library/Mobile Documents/com~apple~CloudDocs/hub", "/Users/a")).toBe("/Users/a/Library/Mobile Documents");
    expect(syncedFolder("/Users/a/Dropbox/hub", "/Users/a")).toBe("/Users/a/Dropbox");
    expect(syncedFolder("/Volumes/GoogleDrive/My Drive/hub", "/Users/a")).toBe("/Volumes/GoogleDrive");
    expect(syncedFolder("/Users/a/workspace/hub-saas", "/Users/a")).toBeUndefined();
    expect(syncedFolder("/Users/a/Dropboxed/hub", "/Users/a")).toBeUndefined();
  });
});

describe("personalChecklist", () => {
  const facts = (over: Partial<PersonalFacts> = {}): PersonalFacts => ({
    situation: "joined", projectAccounts: [{ slug: "realty", accounts: ["dan@example.com", "info@example.com"] }], mailAccounts: ["Dan@example.com"],
    clis: { ok: false, detail: "Codex: not signed in" }, autostart: { ok: true, detail: "loaded" }, notionToken: false, messengerSessions: [], firstProject: "realty", ...over,
  });
  it("names each personal item with its state and exact fix, and types nothing", () => {
    const items = personalChecklist(facts());
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by.person).toMatchObject({ state: "missing", fix: './run.sh setup --person "Your Name"' });
    expect(by["mail.realty"]).toMatchObject({ state: "missing", detail: "not in Apple Mail on this Mac: info@example.com" });
    expect(by.agent).toMatchObject({ state: "missing", detail: "Codex: not signed in" });
    expect(by["notion.connector"]?.fix).toContain("./run.sh agent realty, type /mcp");
    expect(by["notion.token"]).toMatchObject({ state: "optional" });
    expect(by["notion.token"]?.fix).toContain("password manager");
    expect(by.autostart).toMatchObject({ state: "done" });
    expect(by.messengers?.fix).toContain("your OWN account only");
    const text = personalText(items, "joined");
    expect(text).toContain("TODO Your name");
    expect(text).toContain("git pull --rebase --recurse-submodules");
  });
  it("Mail that cannot be asked is unknown, not missing; a set name and a core update are said", () => {
    const items = personalChecklist(facts({ mailAccounts: undefined, person: "Anna", coreUpdate: "origin has v0.13.0, update recommended" }));
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by["mail.realty"]).toMatchObject({ state: "unknown", fix: "open Apple Mail, then ./run.sh setup again" });
    expect(by.person).toMatchObject({ state: "done" });
    expect(by.core?.fix).toContain("one person moves the pin");
    expect(personalText(items, "new")).toContain("Never put this folder on Google Drive");
  });
});

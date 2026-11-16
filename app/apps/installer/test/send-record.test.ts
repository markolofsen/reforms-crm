import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRepos, openDb } from "@hub/db";
import { describe, expect, it } from "vitest";
import { defaultRoot } from "../src/context.ts";
import { recordDraft } from "../src/record-draft.ts";

// `hub record-draft` carries the two facts `hub send` needs and the agent alone knows: the mail class and the injection hint.
const tmp = () => mkdtempSync(path.join(tmpdir(), "hub-sendrec-"));
const projects = tmp();
cpSync(path.join(defaultRoot(), "app", "packages", "projects", "test", "fixtures", "projects", "acme-travel"), path.join(projects, "acme"), { recursive: true });
const pm = path.join(projects, "acme", "project.md");
writeFileSync(pm, readFileSync(pm, "utf8").replace("| draft.recipients | test |", "| draft.recipients | any |"));

const run = (db: string, over: Record<string, unknown>) =>
  recordDraft({ project: "acme", payload: JSON.stringify({ email: "c@example.com", subject: "Re: x", mailRef: "<m@x>", ...over }), dbPath: db, attempts: 1, projectsDir: projects });

describe("record-draft: send facts", () => {
  it("stores mailClass and injectionSuspected", async () => {
    const db = path.join(tmp(), "a.db");
    expect((await run(db, { mailClass: "client", injectionSuspected: true })).code).toBe(0);
    const h = openDb(db);
    const [d] = await createRepos(h.db).clients.list("acme");
    expect(d?.draft).toMatchObject({ mailClass: "client", injectionSuspected: true });
    h.close();
  });
  it("refuses a class the project's kind does not have", async () => {
    const r = await run(path.join(tmp(), "b.db"), { mailClass: "billing" });
    expect(r.code).toBe(2);
    expect(JSON.parse(r.line).error).toMatch(/not a class of kind generic/);
  });
  it("refuses a non-boolean flag", async () => {
    expect((await run(path.join(tmp(), "c.db"), { injectionSuspected: "yes" })).code).toBe(2);
  });
});

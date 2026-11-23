import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRepos, openDb } from "@hub/db";
import { describe, expect, it } from "vitest";
import type { MailDraft } from "@hub/mail-app/drafts";
import { FakeMailer } from "@hub/send";
import { runDraftsSweep } from "../src/drafts/sweep-command";

// `hub drafts sweep` (P56 S0, P65) with FakeMailer: nothing reaches Mail. Dry run by default; --apply moves only listed drafts, judged by the Hub's record.

const md = ["# Acme", "", "## Settings", "", "| Field | Value | Answered | By |", "|---|---|---|---|", "| schema | 1 | 2026-11-14 | agent |", "| status | active | 2026-11-15 | agent |", "| mail.accounts | owner@acme.example | 2026-11-14 | agent |", "| mail.addresses | owner@acme.example | 2026-11-14 | owner |", "| mail.sender | owner@acme.example | 2026-11-14 | owner |", "| tone | brief | 2026-11-14 | owner |", "", "## Notion databases", "", "- clients: 00000000-0000-4000-8000-000000000001", "- reports: 00000000-0000-4000-8000-000000000002", ""].join("\n");
const d = (ref: string, body: string, account = "owner@acme.example"): MailDraft => ({ ref, messageId: `M${ref}@acme.example`, account, inReplyTo: "t@x", sender: account, to: ["c@x.example"], cc: [], bcc: [], subject: "Re: hi", body, attachments: 0 });

async function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "hub-sweep-"));
  const projectsDir = path.join(dir, "projects");
  mkdirSync(path.join(projectsDir, "acme"), { recursive: true });
  writeFileSync(path.join(projectsDir, "acme", "project.md"), md);
  const dbPath = path.join(dir, "app.db");
  const handle = openDb(dbPath);
  const repos = createRepos(handle.db);
  const rec = await repos.drafts.record({ project: "acme", email: "c@x.example", name: "C", subject: "Re: hi", mailRef: "<t@x>", reason: "asked", skill: "triage-mail" });
  // The Hub recorded versions 1 and 2 of this draft; 3 is the owner's own; 4 sits in another instance's account.
  for (const ref of ["1", "2"]) await repos.mailVersions.add({ project: "acme", mailRef: "t@x", draftId: rec.draftId, account: "owner@acme.example", mailId: Number(ref), messageId: `M${ref}@acme.example`, hash: "h", source: "agent" });
  handle.close();
  const mailer = new FakeMailer([d("1", "v1"), d("2", "v2"), d("3", "Hi, my own draft"), d("4", "v1 elsewhere", "someone@gmail.example")]);
  const lines: string[] = [];
  return { mailer, lines, dbPath, draftId: rec.draftId, env: { projectsDir, policyDir: path.join(dir, "state", "projects"), dbPath, mailer, out: (l: string) => lines.push(l) } };
}

describe("hub drafts sweep", () => {
  it("a dry run lists the versions the Hub recorded that are left over, and moves nothing", async () => {
    const s = await setup();
    expect(await runDraftsSweep({}, s.env)).toBe(0);
    expect(s.lines[0]).toMatch(/^Dry run, nothing moved: 1 draft the Hub recorded/);
    expect(s.lines[1]).toMatch(/^superseded +owner@acme\.example +1 /);
    expect(s.mailer.drafts).toHaveLength(4);
    expect(s.mailer.trash).toEqual([]);
  });

  it("--apply moves exactly the listed drafts to Trash and marks their versions; the owner's draft and the newest version stay", async () => {
    const s = await setup();
    expect(await runDraftsSweep({ apply: true }, s.env)).toBe(0);
    expect(s.mailer.trash.map((x) => x.ref)).toEqual(["1"]);
    expect(s.mailer.drafts.map((x) => x.ref).sort()).toEqual(["2", "3", "4"]);
    const h = openDb(s.dbPath);
    const versions = await createRepos(h.db).mailVersions.ofDraft(s.draftId);
    h.close();
    expect(versions.map((v) => [v.messageId, v.trashedAt !== null])).toEqual([["M2@acme.example", false], ["M1@acme.example", true]]);
  });

  it("an unknown project is refused", async () => {
    const s = await setup();
    expect(await runDraftsSweep({ project: "nope" }, s.env)).toBe(2);
  });
});

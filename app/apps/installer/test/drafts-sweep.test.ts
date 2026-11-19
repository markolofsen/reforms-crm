import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRepos, openDb } from "@hub/db";
import { describe, expect, it } from "vitest";
import { FakeMailer, type MailDraft } from "@hub/send";
import { runDraftsSweep } from "../src/drafts/sweep-command";

// `hub drafts sweep` (P56 S0) with FakeMailer: nothing reaches Mail. Dry run by default; --apply moves only listed drafts.

const md = ["# Acme", "", "## Settings", "", "| Field | Value | Answered | By |", "|---|---|---|---|", "| schema | 1 | 2026-11-14 | agent |", "| status | active | 2026-11-15 | agent |", "| mail.accounts | owner@acme.example | 2026-11-14 | agent |", "| mail.addresses | owner@acme.example | 2026-11-14 | owner |", "| mail.sender | owner@acme.example | 2026-11-14 | owner |", "| tone | brief | 2026-11-14 | owner |", "", "## Notion databases", "", "- clients: 00000000-0000-4000-8000-000000000001", "- reports: 00000000-0000-4000-8000-000000000002", ""].join("\n");
const d = (ref: string, body: string, account = "owner@acme.example"): MailDraft => ({ ref, messageId: null, account, sender: account, to: ["c@x.example"], cc: [], bcc: [], subject: "Re: hi", body, attachments: 0 });

function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "hub-sweep-"));
  const projectsDir = path.join(dir, "projects");
  mkdirSync(path.join(projectsDir, "acme"), { recursive: true });
  writeFileSync(path.join(projectsDir, "acme", "project.md"), md);
  const dbPath = path.join(dir, "app.db");
  createRepos(openDb(dbPath).db);
  const mailer = new FakeMailer([d("1", "[hub-draft thread=t@x]\nv1"), d("2", "[hub-draft thread=t@x]\nv2"), d("3", "Hi, my own draft"), d("4", "[Reforms draft, run 07a63131a4d4. Delete this line before sending.]\nHi", "someone@gmail.example")]);
  const lines: string[] = [];
  return { mailer, lines, env: { projectsDir, policyDir: path.join(dir, "state", "projects"), dbPath, mailer, out: (l: string) => lines.push(l) } };
}

describe("hub drafts sweep", () => {
  it("a dry run lists the hub's leftovers and moves nothing", async () => {
    const s = setup();
    expect(await runDraftsSweep({}, s.env)).toBe(0);
    expect(s.lines[0]).toMatch(/^Dry run, nothing moved: 2 drafts the Hub wrote/);
    const listed = s.lines.slice(1, 3);
    expect(listed.some((l) => /^superseded +owner@acme\.example +1 /.test(l))).toBe(true);
    expect(listed.some((l) => /^legacy +someone@gmail\.example +4 /.test(l))).toBe(true);
    expect(s.mailer.drafts).toHaveLength(4);
    expect(s.mailer.trash).toEqual([]);
  });

  it("--apply moves exactly the listed drafts to Trash; the owner's draft and the newest version stay", async () => {
    const s = setup();
    expect(await runDraftsSweep({ apply: true }, s.env)).toBe(0);
    expect(s.mailer.trash.map((x) => x.ref).sort()).toEqual(["1", "4"]);
    expect(s.mailer.drafts.map((x) => x.ref).sort()).toEqual(["2", "3"]);
  });

  it("an unknown project is refused", async () => {
    const s = setup();
    expect(await runDraftsSweep({ project: "nope" }, s.env)).toBe(2);
  });
});

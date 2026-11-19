import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DraftWriteError, FakeDraftWriter, type DraftWriter } from "@hub/agent/mail-drafts";
import { createRepos, openDb } from "@hub/db";
import { describe, expect, it } from "vitest";
import { FakeMailer, type MailDraft } from "@hub/send";
import { runDraftsUnmark, withoutMarker } from "../src/drafts/unmark-command";

// `hub drafts unmark` (P65 S3) with a fake Mail: nothing reaches Mail. The dry run lists the open drafts whose thread
// draft still starts with this thread's marker; --apply adopts the marked version, rewrites it without the line, and
// the writer's replace moves the marked one to Trash. Nothing is sent.

const md = ["# Acme", "", "## Settings", "", "| Field | Value | Answered | By |", "|---|---|---|---|", "| schema | 1 | 2026-11-14 | agent |", "| status | active | 2026-11-15 | agent |", "| mail.accounts | owner@acme.example | 2026-11-14 | agent |", "| mail.addresses | owner@acme.example | 2026-11-14 | owner |", "| mail.sender | owner@acme.example | 2026-11-14 | owner |", "| tone | brief | 2026-11-14 | owner |", "", "## Notion databases", "", "- clients: 00000000-0000-4000-8000-000000000001", "- reports: 00000000-0000-4000-8000-000000000002", ""].join("\n");
const draft = (ref: string, body: string, o: { account?: string; subject?: string } = {}): MailDraft => ({ ref, messageId: `D${ref}@acme.example`, account: o.account ?? "owner@acme.example", inReplyTo: "m42@example.com", sender: "owner@acme.example", to: ["ann@x.example"], cc: [], bcc: [], subject: o.subject ?? "Re: Hello", body, attachments: 0 });

async function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "hub-unmark-"));
  const projectsDir = path.join(dir, "projects");
  mkdirSync(path.join(projectsDir, "acme"), { recursive: true });
  writeFileSync(path.join(projectsDir, "acme", "project.md"), md);
  const dbPath = path.join(dir, "app.db");
  const h = openDb(dbPath);
  const repos = createRepos(h.db);
  const open = await repos.drafts.record({ project: "acme", email: "ann@x.example", name: "Ann", subject: "Re: Hello", mailRef: "<m42@example.com>", reason: "asked", skill: "triage-mail" });
  const done = await repos.drafts.record({ project: "acme", email: "bob@x.example", name: "Bob", subject: "Re: Old", mailRef: "<m50@example.com>", reason: "asked", skill: "triage-mail" });
  await repos.drafts.setStatus(done.draftId, "done");
  h.close();
  const mailer = new FakeMailer([
    draft("139333", "\n[hub-draft thread=M42@example.com]\n\nHi Ann,\n\nThe answer.\n\nOn Mon, Ann wrote:\n> q"),
    draft("139400", "Hi Ann, my own draft of the same thread"),
    draft("139401", "[hub-draft thread=m42@example.com]\nin another account", { account: "private@gmail.example" }),
    draft("139402", "[hub-draft thread=m50@example.com]\nof a finished draft", { subject: "Re: Old" }),
  ]);
  const writer = new FakeDraftWriter(() => "m42@example.com");
  writer.inbound.set("m42@example.com", { account: "owner@acme.example", mailboxPath: ["INBOX"], messageId: 42 });
  // The marked draft as the writer's fake Mail holds it, so its replace can move it.
  writer.drafts.push({ id: 139333, messageId: "D139333@acme.example", account: "owner@acme.example", thread: "m42@example.com", subject: "Re: Hello", text: "marked", quote: "keep" });
  const lines: string[] = [];
  return { dbPath, writer, mailer, lines, draftId: open.draftId, env: { projectsDir, policyDir: path.join(dir, "state", "projects"), dbPath, mailer, writer, out: (l: string) => lines.push(l) } };
}

describe("hub drafts unmark", () => {
  it("drops the leading blank lines, the marker line and one blank line under it, and nothing else", () => {
    expect(withoutMarker("\n[hub-draft thread=a@b]\n\nHi,\n\n> [hub-draft thread=a@b]")).toBe("Hi,\n\n> [hub-draft thread=a@b]");
    expect(withoutMarker("Hi,\n[hub-draft thread=a@b]")).toBe("Hi,\n[hub-draft thread=a@b]");
  });

  it("a dry run lists exactly the open drafts' marked thread drafts in the project's accounts, read-only", async () => {
    const s = await setup();
    expect(await runDraftsUnmark({}, s.env)).toBe(0);
    expect(s.lines[0]).toBe("Dry run, nothing written: 1 Mail draft still carries a hub marker line.");
    expect(s.lines[1]).toMatch(/^acme +draft +1 +owner@acme\.example +Mail id +139333 +D139333@acme\.example +"Re: Hello"$/);
    expect(JSON.parse(s.lines[2] ?? "{}")).toEqual({ ok: true, dryRun: true, listed: 1 });
    expect(s.writer.drafts.map((d) => d.text)).toEqual(["marked"]);
  });

  it("--apply adopts the marked version, rewrites it without the line, and moves the marked one to Trash", async () => {
    const s = await setup();
    expect(await runDraftsUnmark({ apply: true }, s.env)).toBe(0);
    expect(s.writer.drafts.map((d) => d.text)).toEqual(["Hi Ann,\n\nThe answer.\n\nOn Mon, Ann wrote:\n> q"]);
    expect(s.writer.drafts[0]?.quote).toBe("keep");
    const h = openDb(s.dbPath);
    const versions = await createRepos(h.db).mailVersions.ofDraft(s.draftId);
    h.close();
    expect(versions.map((v) => [v.source, v.messageId, v.trashedAt !== null])).toEqual([["migration", s.writer.drafts[0]?.messageId, false], ["migration", "D139333@acme.example", true]]);
    expect(JSON.parse(s.lines.at(-1) ?? "{}").note).toBe("the marked version is in the account's Trash, recoverable; nothing was sent");
  });

  it("a writer failure leaves the marked draft in Drafts, says so (not Trash), and a rerun adopts it once (2026-11-19)", async () => {
    const s = await setup();
    // v0.12.12's writer: the script fails to compile, so osascript errors before Mail is reached.
    const broken = { findInbound: s.writer.findInbound.bind(s.writer), writeReply: async () => Promise.reject(new DraftWriteError("mail_error", '2023:2025: syntax error: Expected expression but found "to". (-2741)')) };
    expect(await runDraftsUnmark({ apply: true }, { ...s.env, writer: broken as unknown as DraftWriter })).toBe(1);
    const res = JSON.parse(s.lines.at(-1) ?? "{}");
    expect(res).toMatchObject({ ok: false, rewritten: [], failed: [{ draftId: s.draftId, ref: "139333" }] });
    expect(res.note).toBe("the failed draft is still in Drafts, untouched; nothing was sent");
    expect(res.note).not.toMatch(/Trash/);
    expect(s.writer.drafts.map((d) => [d.id, d.text])).toEqual([[139333, "marked"]]);
    // The rerun with a working writer: one adoption row, not two.
    expect(await runDraftsUnmark({ apply: true }, s.env)).toBe(0);
    const h = openDb(s.dbPath);
    const versions = await createRepos(h.db).mailVersions.ofDraft(s.draftId);
    h.close();
    expect(versions.filter((v) => v.messageId === "D139333@acme.example").map((v) => v.trashedAt !== null)).toEqual([true]);
    expect(versions).toHaveLength(2);
  });
});

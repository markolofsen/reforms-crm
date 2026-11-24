import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRepos, openDb } from "@hub/db";
import { appendEvents, type LogStore } from "@hub/log/store";
import { describe, expect, it } from "vitest";
import { adoptedDraftIds, runHealBrands } from "../src/drafts/heal-brands-command";

// `hub drafts heal-brands` (P140 R4): an adopted record's brand comes from the answered message's headers. No Mail: the headers
// are the test's. The saas case: the client wrote to the second brand's address, the record said the first brand.

const md = [
  "# Acme", "", "## Settings", "", "| Field | Value | Answered | By |", "|---|---|---|---|",
  "| schema | 1 | 2026-11-14 | agent |", "| status | active | 2026-11-15 | agent |",
  "| mail.accounts | hello@acme.example | 2026-11-14 | agent |", "| mail.addresses | hello@acme.example, info@beta.example | 2026-11-14 | owner |", "| mail.sender | hello@acme.example | 2026-11-14 | owner |", "| mail.domains | acme.example, beta.example | 2026-11-14 | owner |", "| knowledge.scope | by-brand | 2026-11-19 | owner |",
  "", "## Brands", "", "| Brand | Receives at | Signature | Answered | By |", "|---|---|---|---|---|",
  "| Acme | acme.example | Acme team | 2026-11-15 | owner |", "| Beta | beta.example | Beta team | 2026-11-15 | owner |",
  "", "## Notion databases", "", "- clients: 00000000-0000-4000-8000-000000000001", "",
].join("\n");

const adoptedLine = (draftId: number) => ({ v: 1 as const, ts: "2026-11-24T12:42:22.276Z", project: "acme", session: "s1", cli: "claude" as const, kind: "tool_result" as const, data: { tool: "mcp__hub__draft_write", output: JSON.stringify({ adopted: true, brand: null, record: { draftId, action: "created", warnings: [] } }) } });

async function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "hub-heal-"));
  const projectsDir = path.join(dir, "projects");
  mkdirSync(path.join(projectsDir, "acme"), { recursive: true });
  writeFileSync(path.join(projectsDir, "acme", "project.md"), md);
  const dbPath = path.join(dir, "app.db");
  const handle = openDb(dbPath);
  const repos = createRepos(handle.db);
  const wrong = await repos.drafts.record({ project: "acme", email: "c@x.example", name: "C", subject: "Re: hello", mailRef: "<n1@x.example>", brand: "Acme", wroteTo: "hello@acme.example" });
  await repos.mailVersions.add({ project: "acme", mailRef: "n1@x.example", draftId: wrong.draftId, account: "hello@acme.example", mailId: 1, messageId: "V1@acme.example", hash: "h", source: "agent" });
  const right = await repos.drafts.record({ project: "acme", email: "d@x.example", name: "D", subject: "Re: hi", mailRef: "<n2@x.example>", brand: "Acme", wroteTo: "hello@acme.example" });
  const notAdopted = await repos.drafts.record({ project: "acme", email: "e@x.example", name: "E", subject: "Re: yo", mailRef: "<n3@x.example>", brand: "Acme", wroteTo: "hello@acme.example" });
  handle.close();
  const log: LogStore = { dir: path.join(dir, "log"), secrets: path.join(dir, "secrets"), retentionDays: 90 };
  appendEvents(log, [adoptedLine(wrong.draftId), adoptedLine(right.draftId)], new Date("2026-11-24T12:42:22Z"));
  const headers: Record<string, string> = {
    "n1@x.example": "From: C <c@x.example>\nTo: info@beta.example\nDelivered-To: hello@acme.example\n",
    "n2@x.example": "From: D <d@x.example>\nTo: hello@acme.example\n",
    "n3@x.example": "From: E <e@x.example>\nTo: info@beta.example\n",
  };
  const lines: string[] = [];
  const env = { projectsDir, policyDir: path.join(dir, "state", "projects"), dbPath, log, headersOf: async (_a: readonly string[], m: string) => headers[m.replace(/^<|>$/g, "")] ?? null, out: (l: string) => lines.push(l) };
  const read = async () => {
    const h = openDb(dbPath);
    try {
      const r = createRepos(h.db);
      return { wrong: await r.drafts.get(wrong.draftId), right: await r.drafts.get(right.draftId), other: await r.drafts.get(notAdopted.draftId), versions: await r.mailVersions.ofDraft(wrong.draftId) };
    } finally {
      h.close();
    }
  };
  return { env, lines, ids: { wrong: wrong.draftId, right: right.draftId }, log, read };
}

describe("hub drafts heal-brands (P140 R4)", () => {
  it("finds the adopted records in the session log only", async () => {
    const s = await setup();
    expect(adoptedDraftIds(s.log, "acme")).toEqual([s.ids.wrong, s.ids.right].sort((a, b) => a - b));
  });

  it("a dry run lists the record whose headers name another brand, and changes nothing", async () => {
    const s = await setup();
    expect(await runHealBrands({}, s.env)).toBe(0);
    expect(s.lines[0]).toBe("Dry run, nothing changed: 2 adopted records, 1 to fix.");
    expect(s.lines.join("\n")).toContain(`acme draft ${s.ids.wrong}: fix       Acme / hello@acme.example -> Beta / info@beta.example`);
    expect((await s.read()).wrong).toMatchObject({ brand: "Acme", wroteTo: "hello@acme.example" });
  });

  it("--apply writes the headers' brand to the record and its versions, reads it back, and a second run finds nothing", async () => {
    const s = await setup();
    expect(await runHealBrands({ apply: true }, s.env)).toBe(0);
    const after = await s.read();
    expect(after.wrong).toMatchObject({ brand: "Beta", wroteTo: "info@beta.example" });
    expect(after.versions.map((v) => [v.brand, v.wroteTo])).toEqual([["Beta", "info@beta.example"]]);
    expect(after.right).toMatchObject({ brand: "Acme", wroteTo: "hello@acme.example" });
    // A record that was not adopted is never touched, even when its headers disagree.
    expect(after.other).toMatchObject({ brand: "Acme", wroteTo: "hello@acme.example" });
    s.lines.length = 0;
    expect(await runHealBrands({ apply: true }, s.env)).toBe(0);
    expect(s.lines[0]).toBe("Healing: 2 adopted records, 0 to fix.");
  });
});

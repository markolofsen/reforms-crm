import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CONTEXT_BLOCK_FROM, setSendPolicy } from "@hub/projects";
import type { DraftRecordCall, DraftRecordOutcome } from "../src/records/draft";
import { draftRecord } from "../src/records/schema";

// What the record writers' tests share (P129 A3: moved here with the writers from the installer's CLI tests): the fixture
// project, the clock of flows that are not about context, and a send policy whose drafts may go to anyone.

/** The fixture projects (invented clients) shipped with the projects package tests. */
export const FIXTURE_PROJECTS = path.resolve(import.meta.dirname, "..", "..", "projects", "test", "fixtures", "projects");

/**
 * The clock of record flows that are not about context: the day before `CONTEXT_BLOCK_FROM`, when a project that sets no
 * `context.required` still records a draft without a context block (with a warning). `records-context.test.ts` owns the
 * block rule; these suites must not change with the calendar.
 */
export const beforeContextBlock = (): Date => new Date(Date.parse(CONTEXT_BLOCK_FROM) - 86_400_000);

/** A send policy whose drafts may go to anyone (P49 S11). Returns `policyDir`. */
export function anyRecipients(policyDir: string, slug: string, kind = "generic"): string {
  setSendPolicy(policyDir, slug, kind, { "draft.recipients": "any" }, "test");
  return policyDir;
}

/** A throw-away folder: `projects/acme` (a copy of acme-travel), a policy whose drafts may go to anyone, a ledger root and a database path. */
export function recordsInstance(): { dir: string; db: string; projects: string; policy: string; root: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "hub-records-"));
  const projects = path.join(dir, "projects");
  const root = path.join(dir, "root");
  mkdirSync(root);
  cpSync(path.join(FIXTURE_PROJECTS, "acme-travel"), path.join(projects, "acme"), { recursive: true });
  return { dir, db: path.join(dir, "app.db"), projects, policy: anyRecipients(path.join(dir, "policy"), "acme"), root };
}

/** One record as `draft_write` hands it to the writer: what the call and Mail say, and the agent's `record` as the tool parses it. */
export function recordCall(c: { email: string; subject: string; mailRef: string | null; ownerRequest?: string; ownerVerified?: boolean; project?: string }, record: Record<string, unknown> = {}): DraftRecordCall {
  return { project: c.project ?? "acme", email: c.email, subject: c.subject, mailRef: c.mailRef, ownerRequest: c.ownerRequest ?? null, ownerVerified: c.ownerVerified ?? false, record: draftRecord.parse(record) };
}

/** The recorded outcome, or the test fails with the refusal. */
export function okOf(o: DraftRecordOutcome): Extract<DraftRecordOutcome, { ok: true }> {
  if (!o.ok) throw new Error(`${o.code}: ${o.error}`);
  return o;
}

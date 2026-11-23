import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { recordDraftCall } from "@hub/agent/records/draft";
import { draftRecord } from "@hub/agent/records/schema";
import { replayCalls, type LedgerEntry } from "@hub/agent/evidence/ledger";
import { appendLine, sessionFile } from "@hub/agent/evidence/store";
import { batchCheck } from "../../src/batch-check";
import { anyRecipients } from "../../test/instance-fixture";
import { carefulSteps, contextFor, templateLoopSteps, writeFor } from "./scenario";
import { DRAFTED, FIXTURE_PROJECT } from "./fixture";

// Tier 1 on the whole fixture: 17 careful drafts recorded by draft_write's writer against a replayed ledger, then batch-check.
const PROJECTS = path.join(import.meta.dirname, "fixture", "projects");
const POLICY = anyRecipients(mkdtempSync(path.join(tmpdir(), "hub-eval-policy-")), FIXTURE_PROJECT);
const setup = () => {
  const d = mkdtempSync(path.join(tmpdir(), "pc-rec-"));
  mkdirSync(path.join(d, "root"));
  return { root: path.join(d, "root"), db: path.join(d, "app.db") };
};
const feed = (root: string, steps: ReturnType<typeof carefulSteps>) => {
  const e: LedgerEntry[] = [];
  replayCalls(steps.map((s) => ({ name: s.name, input: s.input, result: s.result })), e, []);
  e.forEach((x) => appendLine(sessionFile(root, FIXTURE_PROJECT, "S"), { sid: "S", ...x }));
};
const env = (s: ReturnType<typeof setup>, now = "2026-11-16T09:00:00Z") => ({ dbPath: s.db, projectsDir: PROJECTS, policyDir: POLICY, ledgerRoot: s.root, attempts: 1, now: () => new Date(now) });
/** What draft_write records after Mail saved the reply: the call's `record`, as the tool parses it, for the message it answered. */
const record = (s: ReturnType<typeof setup>, c: (typeof DRAFTED)[number], ctx: unknown) => {
  const step = writeFor(c, ctx);
  return recordDraftCall({ project: FIXTURE_PROJECT, email: c.email, subject: "Re: your property", mailRef: `m${c.ids[0]}@clients.example`, ownerRequest: null, ownerVerified: false, record: draftRecord.parse(step.input.record) }, env(s));
};

describe("per-client draft records on the 20-client fixture (E2)", () => {
  it("17 careful drafts are observed, ok, and the batch is green", async () => {
    const s = setup();
    for (const c of DRAFTED) {
      feed(s.root, carefulSteps(c));
      expect(await record(s, c, contextFor(c)), c.email).toMatchObject({ ok: true, source: "observed", evidence: c.shape === "stale-profile" ? "weak" : "ok" });
    }
    const rep = batchCheck(s.root, FIXTURE_PROJECT, "bulk-fixture-1");
    expect(rep.counts.total).toBe(17);
    expect(rep.counts.red).toBe(0);
    expect(rep.rows.find((r) => r.email.startsWith("jana"))!.notes.join()).toContain("profile-stale");
    expect(rep.rows.filter((r) => r.profile === "empty" || r.profile === "absent")).not.toHaveLength(0);
  });

  it("a template loop is red in batch-check even though every read is there", async () => {
    const s = setup();
    const four = DRAFTED.slice(0, 4);
    for (const c of four) {
      feed(s.root, templateLoopSteps([c]));
      await record(s, c, contextFor(c));
    }
    const rep = batchCheck(s.root, FIXTURE_PROJECT, "bulk-fixture-1");
    expect(rep.red).toBe(true);
    expect(rep.counts.red).toBeGreaterThanOrEqual(3);
  });

  it("a draft with no ledger and no context is evidence missing", async () => {
    const s = setup();
    const c = DRAFTED[0]!;
    expect(await recordDraftCall({ project: FIXTURE_PROJECT, email: c.email, subject: "s", mailRef: "<m>", ownerRequest: null, ownerVerified: false, record: draftRecord.parse({}) }, env(s, "2026-11-16T00:00:00Z"))).toMatchObject({ evidence: "missing" });
  });
});

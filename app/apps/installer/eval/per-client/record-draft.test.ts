import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { replayCalls, type LedgerEntry } from "@hub/projects";
import { batchCheck } from "../../src/batch-check";
import { appendLine, sessionFile } from "../../src/evidence-store";
import { recordDraft } from "../../src/record-draft";
import { carefulSteps, contextFor, recordFor, replyFor, templateLoopSteps } from "./scenario";
import { DRAFTED, FIXTURE_PROJECT } from "./fixture";

// Tier 1 on the whole fixture: 17 careful drafts through record-draft with a replayed ledger, then batch-check.
const PROJECTS = path.join(import.meta.dirname, "fixture", "projects");
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
const record = (s: ReturnType<typeof setup>, c: (typeof DRAFTED)[number], ctx: unknown) => {
  const step = recordFor(c, ctx);
  const json = /echo '(.*)' \|/.exec(String((step.input as { command: string }).command))![1]!;
  return recordDraft({ project: FIXTURE_PROJECT, payload: json, dbPath: s.db, projectsDir: PROJECTS, ledgerRoot: s.root, attempts: 1, now: () => new Date("2026-11-16T09:00:00Z") });
};

describe("per-client record-draft on the 20-client fixture (E2)", () => {
  it("17 careful drafts are observed, ok, and the batch is green", async () => {
    const s = setup();
    for (const c of DRAFTED) {
      feed(s.root, carefulSteps(c).filter((x) => x.name !== "Bash"));
      const r = JSON.parse((await record(s, c, contextFor(c))).line);
      expect(r, c.email).toMatchObject({ ok: true, source: "observed", evidence: c.shape === "stale-profile" ? "weak" : "ok" });
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
      feed(s.root, templateLoopSteps([c]).filter((x) => x.name !== "Bash"));
      await record(s, c, contextFor(c));
    }
    const rep = batchCheck(s.root, FIXTURE_PROJECT, "bulk-fixture-1");
    expect(rep.red).toBe(true);
    expect(rep.counts.red).toBeGreaterThanOrEqual(3);
  });

  it("a draft with no ledger and no context is evidence missing", async () => {
    const s = setup();
    const c = DRAFTED[0]!;
    const r = JSON.parse((await recordDraft({ project: FIXTURE_PROJECT, payload: JSON.stringify({ email: c.email, subject: "s", mailRef: "<m>" }), dbPath: s.db, projectsDir: PROJECTS, ledgerRoot: s.root, attempts: 1, now: () => new Date("2026-11-16") })).line);
    expect(r).toMatchObject({ evidence: "missing" });
    void replyFor;
  });
});

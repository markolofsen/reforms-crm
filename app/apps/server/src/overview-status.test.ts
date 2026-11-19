import { describe, expect, it } from "vitest";
import { STATUS_KINDS, statusDto, type StatusKind } from "@hub/contract/overview";
import type { ProjectFacts } from "./overview-facts";
import { overviewSentence, statusOf, type InstanceFacts } from "./overview-status";

const NOW = new Date("2026-11-15T12:00:00Z");
const LATER = new Date("2026-12-01T12:00:00Z");
const quiet = (over: Partial<ProjectFacts> = {}): ProjectFacts => ({
  slug: "alpha", name: "Alpha", status: "active", archived: false, toReview: 0, sentToday: 0, owed: 2, lastTriageAt: "2026-11-14T10:00:00.000Z",
  setupQuestion: false, injectionHeld: 0, failed24h: 0, stuck: 0, stopped: false, auto: { mode: "draft", cap: 5, used24h: 0 }, recipients: "listed",
  doctorFailed: [], knowledgeExpired: 0, contextRequired: "warn", ...over,
});
const SYS: InstanceFacts = { sentError: false, fakeMailer: false };
const run = (over: Partial<ProjectFacts> = {}, sys: Partial<InstanceFacts> = {}, now = NOW) => statusDto.parse(statusOf(quiet(over), { ...SYS, ...sys }, now));

// One scenario per kind: the facts that raise it alone, its level, its sentence and where it is fixed.
const SCENARIOS: Record<StatusKind, { over?: Partial<ProjectFacts>; sys?: Partial<InstanceFacts>; now?: Date; level: string; sentence: string; next: string | null }> = {
  clear: { level: "clear", sentence: "All clear", next: null },
  "send-stopped": { over: { stopped: true }, level: "blocked", sentence: "Sending is stopped", next: "sending" },
  "sent-loop-error": { sys: { sentError: true }, level: "blocked", sentence: "Sent detection is failing: sent mail is not being noticed", next: "sending" },
  "doctor-fail": { over: { doctorFailed: ["notion.access", "knowledge", "filters"] }, level: "blocked", sentence: "3 setup checks fail: notion.access, knowledge, ...", next: "overview" },
  "injection-flagged": { over: { injectionHeld: 1 }, level: "attention", sentence: "1 draft is held: the mail looked like an instruction", next: null },
  "send-failed": { over: { failed24h: 2 }, level: "attention", sentence: "2 sends failed in the last 24 hours", next: "sending" },
  "sending-stuck": { over: { stuck: 1 }, level: "attention", sentence: "1 send is stuck in \"sending\": check Mail's Sent folder", next: "sending" },
  "project-draft": { over: { status: "draft" }, level: "attention", sentence: "The project is a draft: finish its setup", next: "overview" },
  "recipients-test": { over: { recipients: "test" }, level: "clear", sentence: "Test mode: sends go to the test list only", next: "sending" },
  "fake-mailer": { sys: { fakeMailer: true }, level: "attention", sentence: "Demo mode: nothing is really sent", next: null },
  "cap-near": { over: { auto: { mode: "auto", cap: 5, used24h: 4 } }, level: "clear", sentence: "4 of 5 automatic sends used in 24 hours", next: "sending" },
  "knowledge-expired": { over: { knowledgeExpired: 2 }, level: "attention", sentence: "2 knowledge entries have expired", next: "knowledge" },
  "never-triaged": { over: { lastTriageAt: null }, level: "clear", sentence: "No triage has run yet", next: null },
  "context-block-soon": { over: { contextRequired: null }, level: "clear", sentence: "Drafts without evidence are refused from 2026-11-22", next: "overview" },
};

describe("statusOf", () => {
  for (const kind of STATUS_KINDS) {
    const s = SCENARIOS[kind];
    it(`${kind}: ${s.level}, "${s.sentence}"`, () => {
      expect(run(s.over, s.sys, s.now)).toEqual({ level: s.level, kind, sentence: s.sentence, next: s.next, numbers: { owed: s.over?.owed ?? 2, lastTriageAt: s.over?.lastTriageAt === undefined ? "2026-11-14T10:00:00.000Z" : s.over.lastTriageAt } });
    });
  }

  it("the worst fact wins: blocked over attention over a clear-level fact; ties follow the kind order", () => {
    expect(run({ recipients: "test", stopped: true, knowledgeExpired: 1 }).kind).toBe("send-stopped");
    // Test mode is a chosen setting (clear level): an expired entry, the owner's to renew, comes before it.
    expect(run({ recipients: "test", knowledgeExpired: 1 }).kind).toBe("knowledge-expired");
    expect(run({ recipients: "test", contextRequired: null }).kind).toBe("recipients-test");
    expect(run({ stopped: true, doctorFailed: ["x"] }, { sentError: true }).kind).toBe("send-stopped");
    expect(run({ injectionHeld: 1, failed24h: 1 }).kind).toBe("injection-flagged");
  });

  it("names a setup question on a draft project", () => {
    expect(run({ status: "draft", setupQuestion: true }).sentence).toBe("A setup question is open: the project is a draft");
  });

  it("never repeats the slug, and the context warning ends on its date", () => {
    for (const kind of STATUS_KINDS) expect(run(SCENARIOS[kind].over, SCENARIOS[kind].sys).sentence).not.toContain("alpha");
    expect(run({ contextRequired: null }, {}, LATER).kind).toBe("clear");
  });

  it("a paused or archived project raises nothing and says so", () => {
    expect(run({ status: "paused", stopped: true })).toMatchObject({ level: "clear", kind: "clear", sentence: "Paused: nothing runs" });
    expect(run({ status: "archived", archived: true, doctorFailed: ["x"] })).toMatchObject({ level: "clear", sentence: "Archived" });
  });
});

describe("overviewSentence", () => {
  it("counts projects that need the owner; clear-level facts do not count", () => {
    const s = (over: Partial<ProjectFacts>) => statusOf(quiet(over), SYS, NOW);
    expect(overviewSentence([s({}), s({ recipients: "test" })])).toBe("All clear");
    expect(overviewSentence([s({ stopped: true }), s({})])).toBe("1 project needs you");
    expect(overviewSentence([s({ stopped: true }), s({ knowledgeExpired: 3 })])).toBe("2 projects need you");
  });
});

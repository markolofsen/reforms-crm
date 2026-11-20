import { describe, expect, it } from "vitest";
import { activityDto, activityRowDto } from "./activity";
import { connectionsDto, mailAccountDto, mailReadDto } from "./connections";
import { API_VERSION, healthDto } from "./health";
import { instanceDto } from "./instance";
import { overviewDto, projectRowDto, STATUS_KINDS, STATUS_LEVELS, statusDto } from "./overview";

const asOf = "2026-11-15T10:00:00.000Z";
const health = { ok: true, apiVersion: API_VERSION, messengers: { state: "off", failures: 0, stored: 0 }, telegramUser: { state: "off", accounts: [] }, whatsapp: { state: "off", accounts: [] }, sent: { state: "off", projects: [], failures: 0, marked: 0 }, mailer: "fake" };
const status = { level: "attention", kind: "project-draft", sentence: "Test mode: sends go to the test list only", next: "sending", numbers: { owed: 1, lastTriageAt: asOf } };
const row = { slug: "alpha", name: "Alpha", projectStatus: "draft", archived: false, toReview: 1, sentToday: 0, status };

describe("overview v5 (P48)", () => {
  it("accepts a whole overview, and a stray field anywhere is refused", () => {
    const o = { serverTime: asOf, timeZone: "UTC", dataVersion: 1, sentence: "1 project needs you", projects: [row], system: health };
    expect(overviewDto.safeParse(o).success).toBe(true);
    expect(overviewDto.safeParse({ ...o, verdict: { level: "clear" } }).success).toBe(false);
    expect(projectRowDto.safeParse({ ...row, clientNames: ["Ana"] }).success).toBe(false);
    expect(statusDto.safeParse({ ...status, numbers: { ...status.numbers, toReview: 1 } }).success).toBe(false);
  });

  it("the key lists hold counts, states, stamps and our own names only", () => {
    expect(Object.keys(overviewDto.shape).sort()).toEqual(["dataVersion", "projects", "sentence", "serverTime", "system", "timeZone"]);
    expect(Object.keys(projectRowDto.shape).sort()).toEqual(["archived", "name", "projectStatus", "sentToday", "slug", "status", "toReview"]);
    expect(Object.keys(statusDto.shape).sort()).toEqual(["kind", "level", "next", "numbers", "sentence"]);
  });

  it("the status vocabulary is closed and has no mail-login kind", () => {
    expect(STATUS_LEVELS).toEqual(["clear", "attention", "blocked"]);
    expect(new Set(STATUS_KINDS).size).toBe(STATUS_KINDS.length);
    for (const gone of ["mail-off", "mail-error", "stale-read", "notion-token", "notion-error"]) expect(STATUS_KINDS).not.toContain(gone);
    expect(statusDto.safeParse({ ...status, kind: "mail-off" }).success).toBe(false);
    expect(statusDto.safeParse({ ...status, next: "drafts" }).success).toBe(false);
    expect(statusDto.safeParse({ ...status, kind: "clear", level: "clear", next: null }).success).toBe(true);
  });

  it("health has no mail login block", () => {
    expect(healthDto.safeParse(health).success).toBe(true);
    expect(Object.keys(healthDto.shape)).not.toContain("mail");
  });
});

describe("activity (P73)", () => {
  const r = { id: 1, key: "event:1", at: asOf, client: { id: 3, name: "Mark Effect" }, who: "Mark Effect", outcome: "updated", why: "already drafted", draftId: 1, skill: null };
  it("one row per decision, with the outcome and the reason in the row; no run", () => {
    expect(activityRowDto.safeParse(r).success).toBe(true);
    expect(activityRowDto.safeParse({ ...r, outcome: "maybe" }).success).toBe(false);
    expect(activityRowDto.safeParse({ ...r, body: "Hi" }).success).toBe(false);
    expect(activityRowDto.safeParse({ ...r, runId: 2 }).success).toBe(false);
  });
  it("a page of rows, the counts per outcome view, the next cursor", () => {
    const page = { rows: [r], counts: { all: 1, needs_you: 0, drafts: 1, skipped: 0 }, next: "2026-11-19T12:50:40.759Z|event:19", client: null };
    expect(activityDto.safeParse(page).success).toBe(true);
    expect(activityDto.safeParse({ ...page, next: "19" }).success).toBe(false);
    expect(activityDto.safeParse({ ...page, sessions: [] }).success).toBe(false);
  });
});

describe("connections and instance (P48 W0)", () => {
  it("a mail account is read-only: account, found in Mail (or unknown), used by", () => {
    expect(mailAccountDto.safeParse({ account: "hello@reforms.ai", foundInMail: null, usedBy: ["saas-support"] }).success).toBe(true);
    expect(mailAccountDto.safeParse({ account: "a", foundInMail: true, usedBy: [], password: "x" }).success).toBe(false);
    expect(connectionsDto.safeParse({ instance: "saas", connections: [{ id: "mail:a", kind: "mail", label: "x", secret: { state: "stored" }, identity: null, usedBy: [], can: [], check: { state: "never" } }], mail: [], mailRead: { state: "answered", fix: null } }).success).toBe(false);
    expect(mailReadDto.safeParse({ state: "not-answering", fix: "Quit Mail" }).success).toBe(true);
    expect(mailReadDto.safeParse({ state: "hung", fix: null }).success).toBe(false);
  });
  it("the brand has a name, and says only whether a logo exists", () => {
    expect(instanceDto.safeParse({ name: "Reforms SaaS", hasLogo: false, localOpen: true }).success).toBe(true);
    expect(instanceDto.safeParse({ name: "", hasLogo: false, localOpen: true }).success).toBe(false);
    expect(instanceDto.safeParse({ name: "x", hasLogo: true, localOpen: true, logo: "/Users/x/logo.png" }).success).toBe(false);
  });
});

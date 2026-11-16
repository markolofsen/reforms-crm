import { describe, expect, it } from "vitest";
import { API_VERSION } from "./health";
import { ATTENTION_KINDS, attentionItem, FRESHNESS, liveBlock, mailboxDto, notionCount, notionDto, overviewDto, projectCardDto, readBlock, refreshRequest, refreshResponse, SEVERITIES } from "./overview";
import { z } from "zod";

const n = z.number().int();
const asOf = "2026-11-15T10:00:00.000Z";

describe("freshness blocks", () => {
  it("accept one fixture of every state", () => {
    const b = readBlock(n);
    for (const x of [
      { state: "fresh", asOf, value: 3 },
      { state: "stale", asOf, value: 3 },
      { state: "never" },
      { state: "refreshing" },
      { state: "refreshing", asOf, value: 3 },
      { state: "error", code: "login-refused", message: "Mail read failed", fix: "Check the login file", asOf, value: 3 },
      { state: "error", code: "timeout", message: "No answer in 10 s", fix: "Retry" },
      { state: "off", message: "Not recorded yet" },
    ])
      expect(b.safeParse(x).success, JSON.stringify(x)).toBe(true);
    expect(FRESHNESS).toEqual(["fresh", "stale", "never", "refreshing", "error", "off"]);
  });

  it("a number without its stamp is refused, and `never` carries no number", () => {
    const b = readBlock(n);
    expect(b.safeParse({ state: "fresh", value: 3 }).success).toBe(false);
    expect(b.safeParse({ state: "stale", value: 3 }).success).toBe(false);
    expect(b.safeParse({ state: "never", value: 0 }).success).toBe(false);
    expect(b.safeParse({ state: "error", code: "failed", message: "x", asOf, value: 3 }).success).toBe(false); // no fix line
    expect(b.safeParse({ state: "fresh", asOf, value: 3, name: "Ana" }).success).toBe(false);
  });

  it("Notion has no `off` state: a missing token is an error with a fix line", () => {
    const b = liveBlock(notionCount);
    expect(b.safeParse({ state: "off", message: "Not connected" }).success).toBe(false);
    expect(b.safeParse({ state: "error", code: "token-missing", message: "The Notion token is missing", fix: "Put the token in state/secrets/notion-token (chmod 600), then run the doctor" }).success).toBe(true);
    expect(b.safeParse({ state: "error", code: "mystery", message: "x", fix: "y" }).success).toBe(false);
  });
});

const card = {
  slug: "alpha",
  name: "Alpha",
  status: "active",
  kind: "generic",
  archived: false,
  lastTriageAt: null,
  owe: { state: "off", message: "Not recorded yet" },
  drafts: { ready: 1, hold: 0, done: 0, skipped: 0, sent: 0 },
  injectionHeld: 0,
  sends: { today: 0, since: asOf, failed24h: 0, stuck: 0, stopped: false, auto: { mode: "draft", cap: 5, used24h: 0 } },
  recipients: "test",
  mailboxes: [{ account: "mail-a", shared: false, newSinceTriage: { state: "never" } }],
  notion: { clients: { dataSourceId: "ds1", count: { state: "fresh", asOf, value: { count: 12, capped: false } } }, leads: null },
  setupQuestion: false,
};

describe("overview DTOs", () => {
  it("accepts a whole overview", () => {
    const health = { ok: true, apiVersion: API_VERSION, messengers: { state: "off", failures: 0, stored: 0 }, mail: { state: "off", accounts: 0, problems: [] }, sent: { state: "off", projects: [], failures: 0, marked: 0 }, mailer: "fake" };
    const o = { serverTime: asOf, timeZone: "UTC", dataVersion: 1, oldestAsOf: asOf, verdict: { level: "clear", headline: "All clear" }, attention: [], projects: [card], system: health };
    expect(overviewDto.safeParse(o).success).toBe(true);
    expect(overviewDto.safeParse({ ...o, extra: 1 }).success).toBe(false);
  });

  it("has no field that can carry client text: a stray key anywhere is refused", () => {
    expect(projectCardDto.safeParse(card).success).toBe(true);
    expect(projectCardDto.safeParse({ ...card, clientNames: ["Ana"] }).success).toBe(false);
    expect(projectCardDto.safeParse({ ...card, mailboxes: [{ ...card.mailboxes[0], subject: "Hi" }] }).success).toBe(false);
    expect(mailboxDto.safeParse({ ...card.mailboxes[0], from: "client@example.com" }).success).toBe(false);
    expect(notionDto.safeParse({ clients: null, leads: null, deals: 4 }).success).toBe(false);
    expect(projectCardDto.safeParse({ ...card, notion: { clients: { dataSourceId: "ds1", count: { state: "fresh", asOf, value: { count: 1, capped: false, title: "Ana" } } }, leads: null } }).success).toBe(false);
  });

  it("the key lists of the schemas hold only counts, states, stamps and names of ours", () => {
    expect(Object.keys(projectCardDto.shape).sort()).toEqual(["archived", "drafts", "injectionHeld", "kind", "lastTriageAt", "mailboxes", "name", "notion", "owe", "recipients", "sends", "setupQuestion", "slug", "status"]);
    expect(Object.keys(mailboxDto.shape).sort()).toEqual(["account", "newSinceTriage", "shared"]);
    expect(Object.keys(attentionItem.shape).sort()).toEqual(["count", "filter", "focus", "kind", "project", "sentence", "severity"]);
    expect(Object.keys(overviewDto.shape).sort()).toEqual(["attention", "dataVersion", "oldestAsOf", "projects", "serverTime", "system", "timeZone", "verdict"]);
  });

  it("the attention vocabulary is closed", () => {
    expect(attentionItem.safeParse({ kind: "owe-reply", severity: "needs-owner", project: "alpha", count: 2, sentence: "alpha: 2 clients wait for a reply", focus: "drafts" }).success).toBe(true);
    expect(attentionItem.safeParse({ kind: "made-up", severity: "watch", project: null, sentence: "x", focus: "project" }).success).toBe(false);
    expect(attentionItem.safeParse({ kind: "owe-reply", severity: "urgent", project: null, sentence: "x", focus: "project" }).success).toBe(false);
    expect(new Set(ATTENTION_KINDS).size).toBe(ATTENTION_KINDS.length);
    expect(SEVERITIES).toEqual(["blocker", "needs-owner", "watch"]);
  });

  it("a refresh names a project and at least one known source", () => {
    expect(refreshRequest.safeParse({ project: "alpha", sources: ["mail", "notion"] }).success).toBe(true);
    expect(refreshRequest.safeParse({ project: "alpha", sources: [] }).success).toBe(false);
    expect(refreshRequest.safeParse({ project: "alpha", sources: ["sms"] }).success).toBe(false);
    expect(refreshRequest.safeParse({ project: "alpha", sources: ["mail"], force: true }).success).toBe(false);
    expect(refreshResponse.safeParse({ outcomes: { mail: "read" }, project: card, attention: [], verdict: { level: "clear", headline: "All clear" }, oldestAsOf: null }).success).toBe(true);
  });
});

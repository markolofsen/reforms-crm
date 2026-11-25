import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { leadDecisionProperties, syncLeadDecision, type LeadDecisionWriter } from "../src/lead-decision";
import type { NotionReader, PropertyConfig } from "../src/types";

// P147 L7: the pass's decision on the lead's Notion page. Exactly `Hub decision` and `Hub reason`, only where the Leads data source
// has them with the right type; never Status, Owner or Notes; a database without them is skipped with the install line.
const LEADS = "aaaa2222-0000-4000-8000-000000000002";
const reader = (props: Record<string, PropertyConfig>): NotionReader => ({
  retrieveDataSource: async (id) => ({ id, title: "Leads", properties: { Name: { type: "title" }, Status: { type: "status" }, ...props } }),
  async *listPages() {},
  findPages: async () => [],
  retrieveMarkdown: async () => ({ markdown: "", truncated: false, unknownBlockIds: [] }),
});
const writer = (): LeadDecisionWriter & { calls: unknown[][] } => {
  const calls: unknown[][] = [];
  return { calls, setProperties: async (...a) => void calls.push(a) };
};
const BOTH = { "Hub decision": { type: "select" }, "Hub reason": { type: "rich_text" } } as Record<string, PropertyConfig>;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hub-lead-decision-"));
  mkdirSync(join(dir, "projects", "acme"), { recursive: true });
  mkdirSync(join(dir, "secrets"), { recursive: true });
  writeFileSync(join(dir, "projects", "acme", "project.md"), `# Acme\n\n## Notion databases\n\n- leads: ${LEADS}\n`);
  writeFileSync(join(dir, "secrets", "notion-token"), "secret-test\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the lead decision's Notion copy (L7)", () => {
  it("sets the label and the reason, and nothing else", () => {
    expect(leadDecisionProperties(BOTH, { decision: "hand_over", reason: "belongs to another project" })).toEqual({ "Hub decision": { select: { name: "For you" } }, "Hub reason": { rich_text: [{ type: "text", text: { content: "belongs to another project" } }] } });
    expect(Object.keys(leadDecisionProperties({ ...BOTH, Status: { type: "status" } }, { decision: "reply", reason: "x" }))).toEqual(["Hub decision", "Hub reason"]);
    expect(leadDecisionProperties({ "Hub decision": { type: "rich_text" } }, { decision: "reply", reason: "x" })).toEqual({});
  });

  it("writes the lead's page through the project's Leads database; skips one without the properties", async () => {
    const w = writer();
    const env = { projectsDir: join(dir, "projects"), secretsDir: join(dir, "secrets") };
    expect(await syncLeadDecision({ ...env, clients: () => ({ reader: reader(BOTH), writer: w }) }, { project: "acme", pageId: "p1", decision: "spam", reason: "a bot form" })).toEqual({ state: "synced", properties: 2 });
    expect(w.calls).toEqual([["p1", { "Hub decision": { select: { name: "Spam proposed" } }, "Hub reason": { rich_text: [{ type: "text", text: { content: "a bot form" } }] } }]]);
    const none = writer();
    expect(await syncLeadDecision({ ...env, clients: () => ({ reader: reader({}), writer: none }) }, { project: "acme", pageId: "p1", decision: "spam", reason: "x" })).toMatchObject({ state: "skipped", detail: expect.stringContaining("notion.lead-pass") });
    expect(none.calls).toEqual([]);
  });

  it("never throws: a failed write is a state", async () => {
    const env = { projectsDir: join(dir, "projects"), secretsDir: join(dir, "secrets") };
    const bad: LeadDecisionWriter = { setProperties: async () => Promise.reject(Object.assign(new Error("no"), { status: 403 })) };
    expect(await syncLeadDecision({ ...env, clients: () => ({ reader: reader(BOTH), writer: bad }) }, { project: "acme", pageId: "p1", decision: "reply", reason: "x" })).toMatchObject({ state: "failed", detail: expect.stringContaining("HTTP 403") });
  });
});

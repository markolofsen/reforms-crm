import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLlm, fakeTransport } from "@hub/llm";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { prepareMessengerReply } from "../../src/messengers/reply";

let handle: DbHandle;
let repos: Repos;
let projectsDir: string;
let clientId: number;
let chatId: number;
let policyDir: string;

const projectFile = `# Demo

## Settings

| Field | Value | Answered | By |
|---|---|---|---|
| schema | 1 | 2026-11-21 | owner |
| status | active | 2026-11-21 | owner |
| mail.accounts | hello@example.test | 2026-11-21 | owner |
`;

beforeEach(async () => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  projectsDir = mkdtempSync(join(tmpdir(), "hub-messenger-reply-"));
  policyDir = mkdtempSync(join(tmpdir(), "hub-messenger-policy-"));
  mkdirSync(join(projectsDir, "p"));
  mkdirSync(join(policyDir, "p"));
  writeFileSync(join(policyDir, "p", "send-policy.json"), JSON.stringify({ schema: 1, recipients: "any", mode: "draft", classes: [], dailyCap: 5, delayMinutes: 1, updatedAt: "2026-11-21T00:00:00.000Z", by: "test" }));
  writeFileSync(join(projectsDir, "p", "project.md"), projectFile);
  await repos.projects.replaceRegistry({ projects: [{ slug: "p", name: "P", status: "active", settingsJson: "{}", hash: "p" }], addresses: [] });
  clientId = await repos.clients.create({ project: "p", email: "anna@example.test", name: "Anna" });
  await repos.messengers.allowChat("p", "telegram_user", "1001", "Anna");
  await repos.messengers.addIdentifier("p", clientId, "telegram", "1001");
  chatId = (await repos.messengers.chat("p", "telegram_user", "1001"))?.id ?? 0;
  await repos.messengers.insertMessage({ project: "p", channel: "telegram_user", account: "1", chatId: "1001", remoteMessageId: "m1", direction: "in", text: "Can we meet tomorrow?", sentAt: "2026-11-21T09:00:00.000Z", retainUntil: "2099-01-01T00:00:00Z" });
});

afterEach(() => handle.close());

describe("prepareMessengerReply", () => {
  it("creates one unsent Hub LLM draft and never sends", async () => {
    const llm = createLlm({ ledger: repos.llmCalls, transport: fakeTransport() });
    const result = await prepareMessengerReply({ repos, llm, projectsDir, project: "p", chatId, body: {} });
    const draft = await repos.messengers.openDraft("p", "telegram_user", "1001");
    expect(result.provider).toBe("hub_llm");
    expect(draft).toMatchObject({ id: result.draftId, status: "draft", createdBy: "hub_llm", clientId });
    expect(draft?.text).toBe("fake");
    expect((await repos.runs.activity("p", { view: "drafts" })).rows[0]).toMatchObject({ outcome: "drafted", client: { id: clientId, name: "Anna" }, draftId: null, chatId: expect.any(Number), skill: "messenger-reply", why: "Hub LLM prepared an unsent draft." });
    expect((await repos.sends.summarySince("p", { today: "2026-11-21T00:00:00.000Z", day: "2026-11-21T00:00:00.000Z", stuckBefore: "2026-11-20T00:00:00.000Z" })).sentToday).toBe(0);
  });

  it("preserves the off safety rule and does not write a draft", async () => {
    await repos.messengers.setChatRules("p", "telegram_user", "1001", { replyMode: "off" });
    const llm = createLlm({ ledger: repos.llmCalls, transport: fakeTransport() });
    await expect(prepareMessengerReply({ repos, llm, projectsDir, project: "p", chatId, body: {} })).rejects.toMatchObject({ code: "refused" });
    expect(await repos.messengers.openDraft("p", "telegram_user", "1001")).toBeNull();
  });
});

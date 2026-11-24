import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { recordAgentDraft } from "../src/messenger/record";

// P129 verdict 14 (P133): one recorder for a machine-written messenger draft; the Activity reason names the real producer.
let dir: string;
let h: DbHandle;
let w: Repos;
let ann: number;
const AT = "2026-11-24T10:00:00.000Z";
const chat = { channel: "telegram_user" as const, chatId: "42", title: "Ann" };

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hub-messenger-record-"));
  h = openDb(path.join(dir, "app.db"));
  w = createRepos(h.db);
  ann = await w.clients.create({ project: "acme", email: "ann@example.com", name: "Ann" });
  await w.messengers.knowChat("acme", "telegram_user", "42", { title: "Ann" });
});
afterEach(() => {
  h.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("recordAgentDraft", () => {
  it("the agent's draft: createdBy agent, an agent-triggered run, the runtime agent named as producer", async () => {
    const r = await recordAgentDraft(w, { project: "acme", chat, client: { id: ann, name: "Ann" }, text: "Hello", provider: "runtime_agent", ownerRequest: null, nudge: false, at: AT });
    expect(r.action).toBe("created");
    expect(await w.messengers.openDraft("acme", "telegram_user", "42")).toMatchObject({ id: r.id, text: "Hello", createdBy: "agent", clientId: ann, status: "draft" });
    expect((await w.runs.activity("acme", { view: "drafts" })).rows[0]).toMatchObject({ outcome: "drafted", skill: "messenger-reply", why: "Runtime agent prepared an unsent draft.", provider: "runtime_agent" });
  });

  it("the Hub LLM's draft names the Hub LLM and its model; a revision updates the open draft, never a second one", async () => {
    const first = await recordAgentDraft(w, { project: "acme", chat, client: null, text: "v1", provider: "hub_llm", model: "fake/model", ownerRequest: "ответь", nudge: false, at: AT });
    expect(await w.messengers.openDraft("acme", "telegram_user", "42")).toMatchObject({ id: first.id, createdBy: "hub_llm", ownerRequest: "ответь" });
    expect((await w.runs.activity("acme", { view: "drafts" })).rows[0]).toMatchObject({ why: "Hub LLM prepared an unsent draft.", provider: "hub_llm" });
    const second = await recordAgentDraft(w, { project: "acme", chat, client: null, text: "v2", provider: "runtime_agent", ownerRequest: null, nudge: false, revise: first.id, at: AT });
    expect(second).toEqual({ id: first.id, action: "revised" });
    expect(await w.messengers.openDraft("acme", "telegram_user", "42")).toMatchObject({ id: first.id, text: "v2" });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb, type DbHandle } from "../src/client";
import { createRepos, type Repos } from "../src/repos";

// Activity (P73, decision 0037): one timeline of the agent's client decisions, newest first, read with no regard to runs.
// The fixtures are shaped like the saas data of 2026-11-20: one draft recorded, skips and an escalation each in a run of their
// own, then the same draft saved again over two days, its updates joining the draft's first run.
let handle: DbHandle;
let repos: Repos;
const at = (iso: string) => vi.setSystemTime(new Date(iso));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
});
afterEach(() => {
  handle.close();
  vi.useRealTimers();
});

async function saasLike() {
  at("2026-11-16T05:05:24.000Z");
  const { draftId, clientId } = await repos.drafts.record({ project: "p", email: "mark@x.example", name: "Mark Effect", subject: "S", mailRef: "<a@x>", reason: "asked for API access", skill: "triage-mail", batchKey: null });
  at("2026-11-16T05:05:36.000Z");
  await repos.inbox.record({ project: "p", email: "it@x.example", name: "IT-Helpdesk", action: "escalated", reason: "looks like phishing" }, new Date("2026-11-16T05:05:36.000Z"));
  at("2026-11-16T07:26:14.000Z");
  await repos.inbox.record({ project: "p", email: "talha@x.example", name: "Talha", action: "skipped", reason: "not-allowed-recipient: not in the allow list" }, new Date("2026-11-16T07:26:14.000Z"));
  at("2026-11-16T07:26:24.000Z");
  // Mark Effect's own address: the client row is found through the inbox, though the event carries no client id.
  await repos.inbox.record({ project: "p", email: "mark@x.example", name: "Mark Effect", action: "skipped", reason: "already-drafted: an unmarked draft replies to it" }, new Date("2026-11-16T07:26:24.000Z"));
  for (const t of ["2026-11-18T13:36:00.000Z", "2026-11-19T03:05:00.000Z", "2026-11-19T06:26:00.000Z"]) {
    at(t);
    await repos.drafts.revised("p", draftId, { excerpt: "v", wroteTo: null, brand: null });
  }
  return { draftId, clientId };
}

describe("one timeline", () => {
  it("rows newest first across runs and days; an update reads `updated`, `draft_write` gives no skill", async () => {
    const { draftId, clientId } = await saasLike();
    const t = await repos.runs.activity("p");
    expect(t.rows.map((r) => [r.at.slice(0, 16), r.who, r.outcome])).toEqual([
      ["2026-11-19T06:26", "Mark Effect", "updated"],
      ["2026-11-19T03:05", "Mark Effect", "updated"],
      ["2026-11-18T13:36", "Mark Effect", "updated"],
      ["2026-11-16T07:26", "Mark Effect", "skipped"],
      ["2026-11-16T07:26", "Talha", "skipped"],
      ["2026-11-16T05:05", "IT-Helpdesk", "escalated"],
      ["2026-11-16T05:05", "Mark Effect", "drafted"],
    ]);
    expect(t.rows.slice(0, 3).every((r) => r.skill === null && r.draftId === draftId && r.why === "asked for API access")).toBe(true);
    expect(t.rows.at(-1)).toMatchObject({ outcome: "drafted", skill: "triage-mail", client: { id: clientId, name: "Mark Effect" } });
    expect(t.rows[3]).toMatchObject({ client: { id: clientId }, why: "already-drafted: an unmarked draft replies to it" });
    expect(t.counts).toEqual({ all: 7, needs_you: 1, drafts: 4, skipped: 2 });
    expect(t.next).toBeNull();
    expect(t.client).toBeNull();
    expect(t.rows[0]).not.toHaveProperty("runId");
  });

  it("a view narrows the rows by outcome; the counts stay whole", async () => {
    await saasLike();
    const needs = await repos.runs.activity("p", { view: "needs_you" });
    expect(needs.rows.map((r) => r.who)).toEqual(["IT-Helpdesk"]);
    expect((await repos.runs.activity("p", { view: "drafts" })).rows.map((r) => r.outcome)).toEqual(["updated", "updated", "updated", "drafted"]);
    expect((await repos.runs.activity("p", { view: "skipped" })).rows).toHaveLength(2);
    expect(needs.counts).toEqual((await repos.runs.activity("p")).counts);
  });

  it("`client` narrows to one client, the inbox-resolved rows included, and names it", async () => {
    const { clientId } = await saasLike();
    const one = await repos.runs.activity("p", { client: clientId });
    expect(one.client).toEqual({ id: clientId, name: "Mark Effect" });
    expect(one.rows.map((r) => r.outcome)).toEqual(["updated", "updated", "updated", "skipped", "drafted"]);
    expect(one.counts).toEqual({ all: 5, needs_you: 0, drafts: 4, skipped: 1 });
    expect(await repos.runs.activity("p", { client: 9999 })).toMatchObject({ rows: [], client: null });
  });

  it("pages by events: no row twice, none lost, the last page has no cursor", async () => {
    await saasLike();
    const seen: number[] = [];
    let before: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page = await repos.runs.activity("p", { limit: 3, before });
      seen.push(...page.rows.map((r) => r.id));
      if (!page.next) break;
      before = page.next;
    }
    const all = (await repos.runs.activity("p")).rows.map((r) => r.id);
    expect(seen).toEqual(all);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("notes are not rows, and a project sees only its own", async () => {
    const run = await repos.runs.start({ project: "p", startedAt: "2026-11-14T10:00:00.000Z", trigger: "schedule" });
    await repos.runs.addEvent({ project: "p", runId: run, at: "2026-11-14T10:00:01.000Z", kind: "thought", summary: "one" });
    await repos.runs.addEvent({ project: "p", runId: run, at: "2026-11-14T10:00:02.000Z", kind: "error", summary: "x" });
    await repos.inbox.record({ project: "q", email: "a@x.example", name: "A", action: "skipped" }, new Date("2026-11-14T10:00:03.000Z"));
    expect((await repos.runs.activity("p")).rows).toEqual([]);
    expect((await repos.runs.activity("q")).rows.map((r) => r.who)).toEqual(["A"]);
  });

  it("P87: a sent mail is a row of All (outcome sent, the way it went as why), never of another view; keys tell a send from an event with the same id", async () => {
    const { draftId, clientId } = await saasLike();
    at("2026-11-20T12:06:45.000Z");
    const row = await repos.sends.begin({ project: "p", draftId, mode: "manual", status: "sending", actor: "admin-batch", to: "mark@x.example", subject: "Re: Hello", body: "Hi" });
    await repos.sends.markSent(row.id, "s@x");
    const all = await repos.runs.activity("p");
    expect(all.rows[0]).toMatchObject({ key: `send:${row.id}`, outcome: "sent", why: "Batch", draftId, client: { id: clientId, name: "Mark Effect" } });
    expect(new Set(all.rows.map((r) => r.key)).size).toBe(all.rows.length);
    expect((await repos.runs.activity("p", { view: "drafts" })).rows.some((r) => r.outcome === "sent")).toBe(false);
    expect((await repos.runs.activity("p", { client: clientId })).rows[0]?.outcome).toBe("sent");
    const first = await repos.runs.activity("p", { limit: 1 });
    expect(first.next).toBe(`${all.rows[0]!.at}|send:${row.id}`);
    expect((await repos.runs.activity("p", { before: first.next })).rows[0]?.key).toBe(all.rows[1]?.key);
  });

  it("labels a manually confirmed Messenger send as By hand", async () => {
    const clientId = await repos.clients.create({ project: "p", email: "anna@x.example", name: "Anna" });
    await repos.messengers.knowChat("p", "telegram_user", "1001", { title: "Anna" });
    await repos.messengers.addIdentifier("p", clientId, "telegram", "1001");
    const draft = await repos.messengers.createDraft({ project: "p", channel: "telegram_user", chatId: "1001", text: "Hi", createdBy: "hub_llm", clientId });
    await repos.messengers.confirmDraft("p", draft.id, "admin", "2026-11-20T12:00:00.000Z");
    const row = await repos.sends.beginMessage({ project: "p", channel: "telegram_user", messengerDraftId: draft.id, account: "1", to: "telegram:1001", name: "Anna", text: "Hi", actor: "admin", at: "2026-11-20T12:00:00.000Z", limits: { dailyCap: 5, spacingSeconds: 20 } });
    await repos.messengers.markDraftSent("p", draft.id, "remote-1", "2026-11-20T12:00:01.000Z");
    await repos.sends.markSent(row.id, "remote-1");
    const chat = handle.db.$client.prepare("select id from messenger_chats where project = 'p' and chat_id = '1001'").get() as { id: number };
    expect((await repos.runs.activity("p")).rows[0]).toMatchObject({ key: `send:${row.id}`, why: "By hand on Telegram", provider: null, draftId: null, chatId: chat.id });
  });

  it("P128 X0 (F30): a messenger draft's row opens its chat: chatId is the chat row, draftId is not read as a Mail draft", async () => {
    const clientId = await repos.clients.create({ project: "p", email: "anna@x.example", name: "Anna" });
    await repos.messengers.knowChat("p", "telegram_user", "1001", { title: "Anna" });
    const draft = await repos.messengers.createDraft({ project: "p", channel: "telegram_user", chatId: "1001", text: "Hi", createdBy: "hub_llm", clientId });
    const t = "2026-11-21T09:00:00.000Z";
    const runId = await repos.runs.start({ project: "p", startedAt: t, finishedAt: t, trigger: "owner", skill: "messenger-reply", status: "ok" });
    await repos.runs.addEvent({ project: "p", runId, at: t, kind: "draft_created", tool: "messenger_prepare", summary: "Drafted reply for Anna", detail: JSON.stringify({ action: "drafted", draftId: draft.id, reason: "Hub LLM prepared an unsent draft.", skill: "messenger-reply", provider: "hub_llm" }), clientId });
    const chat = handle.db.$client.prepare("select id from messenger_chats where project = 'p' and chat_id = '1001'").get() as { id: number };
    expect((await repos.runs.activity("p")).rows[0]).toMatchObject({ outcome: "drafted", draftId: null, chatId: chat.id, why: "Hub LLM prepared an unsent draft.", client: { id: clientId, name: "Anna" } });
  });
});


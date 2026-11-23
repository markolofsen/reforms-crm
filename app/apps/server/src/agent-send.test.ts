import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_WORD_SEND_ACTOR } from "@hub/config";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import type { LogEvent } from "@hub/log/event";
import { FakeMtClient } from "@hub/messengers";
import { writeSession } from "@hub/messengers/human";
import { setSendPolicy } from "@hub/projects/send-policy";
import { FakeMailer } from "@hub/send/mailer";
import { testApp } from "./test-support/runtime";
import { startTelegramUser, type TelegramUserHandle } from "./messengers/accounts/telegram-user";

// Decision 0046 (P132 B1-4): the agent sends one messenger draft on the owner's word, through the same door as his Send, on a
// fake mtcute client and a fake session log (no network, no login, nothing sent anywhere). One test per case of the slice:
// the word sends once; no word, a word before the draft, another chat, a second call are refused with a code and a next step;
// only hub mcp's token opens the route, never on an unattended instance, never for Mail; Activity says "Agent (your word)".

const projectMd = ["# P", "", "## Settings", "", "| Field | Value | Answered | By |", "|---|---|---|---|", "| schema | 1 | 2026-11-14 | agent |", "| status | active | 2026-11-15 | agent |", "| mail.accounts | owner@p.example | 2026-11-14 | agent |", "", "## Notion databases", "", "- clients: 00000000-0000-4000-8000-000000000001", ""].join("\n");

const BASE = "http://127.0.0.1:4317";
const TOKEN = "a".repeat(64);
const H = { "content-type": "application/json", "x-hub-agent-token": TOKEN };
const TEXT = "Yes, the 28th stands.";

let handle: DbHandle;
let repos: Repos;
let fake: FakeMtClient;
let tg: TelegramUserHandle;
let root: string;
let clock: number;
let events: LogEvent[];
let unattended: boolean;
let chat: number;
let otherChat: number;

const app = () =>
  testApp(repos, {
    telegramUser: tg,
    adminPort: 5173,
    sender: { kind: "fake", mailer: new FakeMailer(), projectsDir: join(root, "projects"), policyDir: join(root, "state", "projects"), allowList: ["telegram:1001", "telegram:1002"], adminPort: 5173, now: () => new Date(clock), agent: { token: TOKEN, unattended: () => unattended, events: () => events } },
  });
const send = (a: ReturnType<typeof app>, draft: number, c = chat, headers: Record<string, string> = H) => a.request(`${BASE}/api/projects/p/messengers/drafts/${draft}/agent-send`, { method: "POST", headers, body: JSON.stringify({ chat: c }) });
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;
/** An owner prompt in the session log, `ms` after the clock, with the admin showing `shown` (a chat row id) when given. */
function say(text: string, ms: number, shown?: number) {
  const ts = new Date(clock + ms).toISOString();
  events.push({ v: 1, ts, project: "p", session: "s1", cli: "claude", kind: "prompt", turn: `t${events.length}`, data: { text } });
  if (shown !== undefined) events.push({ v: 1, ts, project: "p", session: "s1", cli: "claude", kind: "focus", turn: `t${events.length - 1}`, data: { line: `[Hub focus, data] Messengers · open chat:${shown} "Anna" · 2 s ago` } });
}
const draft = async (chatId = "1001", text = TEXT) => (await repos.messengers.createDraft({ project: "p", channel: "telegram_user", chatId, text, createdBy: "agent" })).id;
async function link(chatId: string) {
  await repos.messengers.allowChat("p", "telegram_user", chatId, `Chat ${chatId}`);
  await repos.messengers.insertMessage({ project: "p", channel: "telegram_user", account: "42", chatId, remoteMessageId: `in-${chatId}`, direction: "in", kind: "text", text: "Is the 28th still on?", sentAt: new Date(Date.now() - 3_600_000).toISOString(), retainUntil: "2099-01-01T00:00:00.000Z" });
  return (await repos.messengers.chat("p", "telegram_user", chatId))!.id;
}
const refusal = async (r: Response, status = 409) => {
  expect(r.status).toBe(status);
  const b = await json(r);
  expect(b.next).toEqual(expect.any(String));
  return b.reason;
};

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "hub-agent-send-"));
  mkdirSync(join(root, "projects", "p"), { recursive: true });
  writeFileSync(join(root, "projects", "p", "project.md"), projectMd);
  setSendPolicy(join(root, "state", "projects"), "p", "generic", { "draft.recipients": "test" }, "test");
  handle = openDb(join(root, "app.db"));
  repos = createRepos(handle.db);
  await repos.projects.replaceRegistry({ projects: [{ slug: "p", name: "P", status: "active", settingsJson: "{}", hash: "p" }], addresses: [] });
  const anna = await repos.clients.create({ project: "p", email: "anna@example.test", name: "Anna" });
  const sessions = join(root, "sessions");
  writeSession(sessions, "telegram_user", "42", { apiId: 1, apiHash: "0123456789abcdef0123456789abcdef", session: "S" });
  fake = new FakeMtClient();
  clock = Date.now();
  events = [];
  unattended = false;
  tg = await startTelegramUser({ repos, env: {}, dir: sessions, clients: { session: () => fake, login: () => { throw new Error("no login in this test"); } }, now: () => new Date(clock) });
  await vi.waitFor(() => expect(fake.listening).toBe(true));
  chat = await link("1001");
  await repos.messengers.addIdentifier("p", anna, "telegram", "1001");
  otherChat = await link("1002");
});
afterEach(async () => {
  await tg.stop();
  handle.close();
});

describe("the agent's send on the owner's word (decision 0046)", () => {
  it("the owner's word after the draft sends it once through the door, with actor agent_on_owner_word and the word's reference", async () => {
    const a = app();
    const id = await draft();
    clock += 2_000;
    say("отправь", 1_000, chat);
    clock += 5_000;
    const r = await send(a, id);
    expect(r.status).toBe(200);
    const body = await json(r);
    expect(body).toMatchObject({ ok: true, channel: "telegram_user", chatId: "1001", to: "Anna", text: TEXT });
    expect(fake.sent).toEqual([{ chatId: 1001, text: TEXT, id: expect.any(Number) }]);
    const row = await repos.sends.get(body.sendId as number);
    expect(row).toMatchObject({ status: "sent", actor: AGENT_WORD_SEND_ACTOR, messengerDraftId: id, toAddr: "telegram:1001", body: TEXT, ownerWord: `s1@${events[0]!.ts}` });
    expect(await repos.messengers.getDraft("p", id)).toMatchObject({ status: "sent", confirmedBy: AGENT_WORD_SEND_ACTOR });

    // A second call on the same word is refused, and nothing more goes out.
    clock += 30_000;
    expect(await refusal(await send(a, id))).toBe("word_used");
    const next = await draft("1001", "And the keys?");
    clock += 30_000;
    expect(await refusal(await send(a, next))).toMatch(/word_before_draft|word_used/);
    expect(fake.sent).toHaveLength(1);

    // Activity: the send is a row of All, the way it went "Agent (your word) on Telegram"; the Sends view keeps the actor.
    const act = (await json(await a.request(`${BASE}/api/activity?project=p`))) as { rows: Array<{ outcome: string; why: string; who: string }> };
    expect(act.rows).toContainEqual(expect.objectContaining({ outcome: "sent", who: "Anna", why: "Agent (your word) on Telegram" }));
    const sends = (await json(await a.request(`${BASE}/api/projects/p/sends`))) as { sends: Array<{ actor: string }> };
    expect(sends.sends).toEqual([expect.objectContaining({ actor: AGENT_WORD_SEND_ACTOR })]);
  });

  it("no word, a word that only asks, a negation: no_owner_word, nothing sent", async () => {
    const a = app();
    const id = await draft();
    clock += 2_000;
    expect(await refusal(await send(a, id))).toBe("no_owner_word");
    say("отправить?", 500, chat);
    say("не отправляй пока", 1_000, chat);
    clock += 5_000;
    expect(await refusal(await send(a, id))).toBe("no_owner_word");
    expect(fake.sent).toEqual([]);
    expect(await repos.sends.list("p")).toEqual([]);
  });

  it("a word before the draft was written (or revised) is word_before_draft", async () => {
    const a = app();
    say("напиши Анне и отправь", -60_000, chat);
    const id = await draft();
    clock += 5_000;
    expect(await refusal(await send(a, id))).toBe("word_before_draft");
    // A word after the draft, then a revision of the text: the owner has not seen the new text.
    say("send it", 1_000, chat);
    clock += 3_000;
    await new Promise((r) => setTimeout(r, 5));
    await repos.messengers.reviseDraft("p", id, "Yes, the 29th stands.", {}, new Date(clock).toISOString());
    clock += 2_000;
    expect(await refusal(await send(a, id))).toBe("word_before_draft");
    expect(fake.sent).toEqual([]);
  });

  it("a different chat: the word names or shows another chat, or the tool names a chat the draft is not in", async () => {
    const a = app();
    const id = await draft();
    clock += 2_000;
    say("отправь", 1_000, otherChat);
    clock += 5_000;
    expect(await refusal(await send(a, id))).toBe("other_chat");
    say(`отправь chat:${otherChat}`, 1_000);
    clock += 5_000;
    expect(await refusal(await send(a, id))).toBe("other_chat");
    expect(await refusal(await send(a, id, otherChat))).toBe("other_chat");
    expect(fake.sent).toEqual([]);
  });

  it("only hub mcp's token opens it, an unattended instance never sends, and a Mail draft is never sent", async () => {
    const a = app();
    const id = await draft();
    clock += 2_000;
    say("отправь", 1_000, chat);
    clock += 5_000;
    expect(await refusal(await send(a, id, chat, { "content-type": "application/json" }), 403)).toBe("forbidden");
    expect(await refusal(await send(a, id, chat, { "content-type": "application/json", "x-hub-agent-token": "b".repeat(64) }), 403)).toBe("forbidden");
    unattended = true;
    expect(await refusal(await send(a, id))).toBe("unattended");
    unattended = false;
    // A Mail draft's id names no messenger draft of the chat.
    const mail = await repos.drafts.record({ project: "p", email: "anna@example.test", name: "Anna", subject: "S", mailRef: "<m@x>", mailClass: "client" });
    expect(await refusal(await send(a, mail.draftId + 100), 404)).toBe("not_found");
    expect(fake.sent).toEqual([]);
    // The door's own guards still hold: Stop sending refuses with its words.
    await a.request(`${BASE}/api/projects/p/sends/stop`, { method: "POST", headers: { "content-type": "application/json" } });
    const stopped = await send(a, id);
    expect(await refusal(stopped)).toBe("refused");
    expect(fake.sent).toEqual([]);
  });
});

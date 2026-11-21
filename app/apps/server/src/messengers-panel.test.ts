import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { messengerChatsDto } from "@hub/contract/messenger-panel";
import { createApp } from "./app";

// The Messengers section's routes (P71 M3): the panel's chats with their open draft, Edit, Skip and its Undo, one chat's rules,
// and the client lookup of the link picker, on an in-memory database. No Telegram client: nothing here sends or reads Telegram.

const ADMIN = 5173;
const HEADERS = { origin: `http://127.0.0.1:${ADMIN}`, "sec-fetch-site": "same-origin", "content-type": "application/json" };
const BASE = "http://127.0.0.1:4317";

let handle: DbHandle;
let repos: Repos;
let app: ReturnType<typeof createApp>;
let anna: number;
let draftId: number;
let chatRowId: number;

const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = HEADERS) =>
  app.request(`${BASE}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const chats = async (filter = "todo", channel = "all") => messengerChatsDto.parse(await (await call("GET", `/api/projects/p/messengers/chats?filter=${filter}&channel=${channel}`)).json());
const msg = (chatId: string, direction: "in" | "out", sentAt: string, text: string) =>
  repos.messengers.insertMessage({ project: "p", channel: "telegram_user", account: "1", chatId, remoteMessageId: `${chatId}-${sentAt}`, direction, text, sentAt, retainUntil: "2099-01-01T00:00:00Z" });

beforeEach(async () => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  await repos.projects.replaceRegistry({ projects: [{ slug: "p", name: "P", status: "active", settingsJson: "{}", hash: "p" }, { slug: "q", name: "Q", status: "active", settingsJson: "{}", hash: "q" }], addresses: [] });
  anna = await repos.clients.create({ project: "p", email: "anna@example.test", name: "Anna Field" });
  await repos.clients.create({ project: "q", email: "anna@other.test", name: "Anna Other" });
  await repos.messengers.allowChat("p", "telegram_user", "1001", "Anna");
  await repos.messengers.addIdentifier("p", anna, "telegram", "1001");
  await msg("1001", "in", "2026-11-20T09:00:00.000Z", "Is the flat still free?");
  draftId = (await repos.messengers.createDraft({ project: "p", channel: "telegram_user", chatId: "1001", text: "Yes, it is.", createdBy: "agent", clientId: anna })).id;
  // A second chat where we replied last: nothing owed.
  await repos.messengers.allowChat("p", "telegram_user", "2002", "Bob");
  await msg("2002", "out", "2026-11-19T09:00:00.000Z", "Thanks!");
  chatRowId = (await repos.messengers.chat("p", "telegram_user", "1001"))?.id ?? 0;
  app = createApp(repos, { adminPort: ADMIN });
});
afterEach(() => handle.close());

describe("the Messengers panel", () => {
  it("lists the waiting chat with its client, its newest message and the agent's draft; Linked has both, counts over both", async () => {
    const w = await chats();
    expect(w.counts).toEqual({ todo: 1, linked: 2 });
    expect(w.chats).toHaveLength(1);
    expect(w.chats[0]).toMatchObject({ id: chatRowId, channel: "telegram_user", client: { id: anna, name: "Anna Field" }, owed: true, inbound: 1, last: { direction: "in", text: "Is the flat still free?" }, draft: { id: draftId, text: "Yes, it is." }, rules: { replyMode: "draft", prefilter: false } });
    const all = await chats("linked");
    expect(all.chats.map((c) => c.title)).toEqual(["Anna", "Bob"]);
    expect(all.chats[1]).toMatchObject({ owed: false, draft: null, client: null });
    // P84c: Hidden lists no linked chat (a hidden chat is never linked), and the channel filters the list and its counts.
    expect((await chats("hidden")).chats).toEqual([]);
    expect((await chats("unlinked")).chats).toEqual([]);
    await repos.messengers.allowChat("p", "whatsapp", "+6281300001111", "Wati");
    expect((await chats("linked", "whatsapp")).chats.map((c) => c.title)).toEqual(["Wati"]);
    expect((await chats("linked", "whatsapp")).counts).toEqual({ todo: 0, linked: 1 });
    expect((await chats("linked", "telegram")).counts).toEqual({ todo: 1, linked: 2 });
    expect((await chats("linked", "nope")).counts).toEqual({ todo: 1, linked: 3 });
    expect((await call("GET", "/api/projects/nope/messengers/chats")).status).toBe(404);
  });

  it("Edit changes the draft's text; an empty text and a foreign Origin are refused", async () => {
    const r = await call("PUT", `/api/projects/p/messengers/drafts/${draftId}/text`, { text: "Yes, from Monday." });
    expect(r.status).toBe(200);
    expect((await repos.messengers.getDraft("p", draftId))?.text).toBe("Yes, from Monday.");
    expect((await call("PUT", `/api/projects/p/messengers/drafts/${draftId}/text`, { text: "  " })).status).toBe(400);
    expect((await call("PUT", `/api/projects/p/messengers/drafts/${draftId}/text`, { text: "x" }, { ...HEADERS, origin: "http://127.0.0.1:9999" })).status).toBe(403);
    expect((await call("PUT", `/api/projects/q/messengers/drafts/${draftId}/text`, { text: "x" })).status).toBe(404);
  });

  it("Skip sets the draft aside and its Undo brings it back; a second Skip is a conflict", async () => {
    expect((await call("POST", `/api/projects/p/messengers/drafts/${draftId}/skip`, {})).status).toBe(200);
    expect((await repos.messengers.getDraft("p", draftId))?.status).toBe("discarded");
    expect((await chats()).chats[0]?.draft).toBeNull();
    expect((await call("POST", `/api/projects/p/messengers/drafts/${draftId}/skip`, {})).status).toBe(409);
    expect((await call("POST", `/api/projects/p/messengers/drafts/${draftId}/restore`, {})).status).toBe(200);
    expect((await chats()).chats[0]?.draft?.id).toBe(draftId);
  });

  it("a chat's rules are set through setChatRules; out-of-bounds and another project's chat are refused", async () => {
    const r = await call("PUT", `/api/projects/p/messengers/chats/${chatRowId}/rules`, { replyMode: "on_request", mayNudge: true, nudgeAfterDays: 5, instruction: "Formal, short.", language: "en" });
    expect(r.status).toBe(200);
    expect((await r.json()) as unknown).toMatchObject({ rules: { replyMode: "on_request", mayNudge: true, nudgeAfterDays: 5, instruction: "Formal, short.", language: "en", prefilter: false } });
    expect((await call("PUT", `/api/projects/p/messengers/chats/${chatRowId}/rules`, { nudgeAfterDays: 99 })).status).toBe(400);
    expect((await call("PUT", `/api/projects/p/messengers/chats/${chatRowId}/rules`, { instruction: "x".repeat(4001) })).status).toBe(400);
    expect((await call("PUT", `/api/projects/p/messengers/chats/${chatRowId}/rules`, {})).status).toBe(400);
    expect((await call("PUT", `/api/projects/q/messengers/chats/${chatRowId}/rules`, { mayNudge: true })).status).toBe(404);
    expect((await call("PUT", `/api/projects/p/messengers/chats/${chatRowId}/rules`, { mayNudge: false }, { ...HEADERS, "sec-fetch-site": "same-site" })).status).toBe(403);
  });
});

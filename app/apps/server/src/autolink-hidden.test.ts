import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UNLINKED_FRESH_DAYS } from "@hub/config/chat-rules";
import { autolinkStateDto } from "@hub/contract/messengers";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import type { UserDialog } from "@hub/messengers";
import { createApp } from "./app";
import { startAutolink, type Autolink, type AutolinkAdapter } from "./autolink";
import { startClientDirectory, type ClientDirectory } from "./client-directory";

// P84c: Chats shows only fresh unlinked chats, Hide ("not a client") keeps a keyed hash and names the chat in Hidden while the
// memory knows it, and Unhide deletes the refusal. A fake adapter with a scripted dialog list; no Telegram, no Notion, no network.

const ADMIN = 5173;
const HEADERS = { origin: `http://127.0.0.1:${ADMIN}`, "sec-fetch-site": "same-origin", "content-type": "application/json" };
const BASE = "http://127.0.0.1:4317";
const NOW = new Date("2026-11-20T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

let handle: DbHandle;
let repos: Repos;
let dir: string;
let directory: ClientDirectory;
let al: Autolink;
let dialogs: UserDialog[];

const adapter = { dialogs: async () => dialogs } as unknown as AutolinkAdapter;
const make = () =>
  startAutolink({ repos, project: "p", directory, enabled: async () => true, adapterOf: () => adapter, accounts: () => [{ channel: "telegram_user", account: "42" }], keyFile: join(dir, "autolink-key"), now: () => NOW });
const app = () => createApp(repos, { autolink: { project: null, autolink: al, directory, stop: () => undefined }, adminPort: ADMIN });
const post = async (path: string, body: unknown = {}, headers: Record<string, string> = HEADERS) => app().request(`${BASE}/api/projects/p/messengers/autolink/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
const state = async () => autolinkStateDto.parse(await (await post("state")).json());
const rows = (sql: string) => handle.db.$client.prepare(sql).all();

beforeEach(async () => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  await repos.projects.replaceRegistry({ projects: [{ slug: "p", name: "P", status: "active", settingsJson: "{}", hash: "p" }], addresses: [] });
  dir = mkdtempSync(join(tmpdir(), "hub-autolink-hidden-"));
  // No Notion read: nothing matches, so every dialog is an unlinked row with "No client in Notion has its phone or username".
  directory = startClientDirectory({ dataSourceId: null, tokenFile: "notion-token", auto: false });
  dialogs = [
    { chatId: "2001", title: "Fresh Fay", username: null, phone: null, last: { at: daysAgo(2), inbound: true } },
    { chatId: "2002", title: "Old Olga", username: null, phone: null, last: { at: daysAgo(UNLINKED_FRESH_DAYS + 1), inbound: true } },
    { chatId: "2003", title: "Unknown Una", username: null, phone: null, last: null },
  ];
  al = make();
});
afterEach(() => {
  directory.stop();
  handle.close();
});

describe("only fresh unlinked chats", () => {
  it(`lists a chat whose newest message is at most ${UNLINKED_FRESH_DAYS} days old, never an older or an undated one; a live message is fresh`, async () => {
    await al.scan("telegram_user", "42");
    await al.idle();
    let st = await state();
    expect(st.freshDays).toBe(UNLINKED_FRESH_DAYS);
    expect(st.recent.map((r) => [r.title, r.last])).toEqual([["Fresh Fay", { at: daysAgo(2), inbound: true }]]);
    // Olga writes now: she is fresh again, newest first.
    al.seen("telegram_user", "42", { chatId: "2002", title: "Old Olga", phone: null, username: null }, true);
    await al.idle();
    st = await state();
    expect(st.recent.map((r) => r.title)).toEqual(["Old Olga", "Fresh Fay"]);
    expect(st.recent[0]!.last).toEqual({ at: NOW.toISOString(), inbound: true });
  });
});

describe("Not linked keeps every remembered chat", () => {
  it("lists the old and the undated chats in unlinked (newest first) while recent stays the fresh ones; Unhide of an old chat shows it in unlinked only", async () => {
    await al.scan("telegram_user", "42");
    await al.idle();
    let st = await state();
    expect(st.unlinked.map((r) => r.title)).toEqual(["Fresh Fay", "Old Olga", "Unknown Una"]);
    await post("hide", { channel: "telegram_user", chatId: "2002" });
    await post("unhide", { channel: "telegram_user", chatId: "2002" });
    await al.idle();
    st = await state();
    expect(st.recent.map((r) => r.title)).toEqual(["Fresh Fay"]);
    expect(st.unlinked.map((r) => r.title)).toContain("Old Olga");
  });
});

describe("Hide and Unhide", () => {
  it("Hide keeps only a keyed hash, names the chat in Hidden from memory, holds after a restart, and Unhide brings it back", async () => {
    await al.scan("telegram_user", "42");
    await al.idle();
    expect((await post("hide", { channel: "telegram_user", chatId: "2001" }, { "content-type": "application/json" })).status).toBe(403);
    expect((await post("hide", { channel: "telegram_user", chatId: "2001" })).status).toBe(200);
    let st = await state();
    expect(st.recent).toEqual([]);
    expect(st.hidden).toEqual([{ channel: "telegram_user", chatId: "2001", account: "42", title: "Fresh Fay", hiddenAt: NOW.toISOString() }]);
    expect(st.hiddenUnnamed).toBe(0);
    const refusals = rows("select hash from messenger_link_refusals") as { hash: string }[];
    expect(refusals).toHaveLength(1);
    expect(JSON.stringify(refusals)).not.toMatch(/2001|Fay/);
    expect(rows("select count(*) n from messenger_chats")).toEqual([{ n: 0 }]);

    // A restart forgets the name, not the refusal: one hidden chat it cannot name, until the chat shows up again.
    al = make();
    st = await state();
    expect(st.hidden).toEqual([]);
    expect(st.hiddenUnnamed).toBe(1);
    await al.scan("telegram_user", "42");
    await al.idle();
    st = await state();
    expect(st.recent).toEqual([]);
    expect(st.hidden.map((h) => h.title)).toEqual(["Fresh Fay"]);
    expect(st.hiddenUnnamed).toBe(0);

    // Unhide deletes the refusal and the chat is a fresh unlinked row again.
    expect((await post("unhide", { channel: "telegram_user", chatId: "2001" })).status).toBe(200);
    await al.idle();
    st = await state();
    expect(st.hidden).toEqual([]);
    expect(st.recent.map((r) => r.title)).toEqual(["Fresh Fay"]);
    expect(rows("select count(*) n from messenger_link_refusals")).toEqual([{ n: 0 }]);
  });

  it("refuses to hide a linked chat (its rules row unlinks it first) and a body that is not a chat", async () => {
    await repos.messengers.allowChat("p", "telegram_user", "2001", "Fay");
    expect((await post("hide", { channel: "telegram_user", chatId: "2001" })).status).toBe(409);
    expect((await post("hide", { channel: "telegram_bot", chatId: "2001" })).status).toBe(400);
    expect((await post("hide", { channel: "telegram_user", chatId: "abc" })).status).toBe(400);
    expect(rows("select count(*) n from messenger_link_refusals")).toEqual([{ n: 0 }]);
  });
});

import { mkdtempSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdapterError, mtcuteClients, parkedOf } from "../src/adapter";
import { FakeLoginClient, FakeMtClient, FakeRpcError, fakePerson } from "../src/fake-user";
import { allowChat, createLoginFlows, humanActor, linkUserChat, removeSession, writeSession } from "../src/human";
import { confirmDraft, sendConfirmed } from "../src/send-confirmed";
import { mintConfirmed } from "../src/confirmed";
import { pollOnly } from "../src/adapter";
import { pollOnce, runPoller } from "../src/poller";
import { readSession, redactSessions, sessionAccounts } from "../src/sessions";
import { createTelegramUserAdapter, toUserAdapterError, toUserInbound } from "../src/telegram-user";
import { authorized, setup, type Env } from "./helpers";
import { captureOps } from "@hub/log/ops";

let env: Env;
let client: FakeMtClient;
const human = humanActor("owner");
const NOW = new Date("2026-11-20T12:00:00.000Z");
const anna = fakePerson(1001, "Anna", { phone: "79990001122" });
const stranger = fakePerson(2002, "Stranger Secret Name");

const adapterOf = (o: { queueMax?: number } = {}) =>
  createTelegramUserAdapter({
    client,
    account: "42",
    allowedChats: async () => (await env.repos.messengers.allowedChats("p")).filter((c) => c.channel === "telegram_user").map((c) => c.chatId),
    ...o,
  });
const deps = (adapter: ReturnType<typeof adapterOf>) => ({ project: "p", repos: env.repos, adapter, now: () => NOW, timeoutSec: 0 });
const allow = (chatId: string) => allowChat(env.repos, human, { project: "p", channel: "telegram_user", chatId });
const rowsOf = (chatId: string) => env.repos.messengers.messagesOf("p", [{ channel: "telegram_user", chatId }], { limit: 50 });
const count = (table: string) => env.handle.db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number };

beforeEach(async () => {
  env = await setup();
  client = new FakeMtClient();
});
afterEach(() => env.close());

describe("telegram user account: receive", () => {
  it("stores a linked chat's messages, both sides, and leaves no trace of an unlinked chat", async () => {
    await allow("1001");
    const a = adapterOf();
    await a.start?.();
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const cap = captureOps();
    client.emit(anna, "hello from Anna");
    client.emit(anna, "my reply", { out: true });
    client.emit(stranger, "private life, not for the hub");
    client.emit(stranger, "", { media: "photo" });
    const r = await pollOnce(deps(a));
    expect(r).toMatchObject({ fetched: 2, stored: 2, dropped: [] });
    expect((await rowsOf("1001")).map((m) => [m.direction, m.text])).toEqual([
      ["out", "my reply"],
      ["in", "hello from Anna"],
    ]);
    // Nothing of the stranger: no message, no chat row, no identifier, no client, no line in the account row or a log.
    expect(await rowsOf("2002")).toEqual([]);
    expect(count("messenger_messages").n).toBe(2);
    expect(count("messenger_chats").n).toBe(1);
    expect(count("client_identifiers").n).toBe(0);
    expect(count("clients").n).toBe(1);
    const acc = await env.repos.messengers.account("p", "telegram_user", "42");
    expect(JSON.stringify(acc)).not.toMatch(/2002|Stranger/);
    for (const spy of [log, warn, error]) expect(JSON.stringify(spy.mock.calls)).not.toMatch(/2002|Stranger|private life/);
    // P86: nor a line of the ops log.
    expect(JSON.stringify(cap.lines)).not.toMatch(/2002|Stranger|private life/);
    cap.stop();
    vi.restoreAllMocks();
  });

  it("reads private chats with people only: no group, bot or Saved Messages; media as its kind", () => {
    const base = { id: 5, date: NOW, text: "x", mediaType: null, isOutgoing: false, isService: false };
    expect(toUserInbound({ ...base, chat: { type: "other", id: -100, displayName: "Group" } }, "42")).toBeNull();
    expect(toUserInbound({ ...base, chat: { ...fakePerson(7), isBot: true } as never }, "42")).toBeNull();
    expect(toUserInbound({ ...base, chat: { ...fakePerson(42), isSelf: true } as never }, "42")).toBeNull();
    expect(toUserInbound({ ...base, isService: true, chat: anna }, "42")).toBeNull();
    expect(toUserInbound({ ...base, text: "", mediaType: "voice", chat: anna }, "42")).toMatchObject({ kind: "voice", text: "", channel: "telegram_user", direction: "in" });
  });

  it("drops a queued message of a chat unlinked before the drain", async () => {
    await allow("1001");
    const a = adapterOf();
    await a.start?.();
    client.emit(anna, "queued while linked");
    await env.repos.messengers.disallowChat("p", "telegram_user", "1001");
    const r = await pollOnce(deps(a));
    expect(r).toMatchObject({ fetched: 0, stored: 0, dropped: [] });
  });

  it("moves the cursor to the highest id and catches up from it after a restart or an overflow", async () => {
    await allow("1001");
    const a = adapterOf({ queueMax: 2 });
    await a.start?.();
    client.emit(anna, "one", { id: 10 });
    await pollOnce(deps(a));
    expect((await env.repos.messengers.account("p", "telegram_user", "42"))?.cursor).toBe("10");
    // Three messages into a queue of two: the queue is cleared and the history from the cursor is read instead.
    client.past = [11, 12, 13].map((id) => ({ id, date: NOW, text: `m${id}`, mediaType: null, isOutgoing: false, isService: false, chat: anna }));
    for (const id of [11, 12, 13]) client.emit(anna, `m${id}`, { id });
    const r = await pollOnce(deps(a));
    expect(client.historyCalls.at(-1)).toEqual({ chatId: 1001, minId: 10 });
    expect(r.stored).toBe(3);
    expect((await env.repos.messengers.account("p", "telegram_user", "42"))?.cursor).toBe("13");
  });

  it("refuses a session that belongs to another account than its folder", async () => {
    client = new FakeMtClient({ id: 7, displayName: "Someone" });
    await expect(adapterOf().start?.()).rejects.toMatchObject({ code: "logged_out" });
  });
});

describe("telegram user account: errors and parking", () => {
  it("maps Telegram's errors: logged out, banned, long and short flood waits, network", () => {
    expect(toUserAdapterError(new FakeRpcError(401, "AUTH_KEY_UNREGISTERED"))).toMatchObject({ code: "logged_out", fatal: true, parked: true });
    expect(toUserAdapterError(new FakeRpcError(401, "SESSION_REVOKED")).code).toBe("logged_out");
    expect(toUserAdapterError(new FakeRpcError(403, "USER_DEACTIVATED_BAN")).code).toBe("banned");
    expect(toUserAdapterError(new FakeRpcError(420, "FLOOD_WAIT_%d", 3601))).toMatchObject({ code: "flood_wait", fatal: true });
    expect(toUserAdapterError(new FakeRpcError(420, "FLOOD_WAIT_%d", 3599))).toMatchObject({ code: "rate_limited", fatal: false, retryAfterMs: 3_599_000 });
    expect(toUserAdapterError(Object.assign(new Error("read ECONNRESET"), { name: "Error" }))).toMatchObject({ code: "network", fatal: false });
    expect(toUserAdapterError(new Error("Anna wrote something odd")).message).not.toMatch(/Anna/);
  });

  it("logged_out parks the account: the loop stops, the park is recorded and is never retried", async () => {
    await allow("1001");
    const a = adapterOf();
    let polls = 0;
    const run = runPoller({
      ...deps(a),
      adapter: { channel: a.channel, account: a.account, start: () => a.start?.() ?? Promise.resolve(), poll: (o) => (polls++, a.poll(o)) },
      sleep: async () => undefined,
    });
    await vi.waitFor(() => expect(client.listening).toBe(true));
    client.fail(new FakeRpcError(401, "AUTH_KEY_UNREGISTERED"));
    await expect(run).rejects.toBeInstanceOf(AdapterError);
    const row = await env.repos.messengers.account("p", "telegram_user", "42");
    expect(parkedOf(row?.lastError)).toBe("logged_out");
    const after = polls;
    await new Promise((r) => setTimeout(r, 20));
    expect(polls).toBe(after);
  });
});

describe("telegram user account: send (P71 M4)", () => {
  it("sends a confirmed draft once to a linked chat, records it as an outbound row, and the poller's view has no send", async () => {
    await allow("1001");
    const adapter = adapterOf();
    await adapter.start!();
    const d = await env.repos.messengers.createDraft({ project: "p", channel: "telegram_user", chatId: "1001", text: "Hi Anna", createdBy: "agent" });
    await confirmDraft(env.repos, await authorized(env.repos, "p", d.id), {});
    const r = await sendConfirmed({ repos: env.repos, adapter, now: () => NOW }, await authorized(env.repos, "p", d.id));
    expect(client.sent).toEqual([{ chatId: 1001, text: "Hi Anna", id: Number(r.remoteMessageId) }]);
    expect((await env.repos.messengers.getDraft("p", d.id))?.status).toBe("sent");
    expect((await rowsOf("1001")).map((m) => [m.direction, m.text])).toEqual([["out", "Hi Anna"]]);
    expect("send" in pollOnly(adapter)).toBe(false);
  });

  it("refuses a hand-built draft, another channel and an unlinked chat, and maps Telegram's refusal", async () => {
    await allow("1001");
    const adapter = adapterOf();
    await adapter.start!();
    const base = { id: 1, project: "p", chatId: "1001", text: "x", confirmedBy: "owner", confirmedAt: "" };
    await expect(adapter.send({ ...base, channel: "telegram_user", state: "confirmed" } as never)).rejects.toThrow(/not_confirmed/);
    await expect(adapter.send(mintConfirmed({ ...base, channel: "telegram_bot" }))).rejects.toThrow(/adapter_mismatch/);
    await expect(adapter.send(mintConfirmed({ ...base, channel: "telegram_user", chatId: "2002" }))).rejects.toThrow(/chat_not_allowed/);
    client.sendError = new FakeRpcError(420, "FLOOD_WAIT_7200", 7200);
    await expect(adapter.send(mintConfirmed({ ...base, channel: "telegram_user" }))).rejects.toMatchObject({ code: "flood_wait" });
    expect(client.sent).toEqual([]);
  });
});

describe("telegram user account: link and import", () => {
  it("links a chat to a client, allows it and imports its last 30 days", async () => {
    const a = adapterOf();
    await a.start?.();
    const day = 86_400_000;
    client.past = [
      { id: 3, date: new Date(NOW.getTime() - 2 * day), text: "recent", mediaType: null, isOutgoing: false, isService: false, chat: anna },
      { id: 2, date: new Date(NOW.getTime() - 10 * day), text: "older, mine", mediaType: null, isOutgoing: true, isService: false, chat: anna },
      { id: 1, date: new Date(NOW.getTime() - 40 * day), text: "too old", mediaType: null, isOutgoing: false, isService: false, chat: anna },
    ];
    const r = await linkUserChat({ repos: env.repos, adapter: a, now: () => NOW }, human, { project: "p", clientId: env.clientId, chatId: "1001", title: "Anna" });
    expect(r).toMatchObject({ imported: 2, importError: null });
    expect(await env.repos.messengers.clientByIdentifier("p", "telegram", "1001")).toBe(env.clientId);
    expect(await env.repos.messengers.isAllowed("p", "telegram_user", "1001")).toBe(true);
    expect((await rowsOf("1001")).map((m) => m.text)).toEqual(["recent", "older, mine"]);
  });

  it("needs a human actor", async () => {
    const a = adapterOf();
    await expect(linkUserChat({ repos: env.repos, adapter: a }, { name: "agent" } as never, { project: "p", clientId: env.clientId, chatId: "1001" })).rejects.toMatchObject({ code: "not_human" });
  });
});

describe("telegram user account: login and session", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "hub-sessions-"));

  it("code, then the 2FA password, then the session alone is stored at mode 0600", async () => {
    const d = dir();
    const login = new FakeLoginClient({ twoFactor: true });
    const flows = createLoginFlows({ clientFor: () => login, store: async (account, s) => void writeSession(d, "telegram_user", account, s) });
    const s1 = await flows.start({ apiId: 12345, apiHash: "0123456789abcdef0123456789abcdef", phone: "+7 999 000 11 22" });
    expect(s1.step).toBe("code");
    const flow = s1.step === "code" ? s1.flow : "";
    expect(login.sentTo).toEqual(["+79990001122"]);
    await expect(flows.code(flow, "99999")).rejects.toThrow(/code is wrong/);
    expect(await flows.code(flow, "12345")).toEqual({ step: "password", flow });
    const bad = await flows.password(flow, "hunter2-typed").catch((e: Error) => e.message);
    expect(bad).toMatch(/password is wrong/);
    expect(bad).not.toMatch(/hunter2/);
    expect(await flows.password(flow, "pw")).toEqual({ step: "done", account: "42", name: "Owner" });
    expect(login.closed).toBe(1);
    expect(flows.size()).toBe(0);
    const file = join(d, "telegram_user-42", "session");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(d, "telegram_user-42")).mode & 0o777).toBe(0o700);
    expect(readSession(d, "telegram_user", "42")).toEqual({ state: "stored", session: { apiId: 12345, apiHash: "0123456789abcdef0123456789abcdef", session: "SESSION-STRING-OF-THE-FAKE-0123456789" } });
    expect(sessionAccounts(d, "telegram_user")).toEqual(["42"]);
    expect(redactSessions(d, "x SESSION-STRING-OF-THE-FAKE-0123456789 y")).toBe("x *** y");
    expect(removeSession(d, "telegram_user", "42")).toBe(true);
    expect(readSession(d, "telegram_user", "42")).toEqual({ state: "missing" });
  });

  it("an expired or unknown flow is refused; a refused send closes its client and keeps nothing", async () => {
    let t = 0;
    const login = new FakeLoginClient({ sendError: new FakeRpcError(400, "PHONE_NUMBER_INVALID") });
    const stored: string[] = [];
    const flows = createLoginFlows({ clientFor: () => login, store: async (a) => void stored.push(a), now: () => t, ttlMs: 1000 });
    await expect(flows.start({ apiId: 1, apiHash: "0123456789abcdef0123456789abcdef", phone: "+10000000000" })).rejects.toThrow(/phone number/);
    expect(login.closed).toBe(1);
    const ok = createLoginFlows({ clientFor: () => new FakeLoginClient(), store: async (a) => void stored.push(a), now: () => t, ttlMs: 1000 });
    const s = await ok.start({ apiId: 1, apiHash: "0123456789abcdef0123456789abcdef", phone: "+10000000000" });
    t = 2000;
    await expect(ok.code(s.step === "code" ? s.flow : "", "12345")).rejects.toThrow(/expired/);
    await expect(ok.code("nope", "12345")).rejects.toThrow(/expired/);
    expect(stored).toEqual([]);
  });

  it("refuses a session file readable by others", () => {
    const d = dir();
    writeSession(d, "telegram_user", "42", { apiId: 1, apiHash: "h".repeat(32), session: "s" });
    chmodSync(join(d, "telegram_user-42", "session"), 0o644);
    expect(readSession(d, "telegram_user", "42").state).toBe("unsafe-mode");
    writeFileSync(join(d, "telegram_user-42", "session"), "not json", { mode: 0o600 });
    chmodSync(join(d, "telegram_user-42", "session"), 0o600);
    expect(readSession(d, "telegram_user", "42").state).toBe("malformed");
  });

  it("loads the real mtcute client and builds one without any network or the refused native build", async () => {
    const real = await mtcuteClients();
    const c = real.login({ apiId: 1, apiHash: "0123456789abcdef0123456789abcdef" });
    await c.close();
    expect(typeof real.session).toBe("function");
  });
});

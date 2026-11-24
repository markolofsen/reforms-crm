import { chmodSync, existsSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdapterError, parkedOf, pollOnly } from "../src/adapter";
import { mintConfirmed } from "../src/confirmed";
import { FakeBoom, FakeWaSocket } from "../src/fake-wa";
import { createWaPairing, humanActor, linkIdentifier, linkUserChat, qrRows } from "../src/human";
import { confirmDraft, sendConfirmed } from "../src/send-confirmed";
import { pollOnce, runPoller } from "../src/poller";
import { createWhatsAppAdapter, type WhatsAppOptions } from "../src/whatsapp";
import { toWaAdapterError, type WaMessage } from "../src/whatsapp-socket";
import { CREDS, readWaAuth, WaAuthFiles, waFolderOf } from "../src/whatsapp-auth";
import { authorized, setup, type Env } from "./helpers";
import { captureOps } from "@hub/log/ops";

// P71 M5: WhatsApp as a linked device, on a FAKE Baileys socket. Nothing here opens a WebSocket or reaches WhatsApp: the one test
// that loads the real Baileys builds no socket (`makeWASocket` connects on creation and is never called).

let env: Env;
let sock: FakeWaSocket;
let built: number;
const human = humanActor("owner");
const NOW = new Date("2026-11-20T12:00:00.000Z");
const ACCOUNT = "4915100000001";
const ANNA = "+491510000002";
const STRANGER = "+491519999999";

const adapterOf = (extra: Partial<WhatsAppOptions> = {}) =>
  createWhatsAppAdapter({
    socket: () => {
      built++;
      sock = new FakeWaSocket(new WaAuthFiles(null));
      sock.autoOpen = true;
      return sock;
    },
    account: ACCOUNT,
    knownChats: async () => (await env.repos.messengers.knownChats("p")).filter((c) => c.channel === "whatsapp").map((c) => ({ chatId: c.chatId, jid: c.jid, linked: c.linked })),
    historyMs: 200,
    ...extra,
  });
const deps = (adapter: ReturnType<typeof adapterOf>) => ({ project: "p", repos: env.repos, adapter, now: () => NOW, timeoutSec: 0 });
// A chat the owner linked (decision 0049).
const allow = (chatId: string) => linkIdentifier(env.repos, human, { project: "p", clientId: env.clientId, kind: "whatsapp", value: chatId });
const rowsOf = (chatId: string) => env.repos.messengers.messagesOf("p", [{ channel: "whatsapp", chatId }], { limit: 50 });
const count = (table: string) => env.handle.db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number };
const msg = (chatId: string, id: string, text: string, at: string, fromMe = false): WaMessage => ({ id, chatId, fromMe, at: new Date(at), text, kind: "text" });

beforeEach(async () => {
  env = await setup();
  built = 0;
});
afterEach(() => env.close());

describe("whatsapp: receive", () => {
  it("stores a linked chat's messages, both sides, and leaves no trace of an unlinked chat", async () => {
    await allow(ANNA);
    const a = adapterOf();
    await a.start?.();
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const cap = captureOps();
    sock.message(ANNA, "hello from Anna");
    sock.message(ANNA, "my reply", { fromMe: true });
    sock.message(STRANGER, "private life, not for the hub");
    sock.chat(STRANGER, "Stranger Secret Name");
    sock.message(STRANGER, "", { kind: "image" });
    const r = await pollOnce(deps(a));
    expect(r).toMatchObject({ fetched: 2, stored: 2, dropped: [] });
    expect((await rowsOf(ANNA)).map((m) => [m.direction, m.text]).sort()).toEqual([
      ["in", "hello from Anna"],
      ["out", "my reply"],
    ]);
    expect(await rowsOf(STRANGER)).toEqual([]);
    expect(count("messenger_messages").n).toBe(2);
    expect(count("messenger_chats").n).toBe(1);
    expect(count("client_identifiers").n).toBe(1);
    expect(count("clients").n).toBe(1);
    const acc = await env.repos.messengers.account("p", "whatsapp", ACCOUNT);
    expect(JSON.stringify(acc)).not.toMatch(/9999999|Stranger/);
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toMatch(/9999999|Stranger|private life/);
    // P86: nor a line of the ops log.
    expect(JSON.stringify(cap.lines)).not.toMatch(/9999999|Stranger|private life/);
    cap.stop();
    vi.restoreAllMocks();
    await a.close();
  });

  it("keeps what it cannot store out: a reaction or protocol frame (kind null) and the owner's chat with himself", async () => {
    await allow(ANNA);
    await allow(`+${ACCOUNT}`);
    const a = adapterOf();
    await a.start?.();
    sock.message(ANNA, "", { kind: null });
    sock.message(`+${ACCOUNT}`, "a note to myself");
    sock.message(ANNA, "", { kind: "audio" });
    const r = await pollOnce(deps(a));
    expect(r.stored).toBe(1);
    expect((await rowsOf(ANNA))[0]).toMatchObject({ kind: "audio", text: "" });
    await a.close();
  });

  it("the cursor is the newest message time, and a repeated message (the echo of a send) is stored once", async () => {
    await allow(ANNA);
    const a = adapterOf();
    await a.start?.();
    sock.message(ANNA, "one", { id: "A1", at: new Date("2026-11-20T10:00:00.000Z") });
    sock.message(ANNA, "one", { id: "A1", at: new Date("2026-11-20T10:00:00.000Z") });
    const r = await pollOnce(deps(a));
    expect(r).toMatchObject({ stored: 1, duplicates: 1, cursor: String(Date.parse("2026-11-20T10:00:00.000Z") / 1000) });
    await a.close();
  });

  it("logged out (401) parks the account and stops the poller; the park is written for a restart to find", async () => {
    const a = adapterOf();
    const ac = new AbortController();
    const run = runPoller({ ...deps(a), adapter: pollOnly(a), signal: ac.signal, sleep: async () => undefined });
    await vi.waitFor(() => expect(sock?.listening).toBe(true));
    sock.closeWith(401);
    await expect(run).rejects.toMatchObject({ code: "logged_out", parked: true });
    const acc = await env.repos.messengers.account("p", "whatsapp", ACCOUNT);
    expect(parkedOf(acc?.lastError)).toBe("logged_out");
  });

  it("maps the close codes: 403 banned, 440 a conflict that is not parked, 515 and 428 the network's", () => {
    expect(toWaAdapterError(null, 403)).toMatchObject({ code: "banned", parked: true });
    expect(toWaAdapterError(null, 440)).toMatchObject({ code: "conflict", fatal: true, parked: false });
    expect(toWaAdapterError(null, 500)).toMatchObject({ code: "logged_out" });
    expect(toWaAdapterError(null, 428)).toMatchObject({ code: "network", fatal: false });
    expect(toWaAdapterError(new FakeBoom(429))).toMatchObject({ code: "rate_limited" });
    expect(toWaAdapterError(new Error("socket hang up"))).toMatchObject({ code: "network" });
  });

  it("a closed connection is rebuilt by the next poll (Baileys does not reconnect by itself); a 515 restart is not an error", async () => {
    await allow(ANNA);
    const a = adapterOf();
    await a.start?.();
    expect(built).toBe(1);
    sock.closeWith(515);
    expect((await pollOnce(deps(a))).fetched).toBe(0);
    expect(built).toBe(2);
    sock.closeWith(428);
    await expect(pollOnce(deps(a))).rejects.toMatchObject({ code: "network" });
    await pollOnce(deps(a));
    expect(built).toBe(3);
    sock.message(ANNA, "after the reconnect");
    expect((await pollOnce(deps(a))).stored).toBe(1);
    await a.close();
  });

  it("a stored session that asks for a QR code is logged out, and another number's session is refused", async () => {
    const qrFirst = createWhatsAppAdapter({
      socket: () => {
        sock = new FakeWaSocket(new WaAuthFiles(null));
        queueMicrotask(() => sock.qr());
        return sock;
      },
      account: ACCOUNT,
      knownChats: async () => [],
    });
    await expect(qrFirst.start?.()).rejects.toMatchObject({ code: "logged_out" });
    const other = createWhatsAppAdapter({
      socket: () => {
        sock = new FakeWaSocket(new WaAuthFiles(null), { account: "4915100000099", name: "Someone" });
        sock.autoOpen = true;
        return sock;
      },
      account: ACCOUNT,
      knownChats: async () => [],
    });
    await expect(other.start?.()).rejects.toMatchObject({ code: "logged_out" });
  });
});

describe("whatsapp: the picker and the import", () => {
  it("the picker lists the private chats seen, newest first, from memory only", async () => {
    const a = adapterOf();
    await a.start?.();
    sock.chat(ANNA, "Anna");
    sock.history([msg(ANNA, "H1", "old", "2026-11-19T09:00:00.000Z"), msg(STRANGER, "H2", "newer", "2026-11-20T09:00:00.000Z")]);
    expect(await a.dialogs(10)).toEqual([
      { chatId: STRANGER, title: STRANGER, username: null, phone: STRANGER, last: { at: "2026-11-20T09:00:00.000Z", inbound: true } },
      { chatId: ANNA, title: "Anna", username: null, phone: ANNA, last: { at: "2026-11-19T09:00:00.000Z", inbound: true } },
    ]);
    // A history sync of unlinked chats stores nothing.
    expect(count("messenger_messages").n).toBe(0);
    await a.close();
    expect(await a.dialogs(10)).toEqual([]);
  });

  it("link asks the phone for what came before the newest message seen, in milliseconds, and the answer arrives through the poll (P141 W3b)", async () => {
    const a = adapterOf();
    await a.start?.();
    sock.message(ANNA, "the newest, seen before the link", { id: "N1", at: new Date("2026-11-20T11:00:00.000Z") });
    sock.historyAnswer.set(ANNA, [msg(ANNA, "H1", "two weeks ago", "2026-11-06T09:00:00.000Z"), msg(ANNA, "H0", "two months ago", "2026-09-20T09:00:00.000Z", true)]);
    const started = Date.now();
    const r = await linkUserChat({ repos: env.repos, adapter: a, now: () => NOW }, human, { project: "p", clientId: env.clientId, chatId: ANNA, title: "Anna" });
    // The link does not wait for the phone: it answers at once.
    expect(Date.now() - started).toBeLessThan(1000);
    expect(r).toMatchObject({ imported: 0, importError: null });
    expect(sock.historyRequests).toEqual([{ chatId: ANNA, jid: null, anchor: { id: "N1", fromMe: false, at: new Date("2026-11-20T11:00:00.000Z") }, count: 500 }]);
    // The phone's answer is a history batch: the next poll stores what falls in the cache's 30 days, never older history (0049 point 1).
    await new Promise((resolve) => setTimeout(resolve, 0));
    await pollOnce({ ...deps(a), retentionDays: 30 });
    expect((await rowsOf(ANNA)).map((m) => m.text)).toEqual(["two weeks ago"]);
    expect(await env.repos.messengers.identifiersOf("p", env.clientId)).toEqual([expect.objectContaining({ kind: "whatsapp", value: ANNA })]);
    await a.close();
  });

  it("the anchor is the chat's oldest cached message when there is one, and the request names the chat's real (LID) address", async () => {
    await allow(ANNA);
    const a = adapterOf();
    await a.start?.();
    sock.message(ANNA, "newest", { id: "N9", at: new Date("2026-11-20T11:00:00.000Z"), jid: "12345@lid" });
    sock.message(ANNA, "older", { id: "N8", at: new Date("2026-11-19T11:00:00.000Z"), jid: "12345@lid" });
    await pollOnce(deps(a));
    await a.history(ANNA, { since: new Date(0), before: { id: "N8", fromMe: false, at: new Date("2026-11-19T11:00:00.000Z") } });
    expect(sock.historyRequests).toEqual([{ chatId: ANNA, jid: "12345@lid", anchor: { id: "N8", fromMe: false, at: new Date("2026-11-19T11:00:00.000Z") }, count: 500 }]);
    // The real address is kept on the linked chat's row, for the send and a request after a restart.
    expect((await env.repos.messengers.chat("p", "whatsapp", ANNA))?.jid).toBe("12345@lid");
    await a.close();
  });

  it("a late answer still reaches ingest, and an answer that never comes leaves one ops line with no jid", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await allow(ANNA);
      const cap = captureOps();
      const a = adapterOf({ historyMs: 120_000 });
      await a.start?.();
      sock.message(ANNA, "anchor", { id: "N2", at: new Date("2026-11-20T11:00:00.000Z") });
      await a.history(ANNA, { since: new Date(0) });
      // 30 s later the phone answers: the batch is queued and stored by the poll.
      vi.advanceTimersByTime(30_000);
      sock.history([msg(ANNA, "L1", "late but kept", "2026-11-18T09:00:00.000Z")]);
      await pollOnce(deps(a));
      expect((await rowsOf(ANNA)).map((m) => m.text)).toContain("late but kept");
      expect(JSON.stringify(cap.lines)).not.toMatch(/did not answer/);
      // Another request the phone never answers: one line after the window, with no number in it.
      await a.history(ANNA, { since: new Date(0) });
      vi.advanceTimersByTime(120_000);
      expect(JSON.stringify(cap.lines)).toMatch(/did not answer a history request/);
      expect(JSON.stringify(cap.lines)).not.toMatch(/491510000002/);
      cap.stop();
      await a.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a link with no message seen yet imports nothing and stands; nothing is asked of the phone without an anchor", async () => {
    const a = adapterOf();
    await a.start?.();
    expect(await linkUserChat({ repos: env.repos, adapter: a, now: () => NOW }, human, { project: "p", clientId: env.clientId, chatId: ANNA })).toMatchObject({ imported: 0, importError: null });
    expect(sock.historyRequests).toEqual([]);
    expect(await env.repos.messengers.isKnown("p", "whatsapp", ANNA)).toBe(true);
    await a.close();
  });
});

describe("whatsapp: send", () => {
  it("sends only a ConfirmedDraft, to a linked chat, through the socket", async () => {
    await allow(ANNA);
    const a = adapterOf();
    await a.start?.();
    const d = await env.repos.messengers.createDraft({ project: "p", channel: "whatsapp", chatId: ANNA, text: "Hallo Anna", createdBy: "agent" });
    const lookalike = { state: "confirmed", id: d.id, project: "p", channel: "whatsapp", chatId: ANNA, text: "x", confirmedBy: "agent", confirmedAt: "" };
    await expect(a.send(lookalike as never)).rejects.toThrow("not_confirmed");
    await expect(a.send(mintConfirmed({ ...lookalike, chatId: STRANGER } as never))).rejects.toThrow("chat_not_known");
    await confirmDraft(env.repos, await authorized(env.repos, "p", d.id), {});
    const receipt = await sendConfirmed({ repos: env.repos, adapter: a, now: () => NOW }, await authorized(env.repos, "p", d.id));
    expect(sock.sent).toEqual([{ chatId: ANNA, jid: null, text: "Hallo Anna", id: receipt.remoteMessageId }]);
    // WhatsApp echoes the sent message back; it is the same row.
    sock.message(ANNA, "Hallo Anna", { fromMe: true, id: receipt.remoteMessageId, at: new Date(receipt.at) });
    expect((await pollOnce(deps(a))).duplicates).toBe(1);
    expect((await rowsOf(ANNA)).filter((m) => m.direction === "out")).toHaveLength(1);
    await a.close();
  });

  it("the poller's side has no send", async () => {
    const a = adapterOf();
    expect("send" in pollOnly(a)).toBe(false);
    expect(a.send).toBeTypeOf("function");
  });

  it("a refused send maps the code: 401 parks", async () => {
    await allow(ANNA);
    const a = adapterOf();
    await a.start?.();
    sock.sendError = new FakeBoom(401);
    const d = mintConfirmed({ id: 1, project: "p", channel: "whatsapp", chatId: ANNA, text: "x", confirmedBy: "owner", confirmedAt: "" });
    await expect(a.send(d)).rejects.toSatisfy((e: unknown) => e instanceof AdapterError && e.code === "logged_out");
    await a.close();
  });
});

describe("whatsapp: pairing and the auth files", () => {
  it("Connect shows a QR code, the scan writes the auth state at 0600 in a 0700 folder, and nothing is written before the scan", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hub-wa-"));
    const made: FakeWaSocket[] = [];
    const stored: string[] = [];
    const flows = createWaPairing({
      socketFor: (auth) => {
        const s = new FakeWaSocket(auth);
        made.push(s);
        return s;
      },
      store: async (me, auth) => {
        auth.persistTo(waFolderOf(dir, me.account));
        stored.push(me.account);
      },
    });
    const { flow } = await flows.start();
    expect(await flows.state(flow)).toEqual({ step: "waiting" });
    made[0]!.qr();
    const qr = await flows.state(flow);
    expect(qr).toMatchObject({ step: "qr", size: expect.any(Number) });
    expect(JSON.stringify(qr)).not.toMatch(/fake-qr-reference/);
    expect(readdirSync(dir)).toEqual([]);
    made[0]!.scan();
    await vi.waitFor(async () => expect(stored).toEqual([ACCOUNT]));
    expect(await flows.state(flow)).toEqual({ step: "done", account: ACCOUNT, name: "Owner" });
    const folder = waFolderOf(dir, ACCOUNT);
    expect(statSync(folder).mode & 0o777).toBe(0o700);
    const files = readdirSync(folder);
    expect(files).toContain("creds.json");
    for (const f of files) expect(statSync(join(folder, f)).mode & 0o777).toBe(0o600);
    expect(made[0]!.closed).toBe(1);
    const read = readWaAuth(dir, ACCOUNT);
    expect(read.state).toBe("stored");
    // The flow is gone once read.
    await expect(flows.state(flow)).rejects.toMatchObject({ code: "bad_login" });
  });

  it("an expired code (408) fails the flow and writes nothing; a new Connect cancels an older one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hub-wa-"));
    const socks: FakeWaSocket[] = [];
    const flows = createWaPairing({ socketFor: (auth) => (socks.push(new FakeWaSocket(auth)), socks[socks.length - 1]!), store: async () => undefined });
    const first = await flows.start();
    const second = await flows.start();
    expect(socks[0]!.closed).toBe(1);
    await expect(flows.state(first.flow)).rejects.toMatchObject({ code: "bad_login" });
    socks[1]!.closeWith(408);
    expect(await flows.state(second.flow)).toEqual({ step: "failed", reason: expect.stringMatching(/expired/) });
    expect(readdirSync(dir)).toEqual([]);
  });

  it("a folder readable by others is refused; key names with : and @ become safe file names", () => {
    const dir = mkdtempSync(join(tmpdir(), "hub-wa-"));
    const auth = new WaAuthFiles(null);
    auth.set(CREDS, "{}");
    auth.set("session/4915100000002:3@s.whatsapp.net", '"s"');
    auth.persistTo(waFolderOf(dir, ACCOUNT));
    expect(readdirSync(waFolderOf(dir, ACCOUNT)).every((f) => /^[A-Za-z0-9._-]+$/.test(f))).toBe(true);
    expect(new WaAuthFiles(waFolderOf(dir, ACCOUNT)).get("session/4915100000002:3@s.whatsapp.net")).toBe('"s"');
    auth.set("session/4915100000002:3@s.whatsapp.net", null);
    expect(new WaAuthFiles(waFolderOf(dir, ACCOUNT)).get("session/4915100000002:3@s.whatsapp.net")).toBeUndefined();
    chmodSync(join(waFolderOf(dir, ACCOUNT), "creds.json"), 0o644);
    expect(readWaAuth(dir, ACCOUNT).state).toBe("unsafe-mode");
    expect(readWaAuth(dir, "4915100000099").state).toBe("missing");
    expect(existsSync(join(dir, "whatsapp-4915100000099"))).toBe(false);
  });

  it("the QR code is drawn as rows of modules", () => {
    const q = qrRows("2@abc,def,ghi");
    expect(q.rows).toHaveLength(q.size);
    expect(q.rows.every((r) => /^[01]+$/.test(r) && r.length === q.size)).toBe(true);
  });
});

describe("whatsapp: the real Baileys, with no socket", () => {
  it("loads baileys 7 and keeps its creds and keys in the hub's files, Buffers intact", async () => {
    const api = await import("../src/whatsapp-api");
    const dir = mkdtempSync(join(tmpdir(), "hub-wa-real-"));
    const store = new WaAuthFiles(null);
    const state = api.authStateOf(store);
    expect(state.creds.registered).toBe(false);
    await state.keys.set({ "pre-key": { "1": { public: new Uint8Array([1, 2, 3]), private: new Uint8Array([4, 5, 6]) } } });
    store.persistTo(waFolderOf(dir, ACCOUNT));
    const again = api.authStateOf(new WaAuthFiles(waFolderOf(dir, ACCOUNT)));
    expect(Buffer.from(again.creds.noiseKey.public)).toEqual(Buffer.from(state.creds.noiseKey.public));
    const keys = await again.keys.get("pre-key", ["1", "2"]);
    expect(Buffer.from(keys["1"]!.private)).toEqual(Buffer.from([4, 5, 6]));
    expect(keys["2"]).toBeUndefined();
    for (const f of readdirSync(waFolderOf(dir, ACCOUNT))) expect(statSync(join(waFolderOf(dir, ACCOUNT), f)).mode & 0o777).toBe(0o600);
   }, 60_000); // loading Baileys (protobufs, libsignal) takes seconds on a busy machine

  it("maps Baileys messages: a person's text and caption, a LID through its phone alias or as lid:; groups, status and reactions are dropped", async () => {
    const { fromBaileys, chatIdOf } = await import("../src/whatsapp-api");
    const at = 1_763_640_000;
    expect(fromBaileys({ key: { id: "A", remoteJid: "491510000002@s.whatsapp.net", fromMe: false }, message: { conversation: "hi" }, messageTimestamp: at })).toEqual({ id: "A", chatId: ANNA, jid: "491510000002@s.whatsapp.net", fromMe: false, at: new Date(at * 1000), text: "hi", kind: "text" });
    expect(fromBaileys({ key: { id: "B", remoteJid: "491510000002@s.whatsapp.net", fromMe: true }, message: { extendedTextMessage: { text: "linked" } }, messageTimestamp: at })).toMatchObject({ text: "linked", kind: "text", fromMe: true });
    expect(fromBaileys({ key: { id: "C", remoteJid: "491510000002@s.whatsapp.net" }, message: { imageMessage: { caption: "photo" } }, messageTimestamp: at })).toMatchObject({ text: "photo", kind: "image" });
    expect(fromBaileys({ key: { id: "D", remoteJid: "491510000002@s.whatsapp.net" }, message: { reactionMessage: { text: "+" } }, messageTimestamp: at })).toBeNull();
    expect(fromBaileys({ key: { id: "E", remoteJid: "12345@lid", remoteJidAlt: "491510000002@s.whatsapp.net" }, message: { conversation: "via lid" }, messageTimestamp: at })).toMatchObject({ chatId: ANNA, jid: "12345@lid" });
    expect(fromBaileys({ key: { id: "F", remoteJid: "12345@lid" }, message: { conversation: "x" }, messageTimestamp: at })).toMatchObject({ chatId: "lid:12345", jid: "12345@lid" });
    expect(fromBaileys({ key: { id: "G", remoteJid: "1203630000@g.us" }, message: { conversation: "x" }, messageTimestamp: at })).toBeNull();
    expect(fromBaileys({ key: { id: "H", remoteJid: "status@broadcast" }, message: { conversation: "x" }, messageTimestamp: at })).toBeNull();
    expect(chatIdOf("491510000002:3@s.whatsapp.net")).toBe(ANNA);
   }, 60_000);
});

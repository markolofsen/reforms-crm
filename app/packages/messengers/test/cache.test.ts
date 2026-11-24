import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InboundMessage } from "../src/adapter";
import { assessMessenger, type MessengerProjectPolicy } from "../src/door";
import { FakeSendingAdapter } from "../src/fake";
import { FakeWaSocket } from "../src/fake-wa";
import { allowChat, humanActor, linkUserChat } from "../src/human";
import { ingest, type UnlinkedCache } from "../src/ingest";
import { normalizeIdentifier } from "../src/normalize";
import { pollOnce } from "../src/poller";
import { createWhatsAppAdapter } from "../src/whatsapp";
import { WaAuthFiles } from "../src/whatsapp-auth";
import { setup, type Env } from "./helpers";

// P141 W2 and W4 (decision 0049): messages are a 30-day cache. A WhatsApp chat that wrote is cached before it is linked, unless the
// owner hid it; a chat where only the owner wrote is not. "The person wrote" is a fact on the chat row that outlives the cache, so
// the first-contact rule and the door's account hold after a purge.

let env: Env;
const NOW = new Date("2026-11-24T13:05:00.000Z");
const ACCOUNT = "6281300000000";
const QIMMA = "+966500000001";
const HIDDEN = "+491519999999";
const OWNER_ONLY = "+491518888888";
const hiddenSet = new Set([HIDDEN]);
const cache: UnlinkedCache = { channel: "whatsapp", hidden: async (chatId) => hiddenSet.has(chatId) };
const wa = (chatId: string, id: string, at: string, o: Partial<InboundMessage> = {}): InboundMessage => ({ channel: "whatsapp", account: ACCOUNT, chatId, remoteMessageId: id, kind: "text", text: `text ${id}`, sentAt: at, direction: "in", ...o });
const rowsOf = (chatId: string) => env.repos.messengers.messagesOf("p", [{ channel: "whatsapp", chatId }], { limit: 50 });
const count = (table: string) => (env.handle.db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;

beforeEach(async () => {
  env = await setup();
});
afterEach(() => env.close());

describe("the cache on arrival (P141 W2)", () => {
  it("a message of an unknown chat is cached with retain_until 30 days out, and makes no chat row (P141 U2 makes it)", async () => {
    const r = await ingest({ project: "p", repos: env.repos, now: () => NOW, retentionDays: 30, cache }, [wa(QIMMA, "Q1", "2026-11-24T13:01:16.000Z")]);
    expect(r).toMatchObject({ stored: 1, dropped: [], chats: [{ channel: "whatsapp", chatId: QIMMA, inbound: 1, outbound: 0, linked: false }] });
    expect((await rowsOf(QIMMA)).map((m) => [m.remoteMessageId, m.retainUntil])).toEqual([["Q1", "2026-12-24T13:05:00.000Z"]]);
    expect(count("messenger_chats")).toBe(0);
  });

  it("a hidden chat's message leaves no row", async () => {
    const r = await ingest({ project: "p", repos: env.repos, now: () => NOW, retentionDays: 30, cache }, [wa(HIDDEN, "H1", "2026-11-24T13:00:00.000Z")]);
    expect(r).toMatchObject({ stored: 0, dropped: [{ channel: "whatsapp", chatId: HIDDEN, count: 1 }] });
    expect(count("messenger_messages")).toBe(0);
  });

  it("a chat where only the owner wrote leaves no row; once the person answers, both sides are cached", async () => {
    const mine = wa(OWNER_ONLY, "O1", "2026-11-24T12:00:00.000Z", { direction: "out" });
    expect((await ingest({ project: "p", repos: env.repos, now: () => NOW, cache }, [mine])).stored).toBe(0);
    expect(count("messenger_messages")).toBe(0);
    const r = await ingest({ project: "p", repos: env.repos, now: () => NOW, cache }, [mine, wa(OWNER_ONLY, "O2", "2026-11-24T12:30:00.000Z")]);
    expect(r.stored).toBe(2);
    // A later message of ours in that chat is kept: the person wrote before.
    expect((await ingest({ project: "p", repos: env.repos, now: () => NOW, cache }, [wa(OWNER_ONLY, "O3", "2026-11-24T12:40:00.000Z", { direction: "out" })])).stored).toBe(1);
  });

  it("without a cache, or on another channel, an unknown chat is dropped as before", async () => {
    expect((await ingest({ project: "p", repos: env.repos, now: () => NOW }, [wa(QIMMA, "Q1", "2026-11-24T13:01:16.000Z")])).dropped).toHaveLength(1);
    expect((await ingest({ project: "p", repos: env.repos, now: () => NOW, cache }, [{ ...wa("42", "T1", "2026-11-24T13:01:16.000Z"), channel: "telegram_user" }])).dropped).toHaveLength(1);
    expect(count("messenger_messages")).toBe(0);
  });

  it("a history row older than the cache's window is not cached; history and the app's rows wake nothing", async () => {
    const r = await ingest({ project: "p", repos: env.repos, now: () => NOW, retentionDays: 30, cache }, [wa(QIMMA, "OLD", "2026-10-01T10:00:00.000Z", { backfill: true }), wa(QIMMA, "B1", "2026-11-20T10:00:00.000Z", { backfill: true }), wa(QIMMA, "A1", "2026-11-21T10:00:00.000Z", { source: "wa_app" })]);
    expect(r).toMatchObject({ stored: 2, chats: [] });
  });

  it("an edit replaces the stored text and stores nothing new", async () => {
    await ingest({ project: "p", repos: env.repos, now: () => NOW, cache }, [wa(QIMMA, "Q1", "2026-11-24T13:01:16.000Z")]);
    const r = await ingest({ project: "p", repos: env.repos, now: () => NOW, cache }, [wa(QIMMA, "E1", "2026-11-24T13:02:00.000Z", { text: "corrected", editOf: "Q1" })]);
    expect(r).toMatchObject({ stored: 0, edited: 1 });
    expect((await rowsOf(QIMMA)).map((m) => [m.remoteMessageId, m.text])).toEqual([["Q1", "corrected"]]);
  });

  it("the adapter with the cache hands every private chat to ingest; the poll caches a stranger who wrote", async () => {
    let sock!: FakeWaSocket;
    const a = createWhatsAppAdapter({
      socket: () => ((sock = new FakeWaSocket(new WaAuthFiles(null), { account: ACCOUNT, name: "Owner" })), (sock.autoOpen = true), sock),
      account: ACCOUNT,
      allowedChats: async () => [],
      cacheUnlinked: true,
      cacheDays: 30,
    });
    await a.start?.();
    sock.message(QIMMA, "Hello team", { id: "Q1", at: new Date("2026-11-24T13:01:16.000Z"), jid: "111122223333444@lid", pushName: "Example Auctions" });
    const r = await pollOnce({ project: "p", repos: env.repos, adapter: a, now: () => NOW, timeoutSec: 0, retentionDays: 30, cache });
    expect(r.stored).toBe(1);
    expect((await a.dialogs(5))[0]).toMatchObject({ chatId: QIMMA, title: "Example Auctions", phone: QIMMA });
    await a.close();
  });

  it("Hide deletes what the cache holds of an unlinked chat, and never a linked chat's", async () => {
    await ingest({ project: "p", repos: env.repos, now: () => NOW, cache }, [wa(QIMMA, "Q1", "2026-11-24T13:01:16.000Z")]);
    expect(await env.repos.messengers.dropCachedChat("p", "whatsapp", QIMMA)).toBe(1);
    await allowChat(env.repos, humanActor("owner"), { project: "p", channel: "whatsapp", chatId: QIMMA });
    await ingest({ project: "p", repos: env.repos, now: () => NOW, cache }, [wa(QIMMA, "Q2", "2026-11-24T13:02:00.000Z")]);
    expect(await env.repos.messengers.dropCachedChat("p", "whatsapp", QIMMA)).toBe(0);
    expect(await rowsOf(QIMMA)).toHaveLength(1);
  });

  it("a hidden number's chat is named lid:<digits> and can be linked by it", () => {
    expect(normalizeIdentifier("whatsapp", "lid:555566667777888")).toBe("lid:555566667777888");
    expect(() => normalizeIdentifier("phone", "lid:555566667777888")).toThrow("bad_identifier");
  });
});

describe("first contact is a stored fact that outlives the cache (P141 W4)", () => {
  const open: MessengerProjectPolicy = { lifecycle: null, generation: "g1", recipients: () => null };
  const doorDeps = () => ({ repos: env.repos, policy: () => open, senders: { sender: () => new FakeSendingAdapter() }, now: () => NOW });
  const reasons = async (draftId: number) => (await assessMessenger(doorDeps(), "p", draftId))?.reasons ?? [];

  it("chat 4's shape: the person wrote before the link; the link adopts the cache, so a draft is allowed and the door has no reason", async () => {
    await ingest({ project: "p", repos: env.repos, now: () => NOW, retentionDays: 30, cache }, [wa(QIMMA, "Q1", "2026-11-24T13:01:16.000Z")]);
    let sock!: FakeWaSocket;
    const a = createWhatsAppAdapter({ socket: () => ((sock = new FakeWaSocket(new WaAuthFiles(null), { account: ACCOUNT, name: "Owner" })), (sock.autoOpen = true), sock), account: ACCOUNT, allowedChats: async () => [], cacheUnlinked: true, cacheDays: 30 });
    await a.start?.();
    await linkUserChat({ repos: env.repos, adapter: a, now: () => NOW }, humanActor("owner"), { project: "p", clientId: env.clientId, chatId: QIMMA, title: QIMMA });
    const row = await env.repos.messengers.chat("p", "whatsapp", QIMMA);
    expect(row).toMatchObject({ lastInboundAt: "2026-11-24T13:01:16.000Z", account: ACCOUNT });
    // The import asked the phone for what came before the oldest cached message.
    expect(sock.historyRequests.map((h) => h.anchor.id)).toEqual(["Q1"]);
    expect((await env.repos.messengers.activity("p", "whatsapp", QIMMA)).lastInAt).toBe("2026-11-24T13:01:16.000Z");
    const d = await env.repos.messengers.createDraft({ project: "p", channel: "whatsapp", chatId: QIMMA, text: "Thank you", createdBy: "owner" });
    expect(await reasons(d.id)).toEqual([]);
    await a.close();
  });

  it("an inbound message pruned after 30 days: last_inbound_at and account still let the draft and the send pass", async () => {
    await env.repos.messengers.allowChat("p", "whatsapp", QIMMA, QIMMA);
    await ingest({ project: "p", repos: env.repos, now: () => NOW, retentionDays: 30, cache }, [wa(QIMMA, "Q1", "2026-11-24T13:01:16.000Z")]);
    expect(await env.repos.messengers.purgeExpired("2026-12-30T00:00:00.000Z")).toBe(1);
    expect(await rowsOf(QIMMA)).toEqual([]);
    const activity = await env.repos.messengers.activity("p", "whatsapp", QIMMA);
    expect(activity).toEqual({ inbound: 0, lastInAt: "2026-11-24T13:01:16.000Z", lastOutAt: null });
    const d = await env.repos.messengers.createDraft({ project: "p", channel: "whatsapp", chatId: QIMMA, text: "Still there?", createdBy: "owner" });
    expect(await reasons(d.id)).toEqual([]);
    expect((await assessMessenger(doorDeps(), "p", d.id))?.preview).toMatchObject({ account: ACCOUNT });
  });

  it("zero rows and no fact: the door says first contact", async () => {
    await env.repos.messengers.allowChat("p", "whatsapp", QIMMA, QIMMA);
    expect((await env.repos.messengers.activity("p", "whatsapp", QIMMA)).lastInAt).toBeNull();
    const d = await env.repos.messengers.createDraft({ project: "p", channel: "whatsapp", chatId: QIMMA, text: "Hello", createdBy: "owner" });
    expect(await reasons(d.id)).toContain("nobody wrote in this chat yet: the hub never makes the first contact");
  });
});

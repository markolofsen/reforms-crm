import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdapterError } from "../src/adapter";
import { FakeAdapter } from "../src/fake";
import { ingest } from "../src/ingest";
import { backoffMs, pollOnce, redact, runPoller, type PollEvent } from "../src/poller";
import { linkIdentifier, allowChat, humanActor } from "../src/human";
import { setup, type Env } from "./helpers";

let env: Env;
let adapter: FakeAdapter;
const human = humanActor("owner");
const NOW = new Date("2026-11-14T12:00:00.000Z");

beforeEach(async () => {
  env = await setup();
  adapter = new FakeAdapter();
});
afterEach(() => env.close());

const deps = () => ({ project: "p", repos: env.repos, adapter, now: () => NOW });
const stored = () => env.repos.messengers.messagesOf("p", [{ channel: "telegram_bot", chatId: "100" }], { limit: 50 });

describe("allow-list inbound", () => {
  it("stores only listed chats and reports the others without storing them", async () => {
    await allowChat(env.repos, human, { project: "p", channel: "telegram_bot", chatId: "100" });
    adapter.push({ chatId: "100", remoteMessageId: "1", text: "from a listed chat" });
    adapter.push({ chatId: "555", chatTitle: "Stranger", remoteMessageId: "2", text: "from nobody" });
    adapter.push({ chatId: "555", remoteMessageId: "3", text: "again" });
    const r = await pollOnce(deps());
    expect(r).toMatchObject({ fetched: 3, stored: 1, duplicates: 0 });
    expect(r.dropped).toEqual([{ channel: "telegram_bot", chatId: "555", title: "Stranger", count: 2 }]);
    expect((await stored()).map((m) => m.text)).toEqual(["from a listed chat"]);
    expect(await env.repos.messengers.messagesOf("p", [{ channel: "telegram_bot", chatId: "555" }], { limit: 5 })).toEqual([]);
  });

  it("never creates a client link on its own", async () => {
    await allowChat(env.repos, human, { project: "p", channel: "telegram_bot", chatId: "100" });
    adapter.push({ chatId: "100", chatTitle: "Anna", remoteMessageId: "1", text: "hi, I am anna@example.test" });
    await pollOnce(deps());
    expect(await env.repos.messengers.identifiersOf("p", env.clientId)).toEqual([]);
    expect(await env.repos.messengers.clientByIdentifier("p", "telegram", "100")).toBeNull();
  });

  it("marks every row with a 90-day retention and keeps the text", async () => {
    await allowChat(env.repos, human, { project: "p", channel: "telegram_bot", chatId: "100" });
    adapter.push({ chatId: "100", remoteMessageId: "1", text: "full text kept locally" });
    await pollOnce(deps());
    const [m] = await stored();
    expect(m).toMatchObject({ text: "full text kept locally", direction: "in", project: "p" });
    expect(m?.retainUntil).toBe("2027-02-12T12:00:00.000Z");
  });

  it("is idempotent on the remote id", async () => {
    await allowChat(env.repos, human, { project: "p", channel: "telegram_bot", chatId: "100" });
    const m = { channel: "telegram_bot" as const, account: "fake-bot", chatId: "100", remoteMessageId: "1", kind: "text", text: "x", sentAt: NOW.toISOString() };
    expect(await ingest({ project: "p", repos: env.repos, now: () => NOW }, [m, m])).toMatchObject({ stored: 1, duplicates: 1 });
  });
});

describe("offset persistence", () => {
  it("resumes from the stored cursor and does not re-deliver", async () => {
    await allowChat(env.repos, human, { project: "p", channel: "telegram_bot", chatId: "100" });
    adapter.push({ chatId: "100", remoteMessageId: "1", text: "one" });
    adapter.push({ chatId: "100", remoteMessageId: "2", text: "two" });
    await pollOnce(deps());
    adapter.push({ chatId: "100", remoteMessageId: "3", text: "three" });
    const second = await pollOnce(deps());
    expect(adapter.polls).toEqual([null, "2"]); // second poll started from the saved position
    expect(second.fetched).toBe(1);
    expect((await env.repos.messengers.account("p", "telegram_bot", "fake-bot"))?.cursor).toBe("3");
  });

  it("keeps the position when a poll fails, and survives a restart (new adapter, same database)", async () => {
    await allowChat(env.repos, human, { project: "p", channel: "telegram_bot", chatId: "100" });
    adapter.push({ chatId: "100", remoteMessageId: "1", text: "one" });
    await pollOnce(deps());
    adapter.failures.push(new AdapterError("network", "down"));
    await expect(pollOnce(deps())).rejects.toThrow("down");
    const acc = await env.repos.messengers.account("p", "telegram_bot", "fake-bot");
    expect(acc).toMatchObject({ cursor: "1", lastError: "down" });
    const restarted = new FakeAdapter();
    await pollOnce({ ...deps(), adapter: restarted });
    expect(restarted.polls).toEqual(["1"]);
  });

  it("does not move the position when storing fails (a crash re-delivers, dedupe absorbs it)", async () => {
    await allowChat(env.repos, human, { project: "p", channel: "telegram_bot", chatId: "100" });
    adapter.push({ chatId: "100", remoteMessageId: "1", text: "one" });
    const broken = { ...env.repos, messengers: { ...env.repos.messengers, insertMessage: async () => { throw new Error("disk full"); } } };
    await expect(pollOnce({ ...deps(), repos: broken as typeof env.repos })).rejects.toThrow("disk full");
    expect((await env.repos.messengers.account("p", "telegram_bot", "fake-bot"))?.cursor ?? null).toBeNull();
    await pollOnce(deps()); // re-delivered from the unmoved position
    expect(await stored()).toHaveLength(1);
  });

  it("refuses an unregistered project", async () => {
    await expect(pollOnce({ ...deps(), project: "nope" })).rejects.toMatchObject({ code: "unknown_project" });
  });
});

describe("runPoller", () => {
  const run = async (opts: { until: (ev: PollEvent[]) => boolean; sleeps?: number[] }) => {
    const ac = new AbortController();
    const events: PollEvent[] = [];
    const sleeps = opts.sleeps ?? [];
    await runPoller({
      ...deps(),
      signal: ac.signal,
      random: () => 0.5, // jitter factor 1.0
      sleep: async (ms) => void sleeps.push(ms),
      onEvent: (e) => {
        events.push(e);
        if (opts.until(events)) ac.abort();
      },
    });
    return { events, sleeps };
  };

  it("starts the adapter once, then polls", async () => {
    await allowChat(env.repos, human, { project: "p", channel: "telegram_bot", chatId: "100" });
    adapter.push({ chatId: "100", remoteMessageId: "1", text: "one" });
    const { events } = await run({ until: (ev) => ev.filter((e) => e.type === "poll").length >= 3 });
    expect(adapter.started).toBe(1);
    expect(events.filter((e) => e.type === "poll")).toHaveLength(3);
  });

  it("backs off exponentially on errors and resets after a success", async () => {
    for (let i = 0; i < 4; i++) adapter.failures.push(new AdapterError("network", "down"));
    const { sleeps } = await run({ until: (ev) => ev.some((e) => e.type === "poll") });
    expect(sleeps).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffMs(20, () => 0.5)).toBe(60_000); // capped
    expect(backoffMs(1, () => 0)).toBe(800); // jitter lower bound
  });

  it("obeys a provider's retry_after over its own schedule", async () => {
    adapter.failures.push(new AdapterError("rate_limited", "slow down", 17_000));
    const { sleeps } = await run({ until: (ev) => ev.some((e) => e.type === "poll") });
    expect(sleeps).toEqual([17_000]);
  });

  it("stops and throws on unauthorized or conflict instead of retrying", async () => {
    adapter.failures.push(new AdapterError("conflict", "another consumer"));
    await expect(runPoller({ ...deps(), sleep: async () => {} })).rejects.toMatchObject({ code: "conflict" });
    expect(adapter.polls).toHaveLength(1);
    expect((await env.repos.messengers.account("p", "telegram_bot", "fake-bot"))?.lastError).toContain("another consumer");
  });

  it("purges expired messages at start", async () => {
    await env.repos.messengers.insertMessage({ project: "p", channel: "telegram_bot", account: "a", chatId: "100", remoteMessageId: "old", direction: "in", kind: "text", text: "x", sentAt: "2026-01-01T00:00:00.000Z", retainUntil: "2026-04-01T00:00:00.000Z" });
    const { events } = await run({ until: (ev) => ev.some((e) => e.type === "poll") });
    expect(events[0]).toEqual({ type: "purged", count: 1 });
  });
});

describe("secrets", () => {
  it("redacts anything token-shaped", () => {
    expect(redact("failed for 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw9 now")).toBe("failed for [token] now");
  });
});

describe("linking is the owner's act", () => {
  it("link lists the chat so its messages are stored", async () => {
    const r = await linkIdentifier(env.repos, human, { project: "p", clientId: env.clientId, kind: "telegram", value: "100", title: "Anna" });
    expect(r.allowedChannel).toBe("telegram_bot");
    adapter.push({ chatId: "100", remoteMessageId: "1", text: "hello" });
    expect((await pollOnce(deps())).stored).toBe(1);
  });
});

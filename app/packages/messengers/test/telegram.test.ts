import { describe, expect, it } from "vitest";
import { AdapterError } from "../src/adapter";
import { mintConfirmed } from "../src/confirmed";
import { createTelegramAdapter, toAdapterError, toInbound, type TelegramApi, type TgUpdate } from "../src/telegram";
import { botIdOf, readBotToken } from "../src/token";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

class FakeApi implements TelegramApi {
  calls: string[] = [];
  updates: TgUpdate[] = [];
  getUpdatesArgs: unknown[] = [];
  meId = 123456789;
  sendError: unknown = null;
  async getMe() { this.calls.push("getMe"); return { id: this.meId }; }
  async deleteWebhook() { this.calls.push("deleteWebhook"); return true; }
  async getUpdates(o: object) { this.calls.push("getUpdates"); this.getUpdatesArgs.push(o); return this.updates; }
  async sendMessage(chat: number | string, text: string) {
    this.calls.push(`sendMessage:${chat}:${text}`);
    if (this.sendError) throw this.sendError;
    return { message_id: 77, date: 1_794_000_000 };
  }
}

const msg = (id: number, over: Record<string, unknown> = {}) => ({ message_id: id, date: 1_794_000_000, chat: { id: 100, type: "private", first_name: "Anna", last_name: "Fake" }, text: `m${id}`, ...over });
const make = () => { const api = new FakeApi(); return { api, adapter: createTelegramAdapter({ api, botId: "123456789" }) }; };
const poll = (adapter: ReturnType<typeof make>["adapter"], cursor: string | null = null) => adapter.poll({ cursor, timeoutSec: 30, limit: 100 });

describe("telegram adapter", () => {
  it("start verifies the token and removes a webhook, so polling can work", async () => {
    const { api, adapter } = make();
    await adapter.start!();
    expect(api.calls).toEqual(["getMe", "deleteWebhook"]);
  });

  it("asks only for messages and advances the offset past every update", async () => {
    const { api, adapter } = make();
    api.updates = [
      { update_id: 10, message: msg(1) },
      { update_id: 11, message: msg(2, { text: undefined, new_chat_title: "x" }) }, // service message: nothing to store
      { update_id: 12, message: msg(3, { text: undefined, photo: [{}], caption: "look" }) },
    ];
    const b = await poll(adapter, "5");
    expect(api.getUpdatesArgs[0]).toMatchObject({ offset: 5, limit: 100, timeout: 30, allowed_updates: ["message"] });
    expect(b.cursor).toBe("13");
    expect(b.messages.map((m) => [m.remoteMessageId, m.kind, m.text])).toEqual([["1", "text", "m1"], ["3", "photo", "look"]]);
    expect(b.messages[0]).toMatchObject({ channel: "telegram_bot", account: "123456789", chatId: "100", chatTitle: "Anna Fake", sentAt: new Date(1_794_000_000 * 1000).toISOString() });
  });

  it("keeps the cursor when nothing arrived", async () => {
    const { adapter } = make();
    expect((await poll(adapter, "9")).cursor).toBe("9");
    expect((await poll(adapter, null)).cursor).toBeNull();
  });

  it("maps provider errors; 401 and 409 are fatal, 429 carries retry_after", () => {
    expect(toAdapterError({ error_code: 401, description: "Unauthorized" })).toMatchObject({ code: "unauthorized", fatal: true });
    expect(toAdapterError({ error_code: 409, description: "Conflict: terminated by other getUpdates request" })).toMatchObject({ code: "conflict", fatal: true });
    expect(toAdapterError({ error_code: 429, description: "Too Many Requests", parameters: { retry_after: 7 } })).toMatchObject({ code: "rate_limited", retryAfterMs: 7000, fatal: false });
    expect(toAdapterError({ name: "HttpError", message: "Network request failed" })).toMatchObject({ code: "network" });
    expect(toAdapterError(new Error("boom"))).toBeInstanceOf(AdapterError);
  });

  it("never lets a token reach an error message", () => {
    const e = toAdapterError({ name: "HttpError", message: "fetch https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw9/getUpdates failed" });
    expect(e.message).not.toContain("AAHdq");
  });

  it("send takes only a ConfirmedDraft", async () => {
    const { api, adapter } = make();
    const forged = { state: "confirmed", id: 1, project: "p", channel: "telegram_bot", chatId: "100", text: "hi", confirmedBy: "x", confirmedAt: "" } as never;
    await expect(adapter.send(forged)).rejects.toThrow("not_confirmed");
    expect(api.calls.some((c) => c.startsWith("sendMessage"))).toBe(false);
    const ok = mintConfirmed({ id: 1, project: "p", channel: "telegram_bot", chatId: "100", text: "hi", confirmedBy: "owner", confirmedAt: "t" });
    expect(await adapter.send(ok)).toMatchObject({ remoteMessageId: "77" });
    expect(api.calls).toContain("sendMessage:100:hi");
  });
});

describe("toInbound", () => {
  it("skips a message with neither text nor a known media type", () => {
    expect(toInbound(msg(1, { text: undefined }), "1")).toBeNull();
  });
});

describe("bot token file", () => {
  const file = (content?: string) => {
    const dir = mkdtempSync(join(tmpdir(), "tok-"));
    const f = join(dir, "telegram-bot-token");
    if (content !== undefined) writeFileSync(f, content, { mode: 0o600 });
    return f;
  };
  const token = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw9";

  it("reads and trims", async () => {
    expect(await readBotToken(file(`${token}\n`))).toBe(token);
    expect(botIdOf(token)).toBe("123456789");
  });
  it("explains a missing file without a value", async () => {
    await expect(readBotToken(file())).rejects.toMatchObject({ code: "no_token", message: expect.stringContaining("BotFather") });
  });
  it("rejects a file that is not a token, and does not echo it", async () => {
    const err = await readBotToken(file("hunter2-not-a-token")).catch((e: Error) => e);
    expect(err).toMatchObject({ code: "no_token" });
    expect((err as Error).message).not.toContain("hunter2");
  });
});

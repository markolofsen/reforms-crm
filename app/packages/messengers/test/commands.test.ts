import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pollCommand, pollLine, statusLines } from "../src/commands";
import { FakeAdapter } from "../src/fake";
import { allowChat, humanActor } from "../src/human";
import { pollOnce } from "../src/poller";
import { setup, type Env } from "./helpers";

let env: Env;
beforeEach(async () => {
  env = await setup();
});
afterEach(() => env.close());

describe("status", () => {
  it("says so before anything was polled", async () => {
    const lines = await statusLines(env.repos, "p");
    expect(lines).toContain("accounts: none polled yet");
    expect(lines.join("\n")).toContain("never (copy + open chat)");
  });

  it("flags a stale poll and shows the last error", async () => {
    await env.repos.messengers.markPollOk("p", "telegram_bot", "1", "5", "2026-11-14T10:00:00.000Z");
    await env.repos.messengers.markPollError("p", "telegram_bot", "1", "telegram 409", "2026-11-14T11:55:00.000Z");
    const lines = (await statusLines(env.repos, "p", new Date("2026-11-14T12:00:00.000Z"))).join("\n");
    expect(lines).toContain("STALE");
    expect(lines).toContain("telegram 409");
  });

  it("refuses an unknown project", async () => {
    await expect(statusLines(env.repos, "nope")).rejects.toMatchObject({ code: "unknown_project" });
  });
});

describe("poll --once", () => {
  it("starts the adapter, polls one batch and prints the dropped chat ids", async () => {
    await allowChat(env.repos, humanActor("owner"), { project: "p", channel: "telegram_bot", chatId: "100" });
    const adapter = new FakeAdapter();
    adapter.push({ chatId: "100", remoteMessageId: "1", text: "ok" });
    adapter.push({ chatId: "999", chatTitle: "Stranger", remoteMessageId: "2", text: "no" });
    const log: string[] = [];
    await pollCommand({ repos: env.repos, project: "p", adapter, once: true, log: (l) => log.push(l) });
    expect(adapter.started).toBe(1);
    expect(log).toEqual(["poll: fetched 2, stored 1, duplicate 0; dropped 1 from unlisted telegram_bot chat 999 (Stranger)"]);
    expect(await pollOnce({ project: "p", repos: env.repos, adapter })).toMatchObject({ fetched: 0 });
  });

  it("pollLine words an error with its retry delay", () => {
    expect(pollLine({ type: "error", error: new Error("down"), failures: 2, retryInMs: 2000 })).toBe("poll error (2): down; retry in 2 s");
  });
});

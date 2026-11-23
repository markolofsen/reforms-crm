import { afterEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle } from "@hub/db";
import { startMessengers } from "../../src/messengers/bot";
import { startPurge } from "../../src/messengers/purge";

// P71 M2b (research 26 gap 2): the retention purge runs when the server starts, with no channel connected.

let handle: DbHandle | undefined;
afterEach(() => handle?.close());

const row = (remote: string, retainUntil: string) => ({ project: "a", channel: "telegram_user" as const, account: "1", chatId: "42", remoteMessageId: remote, direction: "in" as const, kind: "text", text: "hi", sentAt: "2026-08-01T00:00:00.000Z", retainUntil });

describe("startPurge", () => {
  it("purges expired rows at start with no bot token and no user account, and keeps the rest", async () => {
    handle = openDb(":memory:");
    const repos = createRepos(handle.db);
    await repos.messengers.insertMessage(row("1", "2026-11-01T00:00:00.000Z"));
    await repos.messengers.insertMessage(row("2", "2027-02-01T00:00:00.000Z"));
    const messengers = await startMessengers({ repos, env: { HUB_MESSENGERS: "off" } });
    expect(messengers.status().state).toBe("off");
    const lines: string[] = [];
    const p = startPurge({ repos, now: () => new Date("2026-11-20T00:00:00Z"), log: (l) => lines.push(l) });
    expect(await p.first).toBe(1);
    p.stop();
    expect((await repos.messengers.messageCounts("a"))[0]?.n).toBe(1);
    expect(lines).toEqual(["messengers: purged 1 message(s) past retention"]);
  });

  it("a failing purge is a log line, not a crash of the server", async () => {
    handle = openDb(":memory:");
    const repos = createRepos(handle.db);
    handle.close();
    handle = undefined;
    const lines: string[] = [];
    const p = startPurge({ repos, log: (l) => lines.push(l) });
    expect(await p.first).toBe(0);
    p.stop();
    expect(lines[0]).toMatch(/retention purge failed/);
  });
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollOnly } from "../src/adapter";
import { FakeWaSocket } from "../src/fake-wa";
import { createWaPairing } from "../src/human";
import { runPoller } from "../src/poller";
import { createWhatsAppAdapter } from "../src/whatsapp";
import { CREDS, readWaAuth, WaAuthFiles, waFolderOf } from "../src/whatsapp-auth";
import { disconnectDetail, logLine, redactWa, waLogger } from "../src/whatsapp-log";
import { setup, type Env } from "./helpers";

// P71 M5 fix (2026-11-20): the linked device was logged out (401) minutes after each pairing. On a FAKE socket only: nothing here
// opens a WebSocket, shows a real QR code or reaches WhatsApp.

const ACCOUNT = "4915100000001";
let env: Env;
beforeEach(async () => {
  env = await setup();
});
afterEach(() => env.close());

describe("whatsapp pairing: the socket lives until WhatsApp's 515", () => {
  it("the device's signature goes out, the store waits for the 515, and the account's socket opens over the same creds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hub-wa-"));
    const made: FakeWaSocket[] = [];
    let pairedCreds: string | undefined;
    const flows = createWaPairing({
      socketFor: (auth) => (made.push(new FakeWaSocket(auth)), made[made.length - 1]!),
      store: async (me, auth) => {
        pairedCreds = auth.get(CREDS);
        auth.persistTo(waFolderOf(dir, me.account));
      },
    });
    const { flow } = await flows.start();
    made[0]!.qr();
    made[0]!.scan();
    // Before the fix the flow closed the socket on `paired`, and the signature never left.
    expect(made[0]!.pairSigned).toBe(true);
    await vi.waitFor(async () => expect(await flows.state(flow)).toEqual({ step: "done", account: ACCOUNT, name: "Owner" }));
    expect(pairedCreds).toMatch(/"signed":true/);
    expect(made[0]!.closed).toBe(1);

    // The account's own socket reads exactly the creds the pairing ended with, and a later 515 reuses the same store.
    const read = readWaAuth(dir, ACCOUNT);
    if (read.state !== "stored") throw new Error(read.state);
    const stores: WaAuthFiles[] = [];
    const socks: FakeWaSocket[] = [];
    const a = createWhatsAppAdapter({
      socket: () => {
        stores.push(read.auth);
        socks.push(new FakeWaSocket(read.auth));
        return socks[socks.length - 1]!;
      },
      account: ACCOUNT,
      allowedChats: async () => [],
    });
    await a.start?.();
    expect(read.auth.get(CREDS)).toBe(pairedCreds);
    socks[0]!.closeWith(515);
    await a.poll({ timeoutSec: 0, limit: 10, cursor: null });
    expect(socks).toHaveLength(2);
    expect(stores[1]).toBe(stores[0]);
    expect(read.auth.get(CREDS)).toBe(pairedCreds);
    await a.close();
  });

  it("a 515 with no scan before it stores nothing", async () => {
    const made: FakeWaSocket[] = [];
    const stored: string[] = [];
    const flows = createWaPairing({ socketFor: (auth) => (made.push(new FakeWaSocket(auth)), made[made.length - 1]!), store: async (me) => void stored.push(me.account) });
    const { flow } = await flows.start();
    made[0]!.closeWith(515);
    expect(await flows.state(flow)).toEqual({ step: "waiting" });
    expect(stored).toEqual([]);
    expect(made[0]!.closed).toBe(0);
    await flows.closeAll();
  });
});

describe("whatsapp: one socket at a time", () => {
  it("a poll and an import that both find no socket share one connect", async () => {
    const socks: FakeWaSocket[] = [];
    const auth = new WaAuthFiles(null);
    auth.set(CREDS, "{}");
    const a = createWhatsAppAdapter({
      socket: () => {
        const s = new FakeWaSocket(auth);
        // Opens only when the test says so, so both callers wait on the same connect.
        s.autoOpen = false;
        socks.push(s);
        return s;
      },
      account: ACCOUNT,
      allowedChats: async () => [],
    });
    const first = a.start?.();
    const second = a.start?.();
    const third = a.poll({ timeoutSec: 0, limit: 10, cursor: null });
    await vi.waitFor(() => expect(socks).toHaveLength(1));
    socks[0]!.open();
    await Promise.all([first, second, third]);
    expect(socks).toHaveLength(1);
    await a.close();
  });

  it("the close of a socket already replaced does not fail the live one", async () => {
    const socks: FakeWaSocket[] = [];
    const auth = new WaAuthFiles(null);
    auth.set(CREDS, "{}");
    const a = createWhatsAppAdapter({ socket: () => (socks.push(new FakeWaSocket(auth)), socks[socks.length - 1]!), account: ACCOUNT, allowedChats: async () => [] });
    await a.start?.();
    const old = socks[0]!;
    // Keep the old socket's listener (a real Baileys socket can report its close late).
    const events = Reflect.get(old, "events") as unknown;
    old.closeWith(428);
    await expect(a.poll({ timeoutSec: 0, limit: 10, cursor: null })).rejects.toMatchObject({ code: "network" });
    await a.poll({ timeoutSec: 0, limit: 10, cursor: null });
    expect(socks).toHaveLength(2);
    Reflect.set(old, "events", events);
    old.closeWith(401);
    await expect(a.poll({ timeoutSec: 0, limit: 10, cursor: null })).resolves.toMatchObject({ messages: [] });
    await a.close();
  });
});

describe("whatsapp: why a socket closed", () => {
  it("the stream error's node reaches last_error with the park: the next 401 says why", async () => {
    let sock: FakeWaSocket | null = null;
    const a = createWhatsAppAdapter({
      socket: () => {
        sock = new FakeWaSocket(new WaAuthFiles(null));
        sock.autoOpen = true;
        return sock;
      },
      account: ACCOUNT,
      allowedChats: async () => [],
    });
    const ac = new AbortController();
    const run = runPoller({ project: "p", repos: env.repos, adapter: pollOnly(a), signal: ac.signal, timeoutSec: 0, sleep: async () => undefined });
    await vi.waitFor(() => expect((sock as FakeWaSocket | null)?.listening).toBe(true));
    const reason = disconnectDetail({ message: "Stream Errored (conflict)", output: { statusCode: 401 }, data: { tag: "conflict", attrs: { type: "device_removed" } } });
    expect(reason).toBe("Stream Errored (conflict): conflict type=device_removed");
    (sock as unknown as FakeWaSocket).closeWith(401, reason);
    await expect(run).rejects.toMatchObject({ code: "logged_out", parked: true });
    const acc = await env.repos.messengers.account("p", "whatsapp", ACCOUNT);
    expect(acc?.lastError).toMatch(/^parked logged_out: whatsapp 401: .*\[Stream Errored \(conflict\): conflict type=device_removed\]$/);
  });

  it("a failure node's attributes and a stream error's children are kept; jids, numbers and keys are not", () => {
    expect(disconnectDetail({ message: "Connection Failure", data: { reason: "401", location: "frc" } })).toBe("Connection Failure: reason=401 location=frc");
    expect(disconnectDetail({ message: "Stream Errored (unknown)", data: { tag: "stream:error", attrs: { code: "515" }, content: [{ tag: "item", attrs: { jid: "491510000002@s.whatsapp.net" } }] } })).toBe(
      "Stream Errored (unknown): stream:error code=515 [item jid=[jid]]",
    );
    expect(disconnectDetail(null)).toBeNull();
    expect(redactWa("from 4915100000002:7@s.whatsapp.net and 12345678@lid, +491510000002, key q8Zp3vYx1Lm2Nk4Rt5Wu6Ab7Cd8Ef9Gh0=")).toBe("from [jid] and [jid], +[n], key [key]");
    expect(redactWa("uploadPreKeysToServerIfRequired failed")).toBe("uploadPreKeysToServerIfRequired failed");
  });

  it("Baileys' logger writes warn and error as redacted lines, drops trace to info, and never prints an object's content", () => {
    const lines: string[] = [];
    const log = waLogger((l) => lines.push(l));
    expect(log.level).toBe("warn");
    log.child({ class: "ns" }).info({ text: "private" }, "hello");
    log.debug({}, "x");
    log.warn({ jid: "491510000002@s.whatsapp.net", message: { conversation: "private life" }, count: 3 }, "decrypt failed");
    log.error({ reasonNode: { tag: "conflict", attrs: { type: "device_removed" } }, trace: "Error: at secret.ts" }, "stream errored out");
    expect(lines).toEqual(["whatsapp warn: decrypt failed jid=[jid] message={conversation} count=3", "whatsapp error: stream errored out reasonNode=<conflict type=device_removed>"]);
    expect(logLine(new Error("bad 491510000002"))).toBe("Error: bad [n]");
  });
});

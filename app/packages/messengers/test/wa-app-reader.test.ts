import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as NodeSqlite from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ingest } from "../src/ingest";
import { CORE_DATA_EPOCH_S, openWaAppReader, WA_APP_FIX } from "../src/wa-app-reader";
import { setup, type Env } from "./helpers";

// P141 W3: the Mac's WhatsApp app database as a read-only refill, on a FIXTURE built from the probed schema (2026-11-24: the
// columns of ZWACHATSESSION and ZWAMESSAGE this reader names, Z_METADATA) with synthetic rows. No test opens the owner's own file.

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof NodeSqlite;

const PHONE = "+966500000001";
const LID = "111122223333444@lid";
const OTHER = "+491510000002";
const ACCOUNT = "6281300000000";
const cd = (iso: string) => Date.parse(iso) / 1000 - CORE_DATA_EPOCH_S;

/** A ChatStorage.sqlite as the app 26.44.72 lays it out (only the columns read, plus one it does not), with three chats. */
function fixture(o: { dropColumn?: string; noMetadata?: boolean } = {}): string {
  const path = join(mkdtempSync(join(tmpdir(), "hub-wa-app-")), "ChatStorage.sqlite");
  const db = new DatabaseSync(path);
  if (!o.noMetadata) db.exec("CREATE TABLE Z_METADATA (Z_VERSION INTEGER PRIMARY KEY, Z_UUID VARCHAR(255), Z_PLIST BLOB); INSERT INTO Z_METADATA VALUES (1, 'uuid', NULL);");
  const session = ["Z_PK INTEGER PRIMARY KEY", "ZSESSIONTYPE INTEGER", "ZCONTACTJID VARCHAR", "ZCONTACTIDENTIFIER VARCHAR", "ZPARTNERNAME VARCHAR", "ZLASTMESSAGEDATE TIMESTAMP"].filter((c) => !c.startsWith(`${o.dropColumn} `));
  const message = ["Z_PK INTEGER PRIMARY KEY", "ZCHATSESSION INTEGER", "ZISFROMME INTEGER", "ZMESSAGETYPE INTEGER", "ZMESSAGEDATE TIMESTAMP", "ZTEXT VARCHAR", "ZSTANZAID VARCHAR", "ZPUSHNAME VARCHAR"].filter((c) => !c.startsWith(`${o.dropColumn} `));
  db.exec(`CREATE TABLE ZWACHATSESSION (${session.join(", ")}); CREATE TABLE ZWAMESSAGE (${message.join(", ")});`);
  if (!o.dropColumn) {
    // 1: the LID chat filed under its @lid, its phone in ZCONTACTIDENTIFIER; 2: a phone chat; 3: a group (never read).
    db.exec(`INSERT INTO ZWACHATSESSION VALUES (1, 0, '${LID}', '966500000001@s.whatsapp.net', 'Example', ${cd("2026-11-24T13:04:00.000Z")}), (2, 0, '491510000002@s.whatsapp.net', '999@lid', 'Anna', ${cd("2026-11-24T09:00:00.000Z")}), (3, 1, '1203630@g.us', NULL, 'Group', ${cd("2026-11-24T09:00:00.000Z")}), (4, 0, '222@lid', NULL, NULL, ${cd("2026-09-01T10:00:00.000Z")});`);
    const ins = db.prepare("INSERT INTO ZWAMESSAGE (ZCHATSESSION, ZISFROMME, ZMESSAGETYPE, ZMESSAGEDATE, ZTEXT, ZSTANZAID) VALUES (?, ?, ?, ?, ?, ?)");
    ins.run(1, 0, 0, cd("2026-11-24T11:50:40.000Z"), "first, before the Hub ran", "3EB0APP00001");
    ins.run(1, 1, 0, cd("2026-11-24T12:10:00.000Z"), "our answer from the phone", "3EB0APP00002");
    ins.run(1, 0, 7, cd("2026-11-24T13:01:16.000Z"), "a link: https://example.com", "3EB0APP00003");
    ins.run(1, 0, 1, cd("2026-11-24T13:02:00.000Z"), null, "3EB0APP00004");
    ins.run(1, 0, 6, cd("2026-11-24T13:03:00.000Z"), "a system line", "3EB0APP00005");
    ins.run(1, 0, 59, cd("2026-11-24T13:04:00.000Z"), "a type this reader does not know", "3EB0APP00006");
    ins.run(1, 0, 0, cd("2026-09-01T10:00:00.000Z"), "too old", "3EB0APP00007");
    ins.run(2, 0, 0, cd("2026-11-24T09:00:00.000Z"), "Anna's", "3EB0APP00008");
    ins.run(3, 0, 0, cd("2026-11-24T09:00:00.000Z"), "group text", "3EB0APP00009");
  }
  db.close();
  return path;
}

const SINCE = new Date("2026-10-25T00:00:00.000Z");

describe("wa-app-reader: the probe fails closed", () => {
  it("passes on the probed schema", () => {
    expect(openWaAppReader({ path: fixture() }).state()).toEqual({ state: "on" });
  });

  it("is off when a column it reads is missing, or Z_METADATA is, and reads nothing", () => {
    const r = openWaAppReader({ path: fixture({ dropColumn: "ZSTANZAID" }) });
    expect(r.state()).toMatchObject({ state: "off", reason: "schema", fix: null });
    expect(r.state().state === "off" && r.state()).toMatchObject({ detail: expect.stringContaining("ZWAMESSAGE lacks ZSTANZAID") });
    expect(r.read({ chatId: PHONE, jid: null }, SINCE, ACCOUNT)).toEqual([]);
    expect(openWaAppReader({ path: fixture({ noMetadata: true }) }).state()).toMatchObject({ state: "off", reason: "schema" });
  });

  it("is off with no fix when the app is not installed; the refusal's fix names the server's node binary", () => {
    expect(openWaAppReader({ path: join(tmpdir(), "no-such-dir", "ChatStorage.sqlite") }).state()).toMatchObject({ state: "off", reason: "missing", fix: null });
    expect(WA_APP_FIX("/opt/node/bin/node")).toBe("Grant Full Disk Access to /opt/node/bin/node (System Settings ▸ Privacy & Security ▸ Full Disk Access), then restart the Hub.");
  });
});

describe("wa-app-reader: one chat", () => {
  it("finds a LID chat from its phone, converts Core Data dates, maps the types it knows and skips the rest", () => {
    const rows = openWaAppReader({ path: fixture() }).read({ chatId: PHONE, jid: null }, SINCE, ACCOUNT);
    expect(rows).toEqual([
      { channel: "whatsapp", account: ACCOUNT, chatId: PHONE, remoteMessageId: "3EB0APP00001", kind: "text", text: "first, before the Hub ran", sentAt: "2026-11-24T11:50:40.000Z", direction: "in", source: "wa_app" },
      { channel: "whatsapp", account: ACCOUNT, chatId: PHONE, remoteMessageId: "3EB0APP00002", kind: "text", text: "our answer from the phone", sentAt: "2026-11-24T12:10:00.000Z", direction: "out", source: "wa_app" },
      { channel: "whatsapp", account: ACCOUNT, chatId: PHONE, remoteMessageId: "3EB0APP00003", kind: "text", text: "a link: https://example.com", sentAt: "2026-11-24T13:01:16.000Z", direction: "in", source: "wa_app" },
      { channel: "whatsapp", account: ACCOUNT, chatId: PHONE, remoteMessageId: "3EB0APP00004", kind: "image", text: "", sentAt: "2026-11-24T13:02:00.000Z", direction: "in", source: "wa_app" },
    ]);
  });

  it("finds the same chat by its LID, a phone chat by its JID, and never a group", () => {
    const r = openWaAppReader({ path: fixture() });
    expect(r.read({ chatId: "lid:111122223333444", jid: null }, SINCE, ACCOUNT)).toHaveLength(4);
    expect(r.read({ chatId: PHONE, jid: LID }, SINCE, ACCOUNT)).toHaveLength(4);
    expect(r.read({ chatId: OTHER, jid: null }, SINCE, ACCOUNT).map((m) => m.text)).toEqual(["Anna's"]);
    expect(r.read({ chatId: "+1203630", jid: null }, SINCE, ACCOUNT)).toEqual([]);
  });

  it("never writes the file: it is opened read only", () => {
    const path = fixture();
    openWaAppReader({ path }).read({ chatId: PHONE, jid: null }, SINCE, ACCOUNT);
    const db = new DatabaseSync(path, { readOnly: true });
    expect(() => db.exec("INSERT INTO Z_METADATA VALUES (2, 'x', NULL)")).toThrow(/readonly/i);
    db.close();
  });
});

describe("wa-app-reader: through the one ingest", () => {
  let env: Env;
  beforeEach(async () => {
    env = await setup();
  });
  afterEach(() => env.close());

  it("a row Baileys already cached is not stored twice, and only the rows the app alone supplied say so", async () => {
    await env.repos.messengers.knowChat("p", "whatsapp", PHONE, { title: PHONE });
    const now = new Date("2026-11-24T14:00:00.000Z");
    await ingest({ project: "p", repos: env.repos, now: () => now, retentionDays: 30 }, [{ channel: "whatsapp", account: ACCOUNT, chatId: PHONE, remoteMessageId: "3EB0APP00003", kind: "text", text: "a link: https://example.com", sentAt: "2026-11-24T13:01:16.000Z", direction: "in" }]);
    const rows = openWaAppReader({ path: fixture() }).read({ chatId: PHONE, jid: null }, SINCE, ACCOUNT);
    const r = await ingest({ project: "p", repos: env.repos, now: () => now, retentionDays: 30 }, rows);
    expect(r).toMatchObject({ stored: 3, duplicates: 1, chats: [] });
    const stored = await env.repos.messengers.messagesOf("p", [{ channel: "whatsapp", chatId: PHONE }], { limit: 10 });
    expect(stored.map((m) => [m.remoteMessageId, m.source]).sort()).toEqual([
      ["3EB0APP00001", "wa_app"],
      ["3EB0APP00002", "wa_app"],
      ["3EB0APP00003", null],
      ["3EB0APP00004", "wa_app"],
    ]);
    expect(stored.every((m) => m.retainUntil === "2026-12-24T14:00:00.000Z")).toBe(true);
    // The person wrote: the chat row says so, beyond the cache.
    expect((await env.repos.messengers.chat("p", "whatsapp", PHONE))?.lastInboundAt).toBe("2026-11-24T13:02:00.000Z");
  });
});

describe("wa-app-reader: the recent private chats seed the known ones (P141 U2)", () => {
  it("lists private chats with a message since the time, newest first, by phone when either address names it, never a group", () => {
    const r = openWaAppReader({ path: fixture() });
    expect(r.recent(new Date("2026-11-10T00:00:00.000Z"), 50)).toEqual([
      { chatId: PHONE, jid: LID, name: "Example" },
      { chatId: OTHER, jid: "491510000002@s.whatsapp.net", name: "Anna" },
    ]);
    expect(r.recent(new Date("2026-08-01T00:00:00.000Z"), 50).map((x) => x.chatId)).toEqual([PHONE, OTHER, "lid:222"]);
  });
});

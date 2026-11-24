import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configureOps, ops, resetOps, withAction } from "../src/ops";
import { leaksIn, scanLogs } from "../src/leak-scan";

// P137 L5 (verdict 6): the ops log never keeps a client's address, a message body or a token, whatever a caller hands it. The
// lines are written by the real logger into a throwaway store and the files are scanned afterwards, as the e2e run's last spec
// scans a whole day of its stack's logs (`apps/admin/e2e/zz-log-privacy.spec.ts`).

afterEach(() => resetOps());

const CLIENT = "marta.ficticia@example.net";
const BOT_TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw";
const NOTION = "ntn_abcdefghijklmnopqrstuvwxyz0123456789";

describe("the ops log keeps no address, body or token (P137 L5)", () => {
  it("lines written with them in messages and fields leave none in the file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hub-privacy-"));
    configureOps({ store: { dir, secrets: path.join(dir, "no-secrets"), keepDays: 30, softCap: 1e9, hardCap: 2e9 }, stderr: false });
    withAction("w-kqzhtrvmab", () => {
      ops("send").warn(`a confirmed send to ${CLIENT} was refused`, { to: CLIENT, reasons: [`${CLIENT} is not on the allow list`] });
      ops("mail").error("a Mail script failed", { body: "Dear Marta, the price is 300 000", text: "hello", reason: `token ${BOT_TOKEN}` });
      ops("notion").warn("Notion write failed", { authorization: `Bearer ${NOTION}`, detail: NOTION });
    });
    expect(scanLogs(dir, { known: [CLIENT, BOT_TOKEN, NOTION] })).toEqual([]);
  });

  it("the scanner itself finds each kind (so an empty scan means something)", () => {
    const raw = [
      JSON.stringify({ time: "t", level: "warn", source: "send", message: `refused for ${CLIENT}` }),
      JSON.stringify({ time: "t", level: "error", source: "mail", message: "m", fields: { body: "Dear Marta" } }),
      JSON.stringify({ time: "t", level: "error", source: "notion", message: `token ${NOTION}` }),
    ].join("\n");
    expect(leaksIn(raw, "ops-x.jsonl", { opsLog: true }).map((l) => l.kind).sort()).toEqual(["address", "body", "token"]);
    expect(leaksIn(`{"m":"m***@example.net"}`, "ops-x.jsonl", { opsLog: true })).toEqual([]);
  });
});

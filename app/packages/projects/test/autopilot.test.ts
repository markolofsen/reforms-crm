import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { autopilotOf, changeAutopilot, chatAutopilot, readAutopilotSwitch, setAutopilot, writeAutopilotSwitch } from "../src/autopilot";
import { autopilotOff, defaultPolicy, policyFile, readSendPolicy, setSendPolicy, writeSendPolicy } from "../src/send-policy";

// P139 A1 (decision 0048 point 2): the autopilot's three switches, all must be on, and the policy's one writer.

const dir = () => mkdtempSync(path.join(tmpdir(), "hub-autopilot-"));

describe("the project's autopilot block in send-policy.json", () => {
  it("is optional: a policy written before P139 stays valid (schema 1) and reads as off", () => {
    const d = dir();
    writeSendPolicy(d, "t", { ...defaultPolicy("generic"), updatedAt: "2026-11-20T00:00:00Z", by: "owner" });
    const st = readSendPolicy(d, "t", "generic");
    expect(st.source).toBe("file");
    expect(st.policy.autopilot).toBeUndefined();
    expect(autopilotOf(st.policy)).toEqual({ mode: "off", chats: [], disclose: "daily", quiet: null });
  });

  it("is written through the send policy's one writer, keeping the rest of the policy, stamped with who and when", () => {
    const d = dir();
    setSendPolicy(d, "t", "generic", { "draft.recipients": "any" }, "owner");
    const now = new Date("2026-11-24T10:00:00Z");
    setAutopilot(d, "t", "generic", { kind: "mode", mode: "dry_run" }, "owner", now);
    const p = setAutopilot(d, "t", "generic", { kind: "chat", chat: "telegram_user:1001", on: true }, "owner", now);
    expect(p).toMatchObject({ recipients: "any", updatedAt: now.toISOString(), by: "owner", autopilot: { mode: "dry_run", chats: ["telegram_user:1001"] } });
    expect(JSON.parse(readFileSync(policyFile(d, "t"), "utf8")).autopilot.chats).toEqual(["telegram_user:1001"]);
    // A later `hub send policy set` keeps the block.
    expect(setSendPolicy(d, "t", "generic", { "send.daily_cap": "7" }, "owner").autopilot?.mode).toBe("dry_run");
  });

  it("lists a chat once, removes it when switched off, and refuses a malformed chat key or mode", () => {
    let a = autopilotOff();
    a = changeAutopilot(a, { kind: "chat", chat: "whatsapp:+4915100000000", on: true });
    a = changeAutopilot(a, { kind: "chat", chat: "whatsapp:+4915100000000", on: true });
    expect(a.chats).toEqual(["whatsapp:+4915100000000"]);
    expect(changeAutopilot(a, { kind: "chat", chat: "whatsapp:+4915100000000", on: false }).chats).toEqual([]);
    expect(() => changeAutopilot(a, { kind: "chat", chat: "mail:a@b", on: true })).toThrow();
    expect(() => changeAutopilot(a, { kind: "quiet", quiet: { from: "25:00", to: "07:00", tz: "Europe/Berlin" } })).toThrow();
  });

  it("never overwrites an unreadable policy with defaults", () => {
    const d = dir();
    mkdirSync(path.join(d, "t"), { recursive: true });
    writeFileSync(policyFile(d, "t"), "{ not json");
    expect(() => setAutopilot(d, "t", "generic", { kind: "mode", mode: "on" }, "owner")).toThrow(/cannot be read/);
    expect(readFileSync(policyFile(d, "t"), "utf8")).toBe("{ not json");
  });
});

describe("the instance switch, state/autopilot.json", () => {
  it("is off with no file and with a file that does not parse; on only as written", () => {
    const file = path.join(dir(), "state", "autopilot.json");
    expect(readAutopilotSwitch(file)).toMatchObject({ source: "default", value: { on: false } });
    writeAutopilotSwitch(file, true, "owner", new Date("2026-11-24T10:00:00Z"));
    expect(readAutopilotSwitch(file)).toMatchObject({ source: "file", value: { on: true, by: "owner", updatedAt: "2026-11-24T10:00:00.000Z" } });
    writeFileSync(file, JSON.stringify({ schema: 1, on: "yes" }));
    expect(readAutopilotSwitch(file).value.on).toBe(false);
    expect(readAutopilotSwitch(file).error).toBeTruthy();
  });
});

describe("a chat's autopilot: three switches, all on (decision 0048 point 2)", () => {
  const on = { mode: "on" as const, chats: ["telegram_user:1"], disclose: "daily" as const, quiet: null };
  const base = { instanceOn: true, policy: on, chat: "telegram_user:1", replyMode: "draft" as const, stopped: false, paused: null };
  it("runs only when the instance, the project and the chat are on", () => {
    expect(chatAutopilot(base)).toEqual({ state: "on" });
    expect(chatAutopilot({ ...base, policy: { ...on, mode: "dry_run" } })).toEqual({ state: "dry_run" });
    expect(chatAutopilot({ ...base, instanceOn: false })).toEqual({ state: "off", off: "instance" });
    expect(chatAutopilot({ ...base, policy: { ...on, mode: "off" } })).toEqual({ state: "off", off: "project" });
    expect(chatAutopilot({ ...base, chat: "telegram_user:2" })).toEqual({ state: "off", off: "chat" });
  });
  it("Stop sending and a reply mode other than draft keep it off; a pause (app.db) can only stop it", () => {
    expect(chatAutopilot({ ...base, stopped: true })).toEqual({ state: "off", off: "stopped" });
    expect(chatAutopilot({ ...base, replyMode: "on_request" })).toEqual({ state: "off", off: "reply_mode" });
    expect(chatAutopilot({ ...base, paused: { at: "x", reason: "owner_replied" } })).toEqual({ state: "paused", reason: "owner_replied", at: "x" });
    // A pause row on a chat that is off does not make it run or read as paused.
    expect(chatAutopilot({ ...base, instanceOn: false, paused: { at: "x", reason: "owner_replied" } })).toEqual({ state: "off", off: "instance" });
  });
});

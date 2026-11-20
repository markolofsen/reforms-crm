import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureOps, errorFields, ops, redactOps, redactText, resetOps } from "../src/ops";

// P86: the ops log's ONE redactor. Every line of every source passes `redactOps`; this test is its enforcement (rules README
// rule 18). What it proves: no phone, jid, email address, token, key, session string, login code or body text survives, and the
// line stays valid JSON.

afterEach(() => resetOps());

const SECRETS = (() => {
  const dir = mkdtempSync(path.join(tmpdir(), "ops-secrets-"));
  writeFileSync(path.join(dir, "notion-token"), "my-own-notion-secret-value-123");
  return dir;
})();

describe("ops redaction: by shape, in every string", () => {
  it("masks phones (plain runs, + numbers with separators), jids, emails and key-shaped strings", () => {
    expect(redactText("call +7 (999) 123-45-67 or 89991234567 or 8 999 123 45 67")).toBe("call +[n] or [n] or [n]");
    expect(redactText("from 4915100000002:7@s.whatsapp.net and 12345678@lid")).toBe("from [jid] and [jid]");
    expect(redactText("wrote to mark@example.com and a.b-c@mail.co.uk")).toBe("wrote to m***@example.com and a***@mail.co.uk");
    expect(redactText("api_hash 0123456789abcdef0123456789abcdef session 1BVtsOK8Bu3Kx9mQ2rT7wY5zP0aL4nE6")).toBe("api_hash [key] session [key]");
  });

  it("keeps what says why: dates, times, ports, durations, short codes of a protocol, words", () => {
    expect(redactText("2026-11-20T18:07:12.000Z port 4317 status 401 after 3600 s: Stream Errored (conflict)")).toBe("2026-11-20T18:07:12.000Z port 4317 status 401 after 3600 s: Stream Errored (conflict)");
    expect(redactText("uploadPreKeysToServerIfRequired failed")).toBe("uploadPreKeysToServerIfRequired failed");
  });

  it("masks token shapes and every value stored under state/secrets", () => {
    const r = redactOps("Bearer abcdefghijklmnop0123 and sk-ant-api03-abcdefgh and my-own-notion-secret-value-123", { note: "my-own-notion-secret-value-123 leaked" }, SECRETS);
    expect(r.message).not.toMatch(/abcdefghijklmnop0123|sk-ant-api03-abcdefgh|my-own-notion-secret/);
    expect(JSON.stringify(r.fields)).not.toContain("my-own-notion-secret");
  });

  it("applies the token shapes even with no instance (no secrets folder)", () => {
    expect(redactOps("token ntn_abcdefghijklmnop", undefined).message).not.toContain("ntn_abcdefghijklmnop");
  });
});

describe("ops redaction: by name", () => {
  it("masks a secret-named field whatever it holds: a 5-digit login code, a password, an api_hash, a session, a token", () => {
    const r = redactOps("login", { code: "12345", phone_code: "54321", password: "hunter2", apiHash: "abc", api_hash: "abc", session: "1BVts", botToken: "1:x", authorization: "Basic x", qr: "2@abc" });
    expect(r.fields).toEqual({ code: "***", phone_code: "***", password: "***", apiHash: "***", api_hash: "***", session: "***", botToken: "***", authorization: "***", qr: "***" });
  });

  it("drops a body-named field (never masks it): a message's or a mail's text never reaches the log", () => {
    const r = redactOps("draft", { text: "private life", body: "Dear Anna", content: "x", html: "<p>", caption: "photo", status: 401 });
    expect(r.fields).toEqual({ text: "[body omitted]", body: "[body omitted]", content: "[body omitted]", html: "[body omitted]", caption: "[body omitted]", status: 401 });
    expect(JSON.stringify(r)).not.toMatch(/private life|Dear Anna/);
  });

  it("masks an identity number (a Telegram id, a phone) but keeps a count, a size or a duration", () => {
    const r = redactOps("x", { account: 7012345678, chatId: 1001234567, userId: 42, bytes: 20971520, retryInS: 3600, failures: 3 });
    expect(r.fields).toEqual({ account: "[n]", chatId: "[n]", userId: 42, bytes: 20971520, retryInS: 3600, failures: 3 });
  });

  it("walks nested objects, arrays and errors, and the line stays valid JSON", () => {
    const err = Object.assign(new Error("401 for +491510000002 at mark@example.com"), { code: "logged_out" });
    const r = redactOps("closed", { nested: { reason: "jid 4915100000002@s.whatsapp.net", list: ["+44 20 7946 0958"], body: "secret text" }, err });
    const text = JSON.stringify(r);
    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).not.toMatch(/4915100000002|491510000002|7946|mark@|secret text/);
    expect(r.fields).toMatchObject({ nested: { reason: "jid [jid]", list: ["+[n]"], body: "[body omitted]" }, err: { error: "Error: 401 for +[n] at m***@example.com", kind: "logged_out" } });
  });

  it("an error's fields: name and message, its code as `kind`, and the first frames only when asked", () => {
    const e = Object.assign(new Error("boom"), { code: "E_X" });
    expect(errorFields(e)).toEqual({ error: "Error: boom", kind: "E_X" });
    expect(String(errorFields(e, true).stack)).toContain("ops-redact.test.ts");
    expect(errorFields("plain")).toEqual({ error: "plain" });
  });
});

describe("the logger redacts before anything leaves it", () => {
  it("every line through ops(source) is redacted, stamped and leveled", () => {
    const cap = captureOps();
    ops("whatsapp").error("socket closed for +491510000002", { status: 401, reason: "Stream Errored (conflict): conflict type=device_removed", account: "491510000002", text: "hello Anna" });
    ops("telegram").warn("login", { code: "12345" });
    cap.stop();
    expect(cap.lines).toHaveLength(2);
    expect(cap.lines[0]).toMatchObject({ level: "error", source: "whatsapp", message: "socket closed for +[n]", fields: { status: 401, reason: "Stream Errored (conflict): conflict type=device_removed", account: "[n]", text: "[body omitted]" } });
    expect(cap.lines[1]).toMatchObject({ level: "warn", source: "telegram", fields: { code: "***" } });
    expect(Date.parse(cap.lines[0]!.time)).not.toBeNaN();
  });

  it("a throwing field never breaks the caller", () => {
    const cap = captureOps();
    const bad = { get x(): string { throw new Error("getter"); } };
    expect(() => ops("server").error("bad field", bad as unknown as Record<string, unknown>)).not.toThrow();
    cap.stop();
  });
});

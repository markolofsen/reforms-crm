import { FakeImapServer } from "@hub/mail/imap";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  fileState, inspect, isTelegramToken, mailFileOf, parseConnectionId, probeImap, probeNotion, probeTelegram, readValue, redact, removeSecret,
  slug, storeMailLogin, storeToken, testConnection, type ConnectionRow, type ProbeDeps,
} from "../src/index.js";

// Fake secrets only. Every test uses its own throwaway folder; nothing here opens a real instance.
const NOTION = "ntn_FAKENOTIONSECRET1234567890";
const TG = "123456789:AAFakeTelegramTokenValue_1234567890";
const PASS = "fake-app-pass-4321";
const ALL = [NOTION, TG, PASS];

const dirOf = (): string => path.join(mkdtempSync(path.join(tmpdir(), "hub-conn-")), "secrets");
const put = (dir: string, name: string, text: string, mode = 0o600): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), text, { mode });
  chmodSync(path.join(dir, name), mode);
};
const login = (account: string, extra: object = {}): string => JSON.stringify({ account, host: "imap.example.test", port: 993, user: "me@example.test", pass: PASS, ...extra }, null, 2);
const leaks = (v: unknown): string[] => ALL.filter((s) => JSON.stringify(v).includes(s));
const row = (rows: ConnectionRow[], id: string): ConnectionRow => {
  const r = rows.find((x) => x.id === id);
  if (!r) throw new Error(`no row ${id}: ${rows.map((x) => x.id).join(", ")}`);
  return r;
};
const base = { env: {} as NodeJS.ProcessEnv, projects: [] };

describe("inspect", () => {
  it("an empty instance lists the two missing tokens and the static WhatsApp row", () => {
    const rows = inspect({ dir: dirOf(), ...base });
    expect(rows.map((r) => [r.id, r.secret.state, r.can])).toEqual([
      ["notion:notion-token", "missing", ["set"]],
      ["telegram:bot", "missing", ["set"]],
      ["whatsapp", "not-applicable", []],
    ]);
  });

  it("reports stored, loose mode, empty and malformed token files, and never carries a value", () => {
    const dir = dirOf();
    put(dir, "notion-token", NOTION + "\n");
    put(dir, "telegram-bot-token", TG + "\n");
    let rows = inspect({ dir, ...base });
    expect(row(rows, "notion:notion-token")).toMatchObject({ secret: { state: "stored" }, can: ["test", "set", "remove"] });
    expect(row(rows, "telegram:bot").secret.state).toBe("stored");
    expect(leaks(rows)).toEqual([]);

    chmodSync(path.join(dir, "notion-token"), 0o644);
    expect(row(inspect({ dir, ...base }), "notion:notion-token").secret.state).toBe("unsafe-mode");
    put(dir, "notion-token", "   \n");
    expect(row(inspect({ dir, ...base }), "notion:notion-token").secret.state).toBe("malformed");
    put(dir, "telegram-bot-token", "not a bot token at all\n");
    rows = inspect({ dir, ...base });
    expect(row(rows, "telegram:bot").secret.state).toBe("malformed");
    expect(leaks(rows)).toEqual([]);
  });

  it("NOTION_TOKEN wins over the file and offers Test only", () => {
    const dir = dirOf();
    put(dir, "notion-token", NOTION);
    const r = row(inspect({ dir, env: { NOTION_TOKEN: NOTION }, projects: [] }), "notion:notion-token");
    expect(r.secret.state).toBe("from-env");
    expect(r.can).toEqual(["test"]);
    expect(r.note).toContain("NOTION_TOKEN");
  });

  it("one Notion row per token file a project names, with who uses it", () => {
    const dir = dirOf();
    const rows = inspect({ dir, env: {}, projects: [
      { slug: "alpha", mailAccounts: [], notionTokenFile: "notion-token" },
      { slug: "beta", mailAccounts: [], notionTokenFile: "beta-token" },
      { slug: "evil", mailAccounts: [], notionTokenFile: "../escape" },
    ] });
    expect(rows.filter((r) => r.kind === "notion").map((r) => [r.id, r.usedBy])).toEqual([["notion:beta-token", ["beta"]], ["notion:notion-token", ["alpha"]]]);
  });

  it("mail: a login file, a token login, a loose file, a broken file, and a name a project lists with no file", () => {
    const dir = dirOf();
    put(dir, "mail-work.json", login("Work"));
    put(dir, "mail-oauth.json", JSON.stringify({ account: "OAuth", host: "imap.example.test", user: "o@example.test", accessToken: "tok-fake-ACCESS-123456" }));
    put(dir, "mail-loose.json", login("Loose"), 0o644);
    put(dir, "mail-broken.json", "{ nope");
    const rows = inspect({ dir, env: {}, projects: [{ slug: "alpha", mailAccounts: ["work", "Apple Only"], notionTokenFile: "notion-token" }] });
    const mail = rows.filter((r) => r.kind === "mail");
    expect(mail.map((r) => r.id).sort()).toEqual(["mail:apple-only", "mail:broken", "mail:loose", "mail:oauth", "mail:work"]);
    expect(row(rows, "mail:work")).toMatchObject({ label: "Work", identity: "me@example.test at imap.example.test", usedBy: ["alpha"], secret: { state: "stored" }, can: ["test", "set", "remove"] });
    expect(row(rows, "mail:oauth")).toMatchObject({ can: ["test"] });
    expect(row(rows, "mail:oauth").note).toContain("refreshed outside");
    expect(row(rows, "mail:loose").secret.state).toBe("unsafe-mode");
    expect(row(rows, "mail:broken")).toMatchObject({ secret: { state: "malformed" } });
    expect(row(rows, "mail:apple-only")).toMatchObject({ secret: { state: "missing" }, usedBy: ["alpha"], can: ["set"] });
    expect(row(rows, "mail:apple-only").note).toContain("optional");
    expect(leaks(rows)).toEqual([]);
    expect(JSON.stringify(rows)).not.toContain("tok-fake-ACCESS");
  });

  it("telegram carries the poller state and the bound project", () => {
    const dir = dirOf();
    put(dir, "telegram-bot-token", TG);
    const r = row(inspect({ dir, env: {}, projects: [], telegram: { state: "running", project: "alpha" } }), "telegram:bot");
    expect(r.usedBy).toEqual(["alpha"]);
    expect(r.note).toContain("next server start");
    expect(r.note).toContain("Poller running");
  });

  it("two instances give two lists", () => {
    const a = dirOf(), b = dirOf();
    put(a, "mail-one.json", login("One"));
    expect(inspect({ dir: a, ...base }).some((r) => r.id === "mail:one")).toBe(true);
    expect(inspect({ dir: b, ...base }).some((r) => r.id === "mail:one")).toBe(false);
  });
});

describe("store and remove", () => {
  it("writes mode 600 in a 700 folder, leaves no temp file, replaces atomically", () => {
    const dir = dirOf();
    storeToken(dir, "notion-token", ` ${NOTION} `);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(path.join(dir, "notion-token")).mode & 0o777).toBe(0o600);
    expect(readValue(dir, "notion-token")).toBe(NOTION);
    storeToken(dir, "notion-token", "ntn_SECONDFAKEVALUE1234567");
    expect(readValue(dir, "notion-token")).toBe("ntn_SECONDFAKEVALUE1234567");
    expect(readdirSync(dir)).toEqual(["notion-token"]);
  });

  it("refuses a name that could leave the folder", () => {
    const dir = dirOf();
    expect(() => storeToken(dir, "../x", "v")).toThrow("plain secret file name");
    expect(() => removeSecret(dir, "a/b")).toThrow();
    expect(parseConnectionId("notion:../x")).toBeUndefined();
    expect(parseConnectionId("mail:Not A Slug")).toBeUndefined();
    expect(parseConnectionId("nope")).toBeUndefined();
    expect(parseConnectionId("mail:work")).toEqual({ kind: "mail", slug: "work", file: "mail-work.json" });
  });

  it("a mail login is checked by the reader's own parser, never overwritten unless asked", () => {
    const dir = dirOf();
    const f = { account: "Work Gmail", host: "imap.example.test", port: 993, user: "me@example.test", password: PASS };
    expect(storeMailLogin(dir, f, { replace: false }).file).toBe("mail-work-gmail.json");
    expect(statSync(path.join(dir, "mail-work-gmail.json")).mode & 0o777).toBe(0o600);
    expect(() => storeMailLogin(dir, f, { replace: false })).toThrow("already exists");
    expect(() => storeMailLogin(dir, { ...f, password: "x".repeat(8) }, { replace: true })).not.toThrow();
    expect(() => storeMailLogin(dir, { ...f, host: "not a host" }, { replace: true })).toThrow();
    try { storeMailLogin(dir, { ...f, host: "bad host" }, { replace: true }); } catch (e) { expect(String(e)).not.toContain(PASS); }
    expect(mailFileOf("Work Gmail")).toBe("mail-work-gmail.json");
    expect(readdirSync(dir)).toEqual(["mail-work-gmail.json"]);
  });

  it("remove deletes the file and says whether there was one", () => {
    const dir = dirOf();
    storeToken(dir, "telegram-bot-token", TG);
    expect(removeSecret(dir, "telegram-bot-token")).toBe(true);
    expect(removeSecret(dir, "telegram-bot-token")).toBe(false);
    expect(existsSync(path.join(dir, "telegram-bot-token"))).toBe(false);
    expect(fileState(dir, "telegram-bot-token").state).toBe("missing");
  });
});

describe("redact and shapes", () => {
  it("removes every stored value and anything shaped like a token", () => {
    const dir = dirOf();
    put(dir, "notion-token", NOTION);
    put(dir, "mail-work.json", login("Work"));
    const text = `a ${NOTION} b ${PASS} c ${TG} d ntn_OTHERUNSEENTOKEN123 e`;
    const out = redact(dir, text);
    expect(leaks(out)).toEqual([]);
    expect(out).not.toContain("OTHERUNSEEN");
  });
  it("one Telegram shape, one slug rule", () => {
    expect(isTelegramToken(TG)).toBe(true);
    expect(isTelegramToken("12:abc")).toBe(false);
    expect(slug("Work Gmail!")).toBe("work-gmail");
    expect(slug("!!!")).toBe("account");
  });
});

const respond = (status: number | "throw", body: unknown = {}, seen?: string[]): ProbeDeps => ({
  fetch: (async (url: string) => {
    seen?.push(String(url));
    if (status === "throw") throw new TypeError(`fetch failed for ${url}`);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch,
});

describe("probes", () => {
  it("notion: valid with the bot name, invalid on 401, unverified on 500 or offline", async () => {
    expect(await probeNotion(respond(200, { name: "Hub bot" }), NOTION)).toEqual({ state: "valid", detail: "GET /users/me answered", identity: "Hub bot" });
    expect((await probeNotion(respond(401), NOTION)).state).toBe("invalid");
    expect((await probeNotion(respond(500), NOTION)).state).toBe("unverified");
    const off = await probeNotion(respond("throw"), NOTION);
    expect(off).toEqual({ state: "unverified", detail: "cannot reach Notion (TypeError)" });
  });
  it("telegram: a bad shape never goes out; the URL's token never enters a verdict", async () => {
    const seen: string[] = [];
    expect((await probeTelegram(respond(200, {}, seen), "nope")).state).toBe("invalid");
    expect(seen).toEqual([]);
    expect(await probeTelegram(respond(200, { result: { username: "hubbot" } }, seen), TG)).toEqual({ state: "valid", detail: "bot @hubbot", identity: "@hubbot" });
    expect(seen[0]).toContain("/getMe");
    expect((await probeTelegram(respond(404), TG)).state).toBe("invalid");
    expect(leaks(await probeTelegram(respond("throw"), TG))).toEqual([]);
  });
  it("imap: valid, refused (text with the password is not echoed), unreachable", async () => {
    const acc = { name: "Work", host: "imap.example.test", port: 993, secure: true, user: "me@example.test", auth: { pass: PASS }, addresses: ["me@example.test"] };
    const server = new FakeImapServer({ Work: { INBOX: { messages: [] } } });
    expect((await probeImap({ fetch, imapConnect: server.connect }, acc)).state).toBe("valid");
    server.refuse.set("Work", `AUTHENTICATIONFAILED for ${PASS}`);
    const refused = await probeImap({ fetch, imapConnect: server.connect }, acc);
    expect(refused.state).toBe("invalid");
    expect(leaks(refused)).toEqual([]);
    const off = await probeImap({ fetch, imapConnect: async () => { throw new Error(`ECONNREFUSED with ${PASS}`); } }, acc);
    expect(off.state).toBe("unverified");
    expect(leaks(off)).toEqual([]);
  });
});

describe("testConnection by id", () => {
  it("reads the file the id names, with the fakes, and never returns a value", async () => {
    const dir = dirOf();
    put(dir, "notion-token", NOTION);
    put(dir, "telegram-bot-token", TG);
    put(dir, "mail-work.json", login("Work"));
    const server = new FakeImapServer({ Work: { INBOX: { messages: [] } } });
    const deps: ProbeDeps = { fetch: respond(200, { result: { username: "b" }, name: "n" }).fetch, imapConnect: server.connect };
    const out = await Promise.all(["notion:notion-token", "telegram:bot", "mail:work"].map((id) => testConnection(dir, {}, deps, id)));
    expect(out.map((v) => v.state)).toEqual(["valid", "valid", "valid"]);
    expect(leaks(out)).toEqual([]);
  });
  it("missing, loose, unknown, WhatsApp and env cases are verdicts, not throws", async () => {
    const dir = dirOf();
    const deps = respond(200);
    expect((await testConnection(dir, {}, deps, "notion:notion-token")).detail).toBe("no secret is stored");
    put(dir, "telegram-bot-token", TG, 0o644);
    expect((await testConnection(dir, {}, deps, "telegram:bot")).detail).toContain("mode 644");
    expect((await testConnection(dir, {}, deps, "mail:ghost")).state).toBe("invalid");
    expect((await testConnection(dir, {}, deps, "zzz")).detail).toBe("unknown connection");
    expect((await testConnection(dir, {}, deps, "whatsapp")).state).toBe("invalid");
    expect((await testConnection(dir, { NOTION_TOKEN: NOTION }, deps, "notion:notion-token")).state).toBe("valid");
  });
});

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  fileState, inspect, isTelegramToken, parseConnectionId, probeNotion, probeTelegram, readValue, redact, removeSecret,
  storeToken, testConnection, type ConnectionRow, type ProbeDeps,
} from "../src/index";

// Fake secrets only. Every test uses its own throwaway folder; nothing here opens a real instance.
const NOTION = "ntn_FAKENOTIONSECRET1234567890";
const TG = "123456789:AAFakeTelegramTokenValue_1234567890";
const ALL = [NOTION, TG];

const dirOf = (): string => path.join(mkdtempSync(path.join(tmpdir(), "hub-conn-")), "secrets");
const put = (dir: string, name: string, text: string, mode = 0o600): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), text, { mode });
  chmodSync(path.join(dir, name), mode);
};
const leaks = (v: unknown): string[] => ALL.filter((s) => JSON.stringify(v).includes(s));
const row = (rows: ConnectionRow[], id: string): ConnectionRow => {
  const r = rows.find((x) => x.id === id);
  if (!r) throw new Error(`no row ${id}: ${rows.map((x) => x.id).join(", ")}`);
  return r;
};
const base = { env: {} as NodeJS.ProcessEnv, projects: [] };

describe("inspect", () => {
  it("an empty instance lists the two missing tokens", () => {
    const rows = inspect({ dir: dirOf(), ...base });
    expect(rows.map((r) => [r.id, r.secret.state, r.can])).toEqual([
      ["notion:notion-token", "missing", ["set"]],
      ["telegram:bot", "missing", ["set"]],
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
      { slug: "alpha", notionTokenFile: "notion-token" },
      { slug: "beta", notionTokenFile: "beta-token" },
      { slug: "evil", notionTokenFile: "../escape" },
    ] });
    expect(rows.filter((r) => r.kind === "notion").map((r) => [r.id, r.usedBy])).toEqual([["notion:beta-token", ["beta"]], ["notion:notion-token", ["alpha"]]]);
  });

  it("has no mail row: an old mail login file is not a connection (decision 0026)", () => {
    const dir = dirOf();
    put(dir, "mail-work.json", JSON.stringify({ account: "Work", host: "imap.example.test", user: "me@example.test", pass: "fake-app-pass-4321" }));
    expect(inspect({ dir, ...base }).map((r) => r.kind)).toEqual(["notion", "telegram"]);
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
    put(a, "notion-token", NOTION);
    expect(row(inspect({ dir: a, ...base }), "notion:notion-token").secret.state).toBe("stored");
    expect(row(inspect({ dir: b, ...base }), "notion:notion-token").secret.state).toBe("missing");
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
    expect(parseConnectionId("nope")).toBeUndefined();
    expect(parseConnectionId("mail:work")).toBeUndefined();
    expect(parseConnectionId("notion:notion-token")).toEqual({ kind: "notion", file: "notion-token" });
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
    const text = `a ${NOTION} c ${TG} d ntn_OTHERUNSEENTOKEN123 e`;
    const out = redact(dir, text);
    expect(leaks(out)).toEqual([]);
    expect(out).not.toContain("OTHERUNSEEN");
  });
  it("removes the key shapes a session log may carry (P54)", () => {
    const dir = dirOf();
    const keys = ["sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX12", "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123", "xoxb-1234567890-abcdefghij", "AKIAABCDEFGHIJKLMNOP", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"];
    const out = redact(dir, `${keys.join(" ")} Authorization: Bearer abcdefghijklmnop1234 plain words stay`);
    for (const k of keys) expect(out).not.toContain(k);
    expect(out).toContain("Bearer ***");
    expect(out).toContain("plain words stay");
  });
  it("one Telegram shape", () => {
    expect(isTelegramToken(TG)).toBe(true);
    expect(isTelegramToken("12:abc")).toBe(false);
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
});

describe("testConnection by id", () => {
  it("reads the file the id names, with the fakes, and never returns a value", async () => {
    const dir = dirOf();
    put(dir, "notion-token", NOTION);
    put(dir, "telegram-bot-token", TG);
    const deps: ProbeDeps = { fetch: respond(200, { result: { username: "b" }, name: "n" }).fetch };
    const out = await Promise.all(["notion:notion-token", "telegram:bot"].map((id) => testConnection(dir, {}, deps, id)));
    expect(out.map((v) => v.state)).toEqual(["valid", "valid"]);
    expect(leaks(out)).toEqual([]);
  });
  it("missing, loose, unknown and env cases are verdicts, not throws", async () => {
    const dir = dirOf();
    const deps = respond(200);
    expect((await testConnection(dir, {}, deps, "notion:notion-token")).detail).toBe("no secret is stored");
    put(dir, "telegram-bot-token", TG, 0o644);
    expect((await testConnection(dir, {}, deps, "telegram:bot")).detail).toContain("mode 644");
    expect((await testConnection(dir, {}, deps, "mail:ghost")).detail).toBe("unknown connection");
    expect((await testConnection(dir, {}, deps, "zzz")).detail).toBe("unknown connection");
    expect((await testConnection(dir, {}, deps, "whatsapp")).detail).toBe("unknown connection");
    expect((await testConnection(dir, { NOTION_TOKEN: NOTION }, deps, "notion:notion-token")).state).toBe("valid");
  });
});

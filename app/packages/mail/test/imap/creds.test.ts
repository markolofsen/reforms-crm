import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAccounts, parseAccount, redactSecrets } from "../../src/imap/creds.js";

const dir = () => mkdtempSync(path.join(tmpdir(), "hubmail-"));
const put = (d: string, name: string, body: unknown, mode = 0o600) => {
  const f = path.join(d, name);
  writeFileSync(f, typeof body === "string" ? body : JSON.stringify(body));
  chmodSync(f, mode);
};
const good = { account: "Google", host: "imap.example.test", user: "Me@Example.test", pass: "app-password-1234" };

describe("parseAccount", () => {
  it("reads a password login, defaults to port 993 over TLS, and always counts the login as an own address", () => {
    const a = parseAccount(JSON.stringify({ ...good, addresses: ["Alias@Example.test"] }));
    expect(a).toMatchObject({ name: "Google", host: "imap.example.test", port: 993, secure: true, user: "Me@Example.test", auth: { pass: "app-password-1234" } });
    expect(a.addresses).toEqual(["alias@example.test", "me@example.test"]);
  });
  it("reads an OAuth access token login and the optional mailbox names", () => {
    const a = parseAccount(JSON.stringify({ account: "W", host: "h.test", user: "u", accessToken: "ya29.token", mailboxes: ["INBOX"], sentMailbox: "Sent", port: 143, secure: false }));
    expect(a).toMatchObject({ auth: { accessToken: "ya29.token" }, mailboxes: ["INBOX"], sentMailbox: "Sent", port: 143, secure: false });
  });
  it("refuses what is malformed, and the reason never contains the secret", () => {
    const bad: [unknown, RegExp][] = [
      ["{nope", /JSON/],
      [{ ...good, account: "" }, /account/],
      [{ ...good, host: "bad host!" }, /host/],
      [{ ...good, pass: undefined }, /exactly one/],
      [{ ...good, accessToken: "also" }, /exactly one/],
      [{ ...good, port: 99999 }, /port/],
      [{ ...good, addresses: ["not an address"] }, /addresses/],
      [[1], /object/],
    ];
    for (const [body, re] of bad) {
      let msg = "";
      try {
        parseAccount(typeof body === "string" ? body : JSON.stringify(body));
      } catch (e) {
        msg = (e as Error).message;
      }
      expect(msg).toMatch(re);
      expect(msg).not.toContain("app-password-1234");
    }
  });
});

describe("loadAccounts", () => {
  it("loads mail-*.json files only, sorted, and an absent folder is mail off", () => {
    const d = dir();
    put(d, "mail-b.json", { ...good, account: "B" });
    put(d, "mail-a.json", { ...good, account: "A" });
    put(d, "notion-token", "ntn\u005fx");
    put(d, "mail-notes.txt", "x");
    expect(loadAccounts(d).accounts.map((a) => a.name)).toEqual(["A", "B"]);
    expect(loadAccounts(path.join(d, "missing"))).toEqual({ accounts: [], problems: [] });
  });
  it("refuses a file other users can read, a bad file and a repeated account, and still loads the rest", () => {
    const d = dir();
    put(d, "mail-open.json", good, 0o644);
    put(d, "mail-bad.json", "{oops");
    put(d, "mail-ok.json", { ...good, account: "Ok" });
    put(d, "mail-zdup.json", { ...good, account: "ok" });
    const r = loadAccounts(d);
    expect(r.accounts.map((a) => a.name)).toEqual(["Ok"]);
    expect(r.problems.join("\n")).toMatch(/mail-open\.json: mode 644, must be 600/);
    expect(r.problems.join("\n")).toMatch(/mail-bad\.json: not valid JSON/);
    expect(r.problems.join("\n")).toMatch(/two files name this account/);
    expect(r.problems.join("\n")).not.toContain("app-password-1234");
  });
  it("skips a directory that looks like a login file", () => {
    const d = dir();
    mkdirSync(path.join(d, "mail-dir.json"));
    expect(loadAccounts(d).problems[0]).toMatch(/not a plain file/);
  });
});

describe("redactSecrets", () => {
  it("removes passwords and tokens of every account", () => {
    const a = parseAccount(JSON.stringify(good));
    const t = parseAccount(JSON.stringify({ account: "T", host: "h.test", user: "u", accessToken: "ya29.longtoken" }));
    expect(redactSecrets("login app-password-1234 and ya29.longtoken failed", [a, t])).toBe("login *** and *** failed");
  });
});

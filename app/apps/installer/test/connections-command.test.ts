import { inspect } from "@hub/connections";
import { execa } from "execa";
import { defaultRoot } from "../src/context";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { connectionsReport, connectionsTable, projectUses, storeNamedToken } from "../src/connections-command";
import { fake } from "./helpers";

// Fake secrets in a throwaway instance. The probes get a fake fetch: nothing leaves the process.
const NOTION = "ntn_FAKENOTIONSECRET1234567890";
const TG = "123456789:AAFakeTelegramTokenValue_1234567890";
const PASS = "fake-app-pass-4321"; // an old IMAP login file: no longer a connection (decision 0026)
const ID = "00000000-0000-4000-8000-000000000001";
const row = (k: string, v: string) => `| ${k} | ${v} | 2026-11-15 | owner |`;
const md = (slug: string, accounts: string) =>
  ["# " + slug, "", "## Settings", "", "| Field | Value | Answered | By |", "|---|---|---|---|", row("schema", "1"), row("status", "active"), row("mail.accounts", accounts), "", "## Notion databases", "", `- clients: ${ID}`, ""].join("\n");

function instance() {
  const f = fake();
  const dir = path.join(f.ctx.paths.projects, "alpha");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "project.md"), md("alpha", "Work, Apple Only"));
  mkdirSync(f.ctx.configDir, { recursive: true, mode: 0o700 });
  const put = (name: string, text: string, mode = 0o600) => { writeFileSync(path.join(f.ctx.configDir, name), text, { mode }); chmodSync(path.join(f.ctx.configDir, name), mode); };
  put("notion-token", NOTION);
  put("telegram-bot-token", TG);
  put("mail-work.json", JSON.stringify({ account: "Work", host: "imap.example.test", port: 993, user: "me@example.test", pass: PASS }));
  return { f, put };
}
const deps = () => ({
  fetch: (async () => new Response(JSON.stringify({ name: "Hub bot", result: { username: "hubbot" } }), { status: 200 })) as unknown as typeof fetch,
});

describe("hub connections", () => {
  it("prints the same rows as inspect() for the fixture, with project use, and no secret", async () => {
    const { f } = instance();
    const rep = await connectionsReport(f.ctx, { test: false, deps: deps() });
    expect(rep.rows).toEqual(inspect({ dir: f.ctx.configDir, env: process.env, projects: projectUses(f.ctx) }));
    const text = connectionsTable(rep);
    for (const r of rep.rows) expect(text).toContain(r.id);
    expect(rep.rows.map((r) => r.id)).toEqual(["notion:notion-token", "telegram:bot"]);
    expect(text).not.toContain("mail:");
    for (const s of [NOTION, TG, PASS]) expect(text).not.toContain(s);
    expect(rep.exitCode).toBe(0);
  });

  it("--test runs the probes with the fakes and prints the verdicts, still no secret", async () => {
    const { f } = instance();
    const rep = await connectionsReport(f.ctx, { test: true, deps: deps() });
    expect([...rep.verdicts.keys()].sort()).toEqual(["notion:notion-token", "telegram:bot"]);
    const text = connectionsTable(rep);
    expect(text).toContain("valid: bot @hubbot");
    for (const s of [NOTION, TG, PASS]) expect(text).not.toContain(s);
    expect(rep.exitCode).toBe(0);
  });

  it("exits 1 for a loose file or a refused login, 0 for a merely missing one", async () => {
    const { f, put } = instance();
    put("notion-token", NOTION, 0o644);
    expect((await connectionsReport(f.ctx, { test: false, deps: deps() })).exitCode).toBe(1);
    put("notion-token", NOTION);
    const refusing = { ...deps(), fetch: (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch };
    expect((await connectionsReport(f.ctx, { test: true, deps: refusing })).exitCode).toBe(1);
  });
});

describe("hub token", () => {
  it("stores a Telegram token at mode 600 and refuses a wrong shape without writing", () => {
    const f = fake();
    expect(() => storeNamedToken(f.ctx, "telegram", "nope")).toThrow("nothing stored");
    expect(() => storeNamedToken(f.ctx, "notion", "short")).toThrow("nothing stored");
    expect(() => storeNamedToken(f.ctx, "notion", "  ")).toThrow("empty");
    const file = storeNamedToken(f.ctx, "telegram", TG + "\n");
    expect(path.basename(file)).toBe("telegram-bot-token");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8").trim()).toBe(TG);
    expect(path.basename(storeNamedToken(f.ctx, "notion", NOTION))).toBe("notion-token");
  });
  it("a refusal never echoes the value", () => {
    const f = fake();
    try { storeNamedToken(f.ctx, "telegram", "bad-" + PASS); } catch (e) { expect(String(e)).not.toContain(PASS); }
  });
});

describe("the real command", () => {
  it("hub connections in a throwaway instance prints a table and no secret", async () => {
    const { f } = instance();
    const bin = path.join(defaultRoot(), "app", "apps", "installer", "bin", "hub.mjs");
    const r = await execa("node", [bin, "connections"], { reject: false, timeout: 60000, env: { ...process.env, HUB_HOME: f.root, HUB_CONFIG_DIR: "", HUB_PROJECTS: "", NOTION_TOKEN: "", NO_COLOR: "1" } });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain("telegram:bot");
    for (const s of [NOTION, TG, PASS]) expect(r.stdout + r.stderr).not.toContain(s);
  });
});

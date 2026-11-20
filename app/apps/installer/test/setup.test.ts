import { chmodSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Verdict } from "@hub/connections";
import { makeValidators, type Validators } from "../src/setup/clients";
import type { Ui } from "../src/setup/ui";
import { runSetup, type SetupDeps } from "../src/setup/wizard";
import type { Step } from "../src/types";
import { fake } from "./helpers";

const NOTION = "ntn\u005fTESTNOTIONSECRET1234567890";
const TG = "123456789:AAFakeTelegramTokenValue_1234567890";
const MAILPASS = "app-pass-SECRET-9876";

/** Scripted answers in order; a prompt with no answer left fails the test. Everything shown is recorded. */
function scripted(answers: (string | boolean | undefined)[]): Ui & { shown: string[]; asked: string[] } {
  const shown: string[] = [], asked: string[] = [];
  const next = (m: string) => { asked.push(m); if (!answers.length) throw new Error(`unexpected prompt: ${m}`); return answers.shift() as never; };
  return {
    shown, asked,
    intro: (t) => shown.push(t), outro: (t) => shown.push(t), note: (b, t) => shown.push(`${t ?? ""} ${b}`), info: (m) => shown.push(m), warn: (m) => shown.push(m),
    password: async (m) => next(m), text: async (m, o) => { const a = next(m); return a === "" && o?.initial ? o.initial : a; }, confirm: async (m) => next(m), choose: async (m) => next(m),
  };
}

const verdicts = (over: Partial<Record<keyof Validators, Verdict>> = {}): Validators & { seen: string[] } => {
  const seen: string[] = [];
  const v = (k: keyof Validators): Verdict => over[k] ?? { state: "valid", detail: "ok" };
  return {
    seen,
    notion: async (t) => { seen.push(t); return v("notion"); },
    telegram: async (t) => { seen.push(t); return v("telegram"); },
  };
};

const NO_STEPS: Step[] = [{ id: "demo.ok", group: "Demo", title: "demo", why: "demo step for tests", verifies: "always true", check: async () => ({ level: "pass", detail: "fine" }) }];
const deps = (ui: Ui, validators: Validators, env: Record<string, string> = {}): SetupDeps => ({ ui, validators, env, steps: NO_STEPS });

describe("hub setup, default (manual-first)", () => {
  it("asks for nothing, stores no token, creates the private folder and runs the steps", async () => {
    const f = fake();
    const ui = scripted([]);
    let ran = false;
    const steps: Step[] = [{ ...NO_STEPS[0]!, check: async () => { ran = true; return { level: "pass", detail: "fine" }; } }];
    const out = await runSetup(f.ctx, { ui, validators: verdicts(), env: {}, steps }, { nonInteractive: true });
    expect(out.exitCode).toBe(0);
    expect(out.stages.map((s) => s.id)).toEqual(["projects"]); // no token stage in the default run (decision 0009)
    expect(ran).toBe(true);
    expect(ui.asked).toEqual([]);
    expect(existsSync(path.join(f.ctx.configDir, "notion-token"))).toBe(false);
    expect(statSync(f.ctx.configDir).mode & 0o777).toBe(0o700);
  });
  it("an interactive default run asks one question, the person's name (P89; Enter skips), and ends with `ready: run hub agent`", async () => {
    const f = fake();
    const ui = scripted([""]);
    const out = await runSetup(f.ctx, { ...deps(ui, verdicts()), askPerson: true }, { nonInteractive: false });
    expect(ui.asked).toHaveLength(1);
    expect(ui.asked[0]).toMatch(/^Your name/);
    expect(ui.shown.join("\n")).toContain("A new instance with no project yet");
    expect(ui.shown.join("\n")).toContain("Personal on this Mac");
    expect(out.exitCode).toBe(0);
    expect(ui.shown.join("\n")).toContain("ready: run hub agent");
  });
});

describe("hub setup, interactive", () => {
  it("asks in order Notion, Telegram and nothing about mail; stores each at mode 600 in a 700 folder", async () => {
    const f = fake();
    const ui = scripted([NOTION, "yes", TG]);
    const out = await runSetup(f.ctx, deps(ui, verdicts()), { nonInteractive: false, automation: true });
    expect(ui.asked.filter((m) => /Paste/.test(m)).map((m) => m.split(" ")[2])).toEqual(["Notion", "bot"]);
    expect(statSync(f.ctx.configDir).mode & 0o777).toBe(0o700);
    for (const n of ["notion-token", "telegram-bot-token"] as const) {
      expect(statSync(path.join(f.ctx.configDir, n)).mode & 0o777).toBe(0o600);
    }
    expect(readFileSync(path.join(f.ctx.configDir, "notion-token"), "utf8").trim()).toBe(NOTION);
    expect(ui.asked.some((m) => /mail|IMAP/i.test(m))).toBe(false);
    expect(readdirSync(f.ctx.configDir).sort()).toEqual(["notion-token", "telegram-bot-token"]);
    expect(out.stages.map((s) => s.status)).toEqual(["stored", "stored", "skipped"]);
    expect(out.exitCode).toBe(0);
    expect(out.ownerOnly.join("\n")).toContain("Connections");
  });

  it("never shows or logs a secret", async () => {
    const f = fake();
    const logs: string[] = [];
    f.ctx.log = (m) => logs.push(m);
    const ui = scripted([NOTION, "", "no"]);
    await runSetup(f.ctx, deps(ui, verdicts({ notion: { state: "invalid", detail: `rejected ${NOTION}` } })), { nonInteractive: false, automation: true }).catch(() => {});
    const all = [...ui.shown, ...logs].join("\n");
    for (const s of [NOTION, TG]) expect(all).not.toContain(s);
  });

  it("is resumable and idempotent: a second run asks nothing about stored tokens and changes no file", async () => {
    const f = fake();
    const first = scripted([NOTION, "no"]);
    await runSetup(f.ctx, deps(first, verdicts()), { nonInteractive: false, automation: true });
    const before = ["notion-token"].map((n) => statSync(path.join(f.ctx.configDir, n)).mtimeMs);
    const second = scripted(["no"]); // optional Telegram: skip again
    const out = await runSetup(f.ctx, deps(second, verdicts()), { nonInteractive: false, automation: true });
    expect(second.asked.some((m) => /Paste/.test(m))).toBe(false);
    expect(out.stages.slice(0, 1).map((s) => s.status)).toEqual(["ok"]);
    expect(["notion-token"].map((n) => statSync(path.join(f.ctx.configDir, n)).mtimeMs)).toEqual(before);
  });

  it("resumes after a cancel: the stored token survives, the rest is asked again", async () => {
    const f = fake();
    const ui = scripted([NOTION, undefined]); // cancel at the optional Telegram question
    const out = await runSetup(f.ctx, deps(ui, verdicts()), { nonInteractive: false, automation: true });
    expect(out.exitCode).toBe(1);
    expect(existsSync(path.join(f.ctx.configDir, "notion-token"))).toBe(true);
    const again = scripted(["no"]);
    const out2 = await runSetup(f.ctx, deps(again, verdicts()), { nonInteractive: false, automation: true });
    expect(out2.stages[0]!.status).toBe("ok");
    expect(out2.exitCode).toBe(0);
  });

  it("a rejected token is not stored; empty input leaves the stage for later", async () => {
    const f = fake();
    const ui = scripted(["bad-token-value-long-enough", "", "no"]);
    const out = await runSetup(f.ctx, deps(ui, verdicts({ notion: { state: "invalid", detail: "auth problem" } })), { nonInteractive: false, automation: true });
    expect(existsSync(path.join(f.ctx.configDir, "notion-token"))).toBe(false);
    expect(out.stages[0]!.status).toBe("missing");
    expect(out.exitCode).toBe(1);
  });

  it("an unreachable service asks before storing unverified", async () => {
    const f = fake();
    const ui = scripted([NOTION, true, "no"]);
    const out = await runSetup(f.ctx, deps(ui, verdicts({ notion: { state: "unverified", detail: "offline" } })), { nonInteractive: false, automation: true });
    expect(out.stages.slice(0, 1).map((s) => s.status)).toEqual(["unverified"]);
    expect(existsSync(path.join(f.ctx.configDir, "notion-token"))).toBe(true);
  });

  it("tightens a loose mode on a stored token", async () => {
    const f = fake();
    await runSetup(f.ctx, deps(scripted([NOTION, "no"]), verdicts()), { nonInteractive: false, automation: true });
    chmodSync(path.join(f.ctx.configDir, "notion-token"), 0o644);
    await runSetup(f.ctx, deps(scripted(["no"]), verdicts()), { nonInteractive: false, automation: true });
    expect(statSync(path.join(f.ctx.configDir, "notion-token")).mode & 0o777).toBe(0o600);
  });

  it("dry run writes nothing", async () => {
    const f = fake({ dryRun: true });
    const ui = scripted([NOTION, "no"]);
    await runSetup(f.ctx, deps(ui, verdicts()), { nonInteractive: false, automation: true });
    expect(existsSync(f.ctx.configDir)).toBe(false);
  });
});

describe("hub setup --non-interactive", () => {
  it("reads tokens from env and from *_FILE, asks nothing", async () => {
    const f = fake();
    const file = path.join(f.home, "n.txt");
    writeFileSync(file, NOTION + "\n");
    const out = await runSetup(f.ctx, deps(scripted([]), verdicts(), { HUB_NOTION_TOKEN_FILE: file }), { nonInteractive: true, automation: true });
    expect(out.stages.map((s) => s.status)).toEqual(["stored", "skipped", "skipped"]);
    expect(out.exitCode).toBe(0);
    expect(readFileSync(path.join(f.ctx.configDir, "notion-token"), "utf8").trim()).toBe(NOTION);
  });

  it("fails with a clear list when required tokens are missing, and installs nothing", async () => {
    const f = fake();
    let installed = false;
    const steps: Step[] = [{ ...NO_STEPS[0]!, check: async () => ({ level: "fail", detail: "x" }), apply: async () => { installed = true; return "did"; } }];
    const ui = scripted([]);
    const out = await runSetup(f.ctx, { ui, validators: verdicts(), env: {}, steps }, { nonInteractive: true, automation: true });
    expect(out.exitCode).toBe(1);
    expect(installed).toBe(false);
    const text = ui.shown.join("\n");
    expect(text).toContain("notion.token");
    expect(text).toContain("HUB_NOTION_TOKEN");
  });

  it("a rejected env token fails and stores nothing", async () => {
    const f = fake();
    const out = await runSetup(f.ctx, deps(scripted([]), verdicts({ notion: { state: "invalid", detail: "rejected (401)" } }), { HUB_NOTION_TOKEN: NOTION }), { nonInteractive: true, automation: true });
    expect(out.exitCode).toBe(1);
    expect(existsSync(path.join(f.ctx.configDir, "notion-token"))).toBe(false);
  });

  it("has no mail stage: a mail login in the environment is not read and nothing is stored (decision 0026)", async () => {
    const f = fake();
    const env = { HUB_NOTION_TOKEN: NOTION, HUB_MAIL_ACCOUNT: "Work", HUB_MAIL_HOST: "imap.example.test", HUB_MAIL_USER: "me@example.test", HUB_MAIL_PASS: MAILPASS };
    const out = await runSetup(f.ctx, deps(scripted([]), verdicts(), env), { nonInteractive: true, automation: true });
    expect(out.stages.map((s) => s.id)).toEqual(["notion.token", "messengers.token", "projects"]);
    expect(readdirSync(f.ctx.configDir)).toEqual(["notion-token"]);
    expect(JSON.stringify(out)).not.toContain(MAILPASS);
  });
});

describe("validators go through injected clients", () => {
  it("notion: 200 valid, 401 invalid, network error unverified; the token only goes in the header", async () => {
    const f = fake();
    const seen: { url: string; auth: string | null }[] = [];
    const answer = (status: number | "throw") => makeValidators({ ...f.ctx, fetch: (async (u: string, i: RequestInit) => {
      seen.push({ url: String(u), auth: new Headers(i.headers).get("authorization") });
      if (status === "throw") throw new TypeError("fetch failed");
      return new Response("{}", { status });
    }) as never });
    expect((await answer(200).notion(NOTION)).state).toBe("valid");
    expect((await answer(401).notion(NOTION)).state).toBe("invalid");
    const off = await answer("throw").notion(NOTION);
    expect(off.state).toBe("unverified");
    expect(off.detail).not.toContain(NOTION);
    expect(seen[0]).toEqual({ url: "https://api.notion.com/v1/users/me", auth: `Bearer ${NOTION}` });
  });

  it("telegram: getMe, shape check without a call", async () => {
    const f = fake();
    let calls = 0;
    const v = makeValidators({ ...f.ctx, fetch: (async () => { calls++; return new Response(JSON.stringify({ ok: true, result: { username: "hubbot" } })); }) as never });
    expect(await v.telegram("nope")).toMatchObject({ state: "invalid" });
    expect(calls).toBe(0);
    expect(await v.telegram(TG)).toMatchObject({ state: "valid", detail: "bot @hubbot" });
  });
});

import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hubPaths } from "@hub/config/paths";
import { agentChecks, type AgentProbe } from "../src/checks";
import { cliDetector, DETECT_SCRIPT, detectClis, INSTALL_LINE, LOGIN_LINE, parseDetect, pickPreset, searchDirs, unknownFacts, type CliFact, type DetectRun } from "../src/detect";

// The detector (P57) on a fake run: no shell starts, no CLI runs.

const fence = (key: string, out: string, code = 0) => `\n__HUB_BEGIN__ ${key}\n${out}\n__HUB_END__ ${key} ${code}\n`;
const READY_CLAUDE = fence("claude.path", "/u/bin/claude") + fence("claude.version", "2.1.220 (Claude Code)\n") + fence("claude.auth", JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "x@y" }, null, 2));
const READY_CODEX = fence("codex.path", "/u/bin/codex") + fence("codex.version", "codex-cli 0.146.0\n") + fence("codex.auth", "Logged in using ChatGPT\n");
const runOf = (stdout: string, code = 0): DetectRun & { calls: Array<{ cmd: string; args: string[] }> } => {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const r = async (cmd: string, args: string[]) => { calls.push({ cmd, args }); return { code, stdout, stderr: "" }; };
  return Object.assign(r, { calls });
};
const state = (facts: CliFact[]) => facts.map((f) => [f.cli, f.state, f.version]);

describe("detectClis", () => {
  it("runs ONE login shell with the script, and reads both CLIs ready", async () => {
    const run = runOf("Last login: Thu\nnvm: using v22\n" + READY_CLAUDE + READY_CODEX);
    const facts = await detectClis({ shell: "/bin/zsh", env: {}, run });
    expect(run.calls).toEqual([{ cmd: "/bin/zsh", args: ["-l", "-i", "-c", DETECT_SCRIPT] }]);
    expect(state(facts)).toEqual([["claude", "ready", "2.1.220"], ["codex", "ready", "0.146.0"]]);
    expect(facts[0]).toMatchObject({ path: "/u/bin/claude", detail: "2.1.220 · signed in (claude.ai)", fix: null });
    expect(JSON.stringify(facts)).not.toContain("x@y");
  });
  it("Claude signed out (exit 1, loggedIn false) and Codex 'Not logged in' are signed-out with the login line", async () => {
    const out = fence("claude.path", "/u/bin/claude") + fence("claude.version", "2.1.220 (Claude Code)") + fence("claude.auth", '{"loggedIn": false, "authMethod": "none"}', 1)
      + fence("codex.path", "/u/bin/codex") + fence("codex.version", "codex-cli 0.146.0") + fence("codex.auth", "Not logged in", 1);
    const facts = await detectClis({ shell: "/bin/zsh", env: {}, run: runOf(out) });
    expect(facts.map((f) => [f.state, f.fix])).toEqual([["signed-out", LOGIN_LINE.claude], ["signed-out", LOGIN_LINE.codex]]);
  });
  it("a missing CLI is missing with the install line; a binary that does not start is missing too", async () => {
    const out = fence("claude.path", "") + fence("codex.path", "/old/codex") + fence("codex.version", "Error: spawn /old/vendor/codex ENOENT", 1);
    const facts = await detectClis({ shell: "/bin/zsh", env: {}, run: runOf(out) });
    expect(facts.map((f) => [f.state, f.fix])).toEqual([["missing", INSTALL_LINE.claude], ["missing", INSTALL_LINE.codex]]);
    expect(facts[1]!.detail).toContain("ENOENT");
  });
  it("a hung login shell answers unknown at the timeout; junk with no fences is unknown", async () => {
    expect(state(await detectClis({ shell: "/bin/zsh", env: {}, run: runOf("", 124), timeoutMs: 15_000 }))).toEqual([["claude", "unknown", null], ["codex", "unknown", null]]);
    const junk = await detectClis({ shell: "/bin/zsh", env: {}, run: runOf("zsh: no job control\n__HUB_BEGIN__ claude.path\n/x") });
    expect(junk.every((f) => f.state === "unknown")).toBe(true);
  });
});

// Tier 1 (measured 2026-11-19 under launchd: the login shell did not answer in 15 s, both CLIs read unknown).
describe("detectClis: direct first, the login shell only for what is not settled", () => {
  const CLAUDE_JSON = JSON.stringify({ loggedIn: true, authMethod: "claude.ai" });
  /** A direct run: answers by binary and verb; the login shell gets `login` (fenced output). */
  const directRun = (o: { codexVersion?: { code: number; stdout: string }; login?: string; loginCode?: number } = {}) => {
    const calls: string[] = [];
    const r: DetectRun = async (cmd, args, env) => {
      calls.push(`${path.basename(cmd)} ${args[0] === "-l" ? "-l" : args.join(" ")}`);
      if (cmd === "/bin/zsh") return { code: o.loginCode ?? 0, stdout: o.login ?? "", stderr: "" };
      expect(env?.PATH?.split(":")[0]).toBe(path.dirname(cmd));
      if (args[0] === "--version") return cmd.endsWith("codex") ? { stderr: "", ...(o.codexVersion ?? { code: 0, stdout: "codex-cli 0.146.0\n" }) } : { code: 0, stdout: "2.1.220 (Claude Code)\n", stderr: "" };
      if (cmd.endsWith("claude")) return { code: 0, stdout: CLAUDE_JSON, stderr: "" };
      return { code: 0, stdout: "", stderr: "Logged in using ChatGPT\n" };
    };
    return Object.assign(r, { calls });
  };
  const locate = (cli: "claude" | "codex") => `/nvm/v22.22.0/bin/${cli}`;

  it("both found and settled: no login shell at all", async () => {
    const run = directRun();
    const facts = await detectClis({ shell: "/bin/zsh", env: { PATH: "/usr/bin" }, run, locate });
    expect(state(facts)).toEqual([["claude", "ready", "2.1.220"], ["codex", "ready", "0.146.0"]]);
    expect(facts[0]).toMatchObject({ path: "/nvm/v22.22.0/bin/claude", detail: "2.1.220 · signed in (claude.ai)" });
    expect(facts[1]!.detail).toBe("0.146.0 · Logged in using ChatGPT");
    expect(run.calls.some((c) => c.includes("-l"))).toBe(false);
  });
  it("a binary that does not start falls through to the login shell, which may know a working one", async () => {
    const run = directRun({ codexVersion: { code: 1, stdout: "Error: spawn ENOENT" }, login: READY_CODEX });
    const facts = await detectClis({ shell: "/bin/zsh", env: {}, run, locate });
    expect(state(facts)).toEqual([["claude", "ready", "2.1.220"], ["codex", "ready", "0.146.0"]]);
    expect(facts[1]!.path).toBe("/u/bin/codex");
    expect(run.calls.filter((c) => c.includes("-l"))).toHaveLength(1);
  });
  it("not found directly and a hung login shell: unknown with the shell's reason; a found one keeps its direct fact", async () => {
    const run = directRun({ loginCode: 124 });
    const facts = await detectClis({ shell: "/bin/zsh", env: {}, run, locate: (cli) => (cli === "claude" ? locate(cli) : null), timeoutMs: 45_000 });
    expect(state(facts)).toEqual([["claude", "ready", "2.1.220"], ["codex", "unknown", null]]);
    expect(facts[1]!.detail).toBe("the login shell did not answer in 45 s");
  });
  it("searches the server's node folder, then PATH, then the home folders; finds only an executable file", () => {
    expect(searchDirs({ PATH: "/a:relative::/b:/a", HOME: "/h" }, ["/node/bin"])).toEqual(["/node/bin", "/a", "/b", "/h/.local/bin", "/h/.claude/local"]);
  });
  it("the default locate finds an executable on PATH and ignores a plain file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hub-detect-"));
    writeFileSync(path.join(dir, "claude"), "#!/bin/sh\n");
    chmodSync(path.join(dir, "claude"), 0o755);
    writeFileSync(path.join(dir, "codex"), "not executable");
    const run = directRun({ login: fence("codex.path", "") });
    const facts = await detectClis({ shell: "/bin/zsh", env: { PATH: dir }, run });
    expect(facts[0]).toMatchObject({ state: "ready", path: path.join(dir, "claude") });
    expect(facts[1]).toMatchObject({ state: "missing", fix: INSTALL_LINE.codex });
  });
});

describe("parseDetect", () => {
  it("profile output inside the stream does not break the fences", () => {
    const m = parseDetect(`banner\r\n${READY_CLAUDE}more banner`);
    expect(m.get("claude.version")).toEqual({ out: "2.1.220 (Claude Code)", code: 0 });
  });
});

const f = (cli: "claude" | "codex", s: CliFact["state"]): CliFact => ({ cli, state: s, path: null, version: s === "missing" ? null : "1.0.0", detail: "", fix: s === "signed-out" ? LOGIN_LINE[cli] : s === "missing" ? INSTALL_LINE[cli] : null });

describe("pickPreset", () => {
  it.each([
    ["ready Claude", [f("claude", "ready"), f("codex", "ready")], "claude", true, "claude", null],
    ["ready Codex only", [f("claude", "missing"), f("codex", "ready")], "claude", true, "codex", "Codex: Claude Code is not installed · npm i -g @anthropic-ai/claude-code"],
    ["Claude signed out, Codex ready", [f("claude", "signed-out"), f("codex", "ready")], "claude", true, "codex", "Codex: Claude Code is not signed in · claude auth login"],
    ["Claude signed out, Codex missing", [f("claude", "signed-out"), f("codex", "missing")], "claude", true, "claude", "Claude Code is not signed in · claude auth login"],
    ["Codex signed out is never picked by itself", [f("claude", "missing"), f("codex", "signed-out")], "claude", true, "shell", "Shell: Claude Code is not installed · npm i -g @anthropic-ai/claude-code"],
    ["neither", [f("claude", "missing"), f("codex", "missing")], "claude", true, "shell", "Shell: Claude Code is not installed · npm i -g @anthropic-ai/claude-code"],
    ["no project", [f("claude", "ready"), f("codex", "ready")], "claude", false, "shell", null],
    ["agent.default codex", [f("claude", "ready"), f("codex", "ready")], "codex", true, "codex", null],
    ["unknown keeps the config order", unknownFacts("hung"), "claude", true, "claude", null],
  ] as const)("%s", (_n, facts, def, hasProject, preset, why) => {
    expect(pickPreset(facts, def, hasProject)).toEqual({ preset, why });
  });
  it("no facts yet: the config order", () => {
    expect(pickPreset(null, "codex", true)).toEqual({ preset: "codex", why: null });
  });
});

describe("cliDetector", () => {
  it("one run at a time; a ready answer is kept, a not-ready one only 60 s; refresh runs again", async () => {
    let t = 0;
    let n = 0;
    let facts: CliFact[] = [f("claude", "ready"), f("codex", "ready")];
    const d = cliDetector({ detect: async () => { n++; return facts; }, now: () => t });
    expect(d.peek()).toBeNull();
    await Promise.all([d.get(), d.get()]);
    expect(n).toBe(1);
    t = 5 * 60_000;
    await d.get();
    expect(n).toBe(1);
    facts = [f("claude", "signed-out"), f("codex", "ready")];
    await d.refresh();
    expect(n).toBe(2);
    t += 61_000;
    await d.get();
    expect(n).toBe(3);
    expect(d.peek()?.facts[0]?.state).toBe("signed-out");
  });
});

describe("Agent tools rows 1 and 2 come from the facts", () => {
  const probe: AgentProbe = { run: async () => ({ code: 1, stdout: "", stderr: "" }), mcp: async () => ({ ok: false, tools: [], detail: "off" }) };
  const home = mkdtempSync(path.join(tmpdir(), "hub-agent-detect-"));
  mkdirSync(path.join(home, "projects", "acme"), { recursive: true });
  const paths = hubPaths({ home, env: {} });
  const rows = async (facts: CliFact[], cli: "claude" | "codex") => Object.fromEntries((await agentChecks({ paths, slug: "acme", cli, unattended: false, probe, facts })).map((r) => [r.id, r]));
  it("Claude signed in is a pass now (it was a skip before P57); signed out fails with claude auth login", async () => {
    expect((await rows([{ ...f("claude", "ready"), version: "2.1.220", detail: "2.1.220 · signed in (claude.ai)" }], "claude"))["cli.signed-in"]).toMatchObject({ state: "pass", detail: "signed in (claude.ai)" });
    expect((await rows([{ ...f("claude", "signed-out"), version: "2.1.220" }], "claude"))["cli.signed-in"]).toMatchObject({ state: "fail", fix: "claude auth login" });
  });
  it("unknown is a warning, never a pass", async () => {
    expect((await rows(unknownFacts("hung"), "codex"))["cli.version"]!.state).toBe("warn");
  });
});

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { INSTALL_LINE, LOGIN_LINE, unknownFacts, type CliFact } from "@hub/agent/detect";
import { install } from "../src/runner";
import { agentSteps, clisRow, summarise } from "../src/steps/agent";
import { CONFIG_KEYS, fileSteps } from "../src/steps/files";
import { STEPS } from "../src/steps/index";
import { fake } from "./helpers";

// The `Agent` doctor group (P49 5B): the rows reduce to one line per project and CLI; the terminal row (always on, decision
// 0032) runs the server's readiness check on a fake core, and the CLI row (P66) says each CLI's state with its fix.

describe("the Agent doctor group", () => {
  it("one line per CLI: the worst row wins and carries its fix", () => {
    const row = (state: "pass" | "warn" | "fail" | "skip", fix: string | null = null) => ({ id: state, cli: "codex" as const, title: `t-${state}`, state, detail: "d", fix });
    expect(summarise([row("pass"), row("skip")]).level).toBe("pass");
    expect(summarise([row("pass"), row("warn", "codex mcp login notion")])).toEqual({ level: "warn", detail: "t-warn: d (fix: codex mcp login notion)" });
    expect(summarise([row("warn", "x"), row("fail", "hub agent acme --cli codex --prepare")]).detail).toBe("t-fail: d (fix: hub agent acme --cli codex --prepare)");
  });
  it("the tools row is an audit (doctor --fast leaves it out); the terminal row is not", () => {
    expect(STEPS.find((s) => s.id === "agent.tools")?.audit).toBe(true);
    expect(STEPS.find((s) => s.id === "agent.terminal")?.audit).toBeUndefined();
  });
  it("the terminal and CLI rows are the install workflow's (not audit); the terminal row applies, the CLI row is manual", () => {
    for (const id of ["agent.terminal", "agent.clis"]) expect(STEPS.find((s) => s.id === id)?.audit, id).toBeUndefined();
    expect(agentSteps.find((s) => s.id === "agent.terminal")?.apply).toBeTypeOf("function");
    expect(agentSteps.find((s) => s.id === "agent.clis")?.manual?.steps.length).toBeGreaterThan(0);
  });
  it("decision 0032: no terminal switch; a leftover terminal key is a key nothing reads (WARN by name)", async () => {
    expect(CONFIG_KEYS).toContain("agent");
    expect(CONFIG_KEYS).not.toContain("terminal");
    const f = fake();
    writeFileSync(f.ctx.paths.configFile, JSON.stringify({ terminal: { enabled: true }, agent: { default: "claude" } }));
    const r = await fileSteps.find((s) => s.id === "files.config-keys")!.check(f.ctx);
    expect(r).toEqual({ level: "warn", detail: "config.json has key(s) nothing reads: terminal. Delete them; the keys the hub reads are listed in this step's page" });
  });
  it("a 644 spawn-helper fails the terminal row with its fix; apply sets +x through the runner and the recheck passes", async () => {
    const f = fake();
    const core = realpathSync(mkdtempSync(path.join(tmpdir(), "hub-core-")));
    const term = path.join(core, "app", "packages", "terminal");
    mkdirSync(term, { recursive: true });
    writeFileSync(path.join(term, "package.json"), "{}");
    const pty = path.join(core, "app", "node_modules", "node-pty");
    const helper = path.join(pty, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
    mkdirSync(path.dirname(helper), { recursive: true });
    writeFileSync(path.join(pty, "package.json"), JSON.stringify({ name: "node-pty", main: "index.js" }));
    writeFileSync(path.join(pty, "index.js"), "module.exports = {};");
    writeFileSync(helper, "#!/bin/sh\n");
    chmodSync(helper, 0o644);
    // A port nothing listens on and no server: only the readiness decides.
    const ctx = { ...f.ctx, paths: { ...f.ctx.paths, core }, fetch: (async () => { throw new Error("no server"); }) as typeof fetch, run: async () => ({ code: 1, stdout: "", stderr: "" }) };
    const step = agentSteps.find((s) => s.id === "agent.terminal")!;
    expect(await step.check(ctx)).toEqual({ level: "fail", detail: `node-pty's spawn-helper is not executable (${helper}) (fix: chmod +x ${helper})` });
    expect(statSync(helper).mode & 0o777).toBe(0o644); // the doctor's check changes nothing
    const [report] = await install(ctx, [step]);
    expect(report).toMatchObject({ outcome: "changed", detail: `set the execute bit on ${helper}` });
    expect(statSync(helper).mode & 0o777).toBe(0o755);
    expect(await step.check(ctx)).toEqual({ level: "pass", detail: "ready (the server is not running)" });
  });
  it("the CLI row: one clause per CLI with its fix, what the column starts, WARN when one is not ready, never FAIL", () => {
    const fact = (cli: "claude" | "codex", state: CliFact["state"], version: string | null = "2.1.220"): CliFact => ({ cli, state, path: null, version, detail: `${cli} ${state}`, fix: state === "missing" ? INSTALL_LINE[cli] : state === "signed-out" ? LOGIN_LINE[cli] : null });
    expect(clisRow([fact("claude", "ready"), fact("codex", "ready", "0.48.0")], "claude")).toEqual({ level: "pass", detail: "Claude Code 2.1.220 ready; Codex 0.48.0 ready; opening the column starts Claude Code" });
    expect(clisRow([fact("claude", "ready"), fact("codex", "missing", null)], "claude")).toEqual({ level: "warn", detail: "Claude Code 2.1.220 ready; Codex missing (fix: npm i -g @openai/codex); opening the column starts Claude Code" });
    const signedOut = clisRow([fact("claude", "signed-out"), fact("codex", "ready", "0.48.0")], "claude");
    expect(signedOut.level).toBe("warn");
    expect(signedOut.detail).toBe("Claude Code 2.1.220 not signed in (fix: claude auth login); Codex 0.48.0 ready; opening the column starts Codex (Codex: Claude Code is not signed in · claude auth login)");
    const hung = clisRow(unknownFacts("the login shell did not answer in 15 s"), "claude");
    expect(hung.level).toBe("warn");
    expect(hung.detail).toContain("Claude Code not checked (the login shell did not answer in 15 s)");
    for (const r of [signedOut, hung, clisRow([fact("claude", "missing", null), fact("codex", "missing", null)], "codex")]) expect(r.level).not.toBe("fail");
  });
});

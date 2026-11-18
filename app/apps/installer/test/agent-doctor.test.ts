import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { agentSteps, summarise } from "../src/steps/agent";
import { CONFIG_KEYS } from "../src/steps/files";
import { STEPS } from "../src/steps/index";
import { fake } from "./helpers";

// The `Agent` doctor group (P49 5B): the rows reduce to one line per project and CLI; the terminal row reads the switch.

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
  it("the instance switches are keys the settings check knows (no 'nothing reads' warning for them)", () => {
    expect(CONFIG_KEYS).toEqual(expect.arrayContaining(["terminal", "agent"]));
  });
  it("the terminal row passes when it is off, the default", async () => {
    const f = fake();
    writeFileSync(path.join(f.root, "config", "config.json"), JSON.stringify({}));
    const step = agentSteps.find((s) => s.id === "agent.terminal")!;
    expect(await step.check(f.ctx)).toEqual({ level: "pass", detail: "off (terminal.enabled in config/config.json)" });
  });
});

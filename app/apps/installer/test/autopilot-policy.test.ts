import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CODEX_FORBIDDEN_PREFIXES, HUB_SEND_COMMANDS } from "@hub/agent/deny";
import { HUB_MCP_ATTENDED_TOOLS, HUB_MCP_TOOLS } from "@hub/agent/mcp";
import { claudeProtectedPaths, protectedPaths } from "@hub/agent/session";
import { policyFile, readSendPolicy } from "@hub/projects/send-policy";
import { runPolicyCommand } from "../src/send/policy-command";
import { anyRecipients, makeInstance } from "./instance-fixture";

// P139 A1 (decision 0048 point 2, verdicts 5 and 31), pinned: no agent path writes the autopilot's switches. The CLI refuses inside
// a session, the deny rules forbid the command anyway, both files are protected paths in every mode, and hub mcp has no tool for it.

const projectMd = ["# T", "", "## Settings", "", "| Field | Value | Answered | By |", "|---|---|---|---|", "| schema | 1 | 2026-11-14 | agent |", "| status | active | 2026-11-14 | agent |", "| mail.accounts | a@t.example | 2026-11-14 | agent |", "", "## Notion databases", "", "- clients: 00000000-0000-4000-8000-000000000001", ""].join("\n");

function instance() {
  const inst = makeInstance();
  mkdirSync(path.join(inst.paths.projects, "t"), { recursive: true });
  writeFileSync(path.join(inst.paths.projects, "t", "project.md"), projectMd);
  anyRecipients(inst.paths.stateProjects, "t");
  return inst;
}

const run = (args: string[], inst: ReturnType<typeof instance>, env: NodeJS.ProcessEnv) => {
  const out: string[] = [];
  const code = runPolicyCommand(["autopilot", ...args], { projectsDir: inst.paths.projects, policyDir: inst.paths.stateProjects, env, out: (l) => out.push(l), now: () => new Date("2026-11-24T10:00:00Z") });
  return { code, out: out.join("\n") };
};

describe("hub send policy autopilot (verdict 31)", () => {
  it("writes one change in the owner's shell, through the send policy's writer", () => {
    const inst = instance();
    expect(run(["t", "mode", "dry_run"], inst, {}).code).toBe(0);
    const r = run(["t", "chat", "telegram_user:1001", "on"], inst, {});
    expect(r).toEqual({ code: 0, out: "t: autopilot dry_run; chats telegram_user:1001; disclose daily; quiet off" });
    expect(readSendPolicy(inst.paths.stateProjects, "t", "generic").policy).toMatchObject({ recipients: "any", by: "owner", autopilot: { mode: "dry_run", chats: ["telegram_user:1001"] } });
    expect(run(["t", "mode", "always"], inst, {}).code).toBe(2);
  });

  it("refuses inside an agent session before reading anything (Claude's shell, or one hub agent bound)", () => {
    const inst = instance();
    for (const env of [{ CLAUDECODE: "1" }, { HUB_PROJECT: "t" }]) {
      const r = run(["t", "mode", "on"], inst, env);
      expect(r.code).toBe(2);
      expect(r.out).toMatch(/never inside an agent session/);
    }
    expect(readSendPolicy(inst.paths.stateProjects, "t", "generic").policy.autopilot).toBeUndefined();
    expect(existsSync(policyFile(inst.paths.stateProjects, "t"))).toBe(true);
  });
});

describe("no agent path reaches the autopilot's switches (pinned)", () => {
  it("the deny rules forbid the command in Claude and Codex, as every hub send", () => {
    expect(HUB_SEND_COMMANDS).toContain("Bash(*hub send*)");
    expect(CODEX_FORBIDDEN_PREFIXES).toContainEqual(["hub", "send"]);
  });

  it("both files are protected paths in every mode: the instance switch and the policy folder", () => {
    const { paths } = makeInstance();
    expect(paths.autopilot).toBe(path.join(paths.state, "autopilot.json"));
    for (const list of [protectedPaths(paths), claudeProtectedPaths(paths)]) {
      expect(list).toContain(paths.autopilot);
      expect(list).toContain(paths.stateProjects);
    }
  });

  it("hub mcp has no tool that names the autopilot", () => {
    for (const t of [...HUB_MCP_TOOLS, ...HUB_MCP_ATTENDED_TOOLS]) expect(t).not.toMatch(/autopilot/);
  });
});

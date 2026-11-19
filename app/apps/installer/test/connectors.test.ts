import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { KINDS, readConnectorAccounts } from "@hub/agent/connectors";
import { claudeEnforcementArgs } from "@hub/agent/claude";
import { CODEX_FORBIDDEN_PREFIXES, denyRules } from "@hub/agent/deny";
import { sessionInstructions } from "@hub/agent/session-rules";
import { addConnector, listConnectors, stateAccount } from "../src/connectors-command";
import { runGuard, runGuardPost, writeCodexHome, writeSessionFiles } from "../src/safety";
import { makeInstance } from "./instance-fixture";

// P62 K1/K3: a session file carries its own project's connectors only, every write of theirs is denied, the guard refuses a
// connector write in every mode, and `hub connectors` writes the instance's MCP files (the agent is denied add and account).

const CLIENT = "123-abc.apps.googleusercontent.com";

function setup() {
  const inst = makeInstance(["acme-travel", "nordhaus"]);
  writeFileSync(path.join(inst.paths.configDir, "mcp.json"), JSON.stringify({ mcpServers: { "mail-mcp": { type: "http", url: "http://localhost:8787" } } }));
  addConnector(inst.paths, { kind: "calendar", name: "gcal-acme", clientId: CLIENT, account: "owner@acme.example" });
  addConnector(inst.paths, { kind: "drive", name: "gdrive-acme", clientId: CLIENT });
  addConnector(inst.paths, { kind: "calendar", name: "gcal-nord", clientId: CLIENT, callbackPort: 8765 });
  const md = (slug: string) => path.join(inst.paths.projects, slug, "project.md");
  const add = (slug: string, field: string, v: string) => {
    const t = readFileSync(md(slug), "utf8").replace("| schema | 1 |", `| ${field} | ${v} | 2026-11-20 | owner |\n| schema | 1 |`);
    writeFileSync(md(slug), t);
  };
  add("acme-travel", "calendar.connector", "gcal-acme");
  add("acme-travel", "drive.connector", "gdrive-acme");
  add("nordhaus", "calendar.connector", "gcal-nord");
  return inst;
}

describe("hub connectors", () => {
  it("add writes config/mcp.json and .mcp.json, never a secret; list names the account and the project", () => {
    const { paths } = setup();
    const src = JSON.parse(readFileSync(path.join(paths.configDir, "mcp.json"), "utf8")).mcpServers;
    expect(src["gcal-acme"]).toEqual({ type: "http", url: KINDS.calendar.url, oauth: { clientId: CLIENT } });
    expect(src["gcal-nord"].oauth.callbackPort).toBe(8765);
    expect(JSON.parse(readFileSync(paths.mcpFile, "utf8")).mcpServers["gdrive-acme"].url).toBe(KINDS.drive.url);
    expect(readFileSync(paths.mcpFile, "utf8")).not.toMatch(/secret/i);
    const list = listConnectors(paths);
    expect(list).toMatch(/gcal-acme\s+Calendar\s+owner@acme.example \(stated \d{4}-\d{2}-\d{2}\)\s+attached to acme-travel/);
    expect(list).toMatch(/gcal-nord\s+Calendar\s+account not known\s+attached to nordhaus/);
    expect(stateAccount(paths, "gdrive-acme", "Owner@Acme.example")).toBe("gdrive-acme: owner@acme.example (stated)");
    expect(() => addConnector(paths, { kind: "calendar", name: "gdrive-x", clientId: CLIENT })).toThrow(/gcal-<label>/);
    expect(() => addConnector(paths, { kind: "drive", name: "gdrive-x", clientId: "nope" })).toThrow(/client id/);
  });

  it("a session is denied add and account, in both CLIs", () => {
    const { paths } = setup();
    const rules = denyRules(paths.projects, paths.home, "acme-travel", paths);
    expect(rules).toEqual(expect.arrayContaining(["Bash(*connectors add*)", "Bash(*connectors account*)"]));
    expect(CODEX_FORBIDDEN_PREFIXES).toContainEqual(["hub", "connectors", "add"]);
  });
});

describe("session files: one project's connectors, their writes off", () => {
  it("acme gets gcal-acme and gdrive-acme, never nordhaus's; the writes are denied by name", () => {
    const { paths } = setup();
    const f = writeSessionFiles(paths.home, paths.projects, "acme-travel", process.execPath, paths);
    const servers = Object.keys(JSON.parse(readFileSync(f.mcp, "utf8")).mcpServers);
    expect(servers).toEqual(expect.arrayContaining(["gcal-acme", "gdrive-acme"]));
    expect(servers).not.toContain("gcal-nord");
    const args = claudeEnforcementArgs(f).join(" ");
    for (const t of ["mcp__gcal-acme__delete_event", "mcp__gcal-acme__respond_to_event", "mcp__gdrive-acme__share_file", "mcp__gdrive-acme__create_file"]) {
      expect(f.rules).toContain(t);
      expect(args).toContain(t);
    }
    expect(f.rules).not.toContain("mcp__gcal-acme__create_event");
    const nord = writeSessionFiles(paths.home, paths.projects, "nordhaus", process.execPath, paths);
    expect(Object.keys(JSON.parse(readFileSync(nord.mcp, "utf8")).mcpServers)).not.toContain("gcal-acme");
  });

  it("Codex homes get no connector (no client-id sign-in); its instructions say so", () => {
    const { paths } = setup();
    const instructions = sessionInstructions(paths.home, paths.projects, "acme-travel");
    expect(instructions).toMatch(/calendar and drive: not in Codex sessions \(gcal-acme, gdrive-acme/);
    const home = writeCodexHome({ paths, projectsDir: paths.projects, slug: "acme-travel", unattended: false, instructions, env: { HOME: paths.home } });
    expect(readFileSync(path.join(home, "config.toml"), "utf8")).not.toMatch(/\[mcp_servers\."g(cal|drive)-/);
  });
});

describe("the guard on connector calls", () => {
  const call = (name: string, input: unknown) => JSON.stringify({ session_id: "S1", tool_name: name, tool_input: input });
  it("refuses a write in warn mode too; a read and a clean hold pass", () => {
    const { paths } = setup();
    const env = { HUB_PROJECT: "acme-travel", HUB_HOME: paths.home } as NodeJS.ProcessEnv;
    const g = (name: string, input: unknown = {}) => runGuard(call(name, input), { root: paths.home, projectsDir: paths.projects, env, paths });
    expect(g("mcp__gcal-acme__delete_event").code).toBe(2);
    expect(g("mcp__gdrive-acme__share_file").code).toBe(2);
    expect(g("mcp__gcal-nord__list_events").code).toBe(2);
    const guest = g("mcp__gcal-acme__create_event", { summary: "x", startTime: "a", endTime: "b", attendees: [{ email: "c@client.example" }] });
    expect(guest.code).toBe(2);
    expect(guest.stderr).toMatch(/hub guard \(block\): .*no guests/);
    expect(g("mcp__gcal-acme__list_events").code).toBe(0);
    expect(g("mcp__gcal-acme__create_event", { summary: "Follow-up [hub-event project=acme-travel]", startTime: "a", endTime: "b" }).code).toBe(0);
  });
  it("the post hook records the account a session's list_calendars shows", () => {
    const { paths } = setup();
    const env = { HUB_PROJECT: "acme-travel", HUB_HOME: paths.home } as NodeJS.ProcessEnv;
    const resp = { content: [{ type: "text", text: JSON.stringify({ calendars: [{ id: "owner@acme.example", primary: true }] }) }] };
    runGuardPost(JSON.stringify({ session_id: "S1", tool_name: "mcp__gcal-acme__list_calendars", tool_input: {}, tool_response: resp }), { root: paths.home, projectsDir: paths.projects, env, paths });
    expect(readConnectorAccounts(paths)["gcal-acme"]).toMatchObject({ account: "owner@acme.example", how: "session" });
  });
});

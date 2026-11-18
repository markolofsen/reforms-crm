import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hubPaths, type HubPaths } from "@hub/config/paths";
import { agentChecks, fakeAgentRows, prepareLine, type AgentProbe } from "../src/checks";
import { claudeSettings } from "../src/claude";
import { codexConfigToml, codexHome } from "../src/codex";
import { MEASURED_VERSIONS } from "../src/session";

// The Agent tools rows (P49 5B) on a written instance and a fake probe: no CLI runs, no MCP server is reached.

const servers = { "mail-mcp": { type: "http", url: "http://127.0.0.1:8787/mcp" }, notion: { type: "http", url: "https://mcp.notion.com/mcp" } };

function instance(o: { unattended: boolean; codex?: boolean; skills?: boolean; claudeSandbox?: boolean }) {
  const home = mkdtempSync(path.join(tmpdir(), "hub-agent-checks-"));
  mkdirSync(path.join(home, "projects", "acme"), { recursive: true });
  const paths: HubPaths = hubPaths({ home, env: {} });
  const dir = path.join(paths.stateProjects, "acme");
  mkdirSync(dir, { recursive: true });
  const settings = claudeSettings({ paths, projectsDir: path.join(home, "projects"), slug: "acme", nodeBin: "/n/node", unattended: o.unattended });
  if (o.claudeSandbox === false) delete (settings as Record<string, unknown>).sandbox;
  writeFileSync(path.join(dir, "settings.json"), JSON.stringify(settings));
  writeFileSync(path.join(dir, "mcp.json"), JSON.stringify({ mcpServers: servers }));
  if (o.codex !== false) {
    const ch = codexHome(paths, "acme");
    mkdirSync(path.join(ch, "skills", "triage-mail"), { recursive: true });
    writeFileSync(path.join(ch, "config.toml"), codexConfigToml({ paths, projectsDir: path.join(home, "projects"), slug: "acme", unattended: o.unattended, servers, instructions: "acme only" }));
  }
  if (o.skills !== false) mkdirSync(path.join(paths.claudeSkills, "triage-mail"), { recursive: true });
  return paths;
}

const probe = (o: { version?: Record<string, string>; loggedIn?: boolean; tools?: Record<string, string[] | null> } = {}): AgentProbe => ({
  run: async (cmd, args) => {
    if (args[0] === "--version") { const v = o.version?.[cmd] ?? MEASURED_VERSIONS[cmd as "claude" | "codex"]; return v ? { code: 0, stdout: `${v} (${cmd})\n`, stderr: "" } : { code: 127, stdout: "", stderr: "" }; }
    if (args.join(" ") === "login status") return o.loggedIn === false ? { code: 1, stdout: "", stderr: "Not logged in" } : { code: 0, stdout: "Logged in using ChatGPT\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "" };
  },
  mcp: async (name) => {
    const t = o.tools?.[name] === undefined ? { "mail-mcp": ["find_messages", "create_reply", "list_outgoing_messages", "create_outgoing_message", "delete_draft"], notion: ["notion-search"] }[name] ?? [] : o.tools[name];
    return t ? { ok: true, tools: t, detail: "" } : { ok: false, tools: [], detail: "HTTP 401" };
  },
});
const byId = (rows: Awaited<ReturnType<typeof agentChecks>>) => Object.fromEntries(rows.map((r) => [r.id, r]));

describe("agentChecks", () => {
  it("a prepared unattended instance passes every row for both CLIs", async () => {
    const paths = instance({ unattended: true });
    for (const cli of ["claude", "codex"] as const) {
      const rows = await agentChecks({ paths, slug: "acme", cli, unattended: true, probe: probe() });
      const bad = rows.filter((r) => r.state === "fail" || r.state === "warn");
      expect(bad, cli).toEqual([]);
      expect(rows.every((r) => r.cli === cli && (r.state === "pass" || r.state === "skip") === (r.fix === null))).toBe(true);
    }
  });
  it("a missing CLI fails; another version warns; Codex not signed in fails with the login line", async () => {
    const paths = instance({ unattended: true });
    const missing = byId(await agentChecks({ paths, slug: "acme", cli: "codex", unattended: true, probe: probe({ version: { codex: "" } }) }));
    expect(missing["cli.version"]).toMatchObject({ state: "fail", fix: "npm i -g @openai/codex" });
    expect(missing["cli.signed-in"]!.state).toBe("skip");
    const other = byId(await agentChecks({ paths, slug: "acme", cli: "claude", unattended: true, probe: probe({ version: { claude: "2.2.0" } }) }));
    expect(other["cli.version"]!.state).toBe("warn");
    const out = byId(await agentChecks({ paths, slug: "acme", cli: "codex", unattended: true, probe: probe({ loggedIn: false }) }));
    expect(out["cli.signed-in"]).toMatchObject({ state: "fail", fix: "codex login && hub agent acme --cli codex --prepare" });
  });
  it("no session files: fail with the prepare line; no skills: fail", async () => {
    const paths = instance({ unattended: true, codex: false, skills: false });
    const r = byId(await agentChecks({ paths, slug: "acme", cli: "codex", unattended: true, probe: probe() }));
    expect(r["session.files"]).toMatchObject({ state: "fail", fix: prepareLine("acme", "codex") });
    expect(r["mode"]!.state).toBe("fail");
    const c = byId(await agentChecks({ paths, slug: "acme", cli: "claude", unattended: true, probe: probe() }));
    expect(c["skills.linked"]).toMatchObject({ state: "fail", fix: "hub agent acme --prepare" });
  });
  it("Notion not signed in is a warning; a send tool that is not denied fails", async () => {
    const paths = instance({ unattended: true });
    const r = byId(await agentChecks({ paths, slug: "acme", cli: "codex", unattended: true, probe: probe({ tools: { notion: null, "mail-mcp": ["send_now", "create_reply"] } }) }));
    expect(r["mcp.answers.notion"]!.state).toBe("warn");
    expect(r["mcp.answers.notion"]!.fix).toMatch(/codex mcp login notion$/);
    expect(r["send-tools.off"]).toMatchObject({ state: "fail", detail: "not denied: mail-mcp.send_now" });
  });
  it("unattended Claude without the sandbox block fails; a Codex config that bypasses the sandbox fails", async () => {
    const paths = instance({ unattended: true, claudeSandbox: false });
    expect(byId(await agentChecks({ paths, slug: "acme", cli: "claude", unattended: true, probe: probe() }))["mode"]!.state).toBe("fail");
    writeFileSync(path.join(codexHome(paths, "acme"), "config.toml"), 'sandbox_mode = "danger-full-access"\n');
    expect(byId(await agentChecks({ paths, slug: "acme", cli: "codex", unattended: true, probe: probe() }))["mode"]).toMatchObject({ state: "fail", detail: "the Codex config bypasses the sandbox" });
  });
  it("a Codex config for the other mode fails; a broken policy file fails", async () => {
    const paths = instance({ unattended: false });
    expect(byId(await agentChecks({ paths, slug: "acme", cli: "codex", unattended: true, probe: probe() }))["mode"]!.state).toBe("fail");
    writeFileSync(path.join(paths.stateProjects, "acme", "send-policy.json"), "{");
    expect(byId(await agentChecks({ paths, slug: "acme", cli: "claude", unattended: false, probe: probe() }))["send.pipeline"]!.state).toBe("fail");
  });
  it("the fake rows hold one of each state and a fix on each red row", () => {
    const rows = fakeAgentRows("acme", "codex");
    expect(new Set(rows.map((r) => r.state))).toEqual(new Set(["pass", "fail", "warn"]));
    expect(rows.filter((r) => r.state === "fail" || r.state === "warn").every((r) => r.fix)).toBe(true);
  });
});

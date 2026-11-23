import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hubPaths, type HubPaths } from "@hub/config/paths";
import { agentChecks, fakeAgentRows, notionEvidenceOf, prepareLine, type AgentProbe, type EvidenceEvent } from "../src/checks";
import { claudeSettings } from "../src/claude";
import { INSTALL_LINE, LOGIN_LINE, type CliFact } from "../src/detect";
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

const probe = (o: { version?: Record<string, string>; loggedIn?: boolean; tools?: Record<string, string[] | null>; notionAuth?: string } = {}): AgentProbe => ({
  run: async (cmd, args, env) => {
    if (args.join(" ") === "mcp list --json") return o.notionAuth && cmd === "/bin/codex" && env?.CODEX_HOME ? { code: 0, stdout: JSON.stringify([{ name: "hub", auth_status: "unsupported" }, { name: "notion", auth_status: o.notionAuth }]), stderr: "" } : { code: 1, stdout: "", stderr: "" };
    if (args[0] === "--version") { const v = o.version?.[cmd] ?? MEASURED_VERSIONS[cmd as "claude" | "codex"]; return v ? { code: 0, stdout: `${v} (${cmd})\n`, stderr: "" } : { code: 127, stdout: "", stderr: "" }; }
    if (args.join(" ") === "login status") return o.loggedIn === false ? { code: 1, stdout: "", stderr: "Not logged in" } : { code: 0, stdout: "Logged in using ChatGPT\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "" };
  },
  mcp: async (name) => {
    if (name === "notion") throw new Error("P82: the hub never asks the Notion connector itself");
    const t = o.tools?.[name] === undefined ? { "mail-mcp": ["find_messages", "create_reply", "list_outgoing_messages", "create_outgoing_message", "delete_draft"], notion: ["notion-search"] }[name] ?? [] : o.tools[name];
    return t ? { ok: true, tools: t, detail: "" } : { ok: false, tools: [], detail: "HTTP 401" };
  },
});

/** The detector's facts for the same options (P57: rows 1 and 2 come from them, not from the probe). */
const factsOf = (o: { version?: Record<string, string>; loggedIn?: boolean } = {}): CliFact[] => (["claude", "codex"] as const).map((cli) => {
  const v = o.version?.[cli] ?? MEASURED_VERSIONS[cli];
  if (!v) return { cli, state: "missing", path: null, version: null, detail: "not installed", fix: INSTALL_LINE[cli] };
  if (o.loggedIn === false) return { cli, state: "signed-out", path: `/bin/${cli}`, version: v, detail: "not signed in", fix: LOGIN_LINE[cli] };
  return { cli, state: "ready", path: `/bin/${cli}`, version: v, detail: `${v} · signed in`, fix: null };
});
const input = (o: Parameters<typeof probe>[0] & { loggedIn?: boolean } = {}) => ({ probe: probe(o), facts: factsOf(o) });
const byId = (rows: Awaited<ReturnType<typeof agentChecks>>) => Object.fromEntries(rows.map((r) => [r.id, r]));

describe("agentChecks", () => {
  it("a prepared unattended instance passes every row for both CLIs", async () => {
    const paths = instance({ unattended: true });
    for (const cli of ["claude", "codex"] as const) {
      const rows = await agentChecks({ paths, slug: "acme", cli, unattended: true, ...input() });
      const bad = rows.filter((r) => r.state === "fail" || r.state === "warn");
      expect(bad, cli).toEqual([]);
      expect(rows.every((r) => r.cli === cli && (r.state === "pass" || r.state === "skip") === (r.fix === null))).toBe(true);
    }
  });
  it("reports the exact Codex approval exception and rejects a second automatic MCP override", async () => {
    const paths = instance({ unattended: true });
    const good = byId(await agentChecks({ paths, slug: "acme", cli: "codex", unattended: true, ...input() }));
    expect(good["approval.policy"]).toMatchObject({ state: "pass", detail: "unattended: only hub.draft_write is automatically approved" });
    const home = codexHome(paths, "acme");
    writeFileSync(path.join(home, "config.toml"), `${readFileSync(path.join(home, "config.toml"), "utf8")}\n[mcp_servers."hub".tools."project_write"]\napproval_mode = "approve"\n`);
    expect(byId(await agentChecks({ paths, slug: "acme", cli: "codex", unattended: true, ...input() }))["approval.policy"]).toMatchObject({ state: "fail" });
    const attendedPaths = instance({ unattended: false });
    const attended = byId(await agentChecks({ paths: attendedPaths, slug: "acme", cli: "codex", unattended: false, ...input() }));
    expect(attended["approval.policy"]).toMatchObject({ state: "pass", detail: "attended: MCP tools remain on-request" });
  });
  it("a missing CLI fails; another version warns; Codex not signed in fails with the login line", async () => {
    const paths = instance({ unattended: true });
    const missing = byId(await agentChecks({ paths, slug: "acme", cli: "codex", unattended: true, ...input({ version: { codex: "" } }) }));
    expect(missing["cli.version"]).toMatchObject({ state: "fail", fix: "npm i -g @openai/codex" });
    expect(missing["cli.signed-in"]!.state).toBe("skip");
    const other = byId(await agentChecks({ paths, slug: "acme", cli: "claude", unattended: true, ...input({ version: { claude: "2.2.0" } }) }));
    expect(other["cli.version"]!.state).toBe("warn");
    const out = byId(await agentChecks({ paths, slug: "acme", cli: "codex", unattended: true, ...input({ loggedIn: false }) }));
    expect(out["cli.signed-in"]).toMatchObject({ state: "fail", fix: "codex login && hub agent acme --cli codex --prepare" });
  });
  it("no session files: fail with the prepare line; no skills: fail", async () => {
    const paths = instance({ unattended: true, codex: false, skills: false });
    const r = byId(await agentChecks({ paths, slug: "acme", cli: "codex", unattended: true, ...input() }));
    expect(r["session.files"]).toMatchObject({ state: "fail", fix: prepareLine("acme", "codex") });
    expect(r["mode"]!.state).toBe("fail");
    const c = byId(await agentChecks({ paths, slug: "acme", cli: "claude", unattended: true, ...input() }));
    expect(c["skills.linked"]).toMatchObject({ state: "fail", fix: "hub agent acme --prepare" });
  });
  it("a send tool that is not denied fails; the hub never probes Notion (P82)", async () => {
    const paths = instance({ unattended: true });
    const r = byId(await agentChecks({ paths, slug: "acme", cli: "codex", unattended: true, ...input({ tools: { "mail-mcp": ["send_now", "create_reply"] } }) }));
    expect(r["mcp.answers.notion"]).toBeUndefined();
    expect(r["mcp.present.notion"]!.state).toBe("pass");
    expect(r["send-tools.off"]).toMatchObject({ state: "fail", detail: "not denied: mail-mcp.send_now" });
  });
  it("Claude Code's Notion row reads the session log: works, a newer sign-in request warns with /mcp, nothing is a quiet skip (P82)", async () => {
    const paths = instance({ unattended: true });
    // Today's saas lines, shortened: a search answered; then a synthetic sign-in request (S0 point 4).
    const worked: EvidenceEvent[] = [
      { ts: "2026-11-20T03:23:47.098Z", cli: "claude", kind: "tool_call", corr: "a", data: { tool: "mcp__notion__notion-search", input: { query: "Clients" } } },
      { ts: "2026-11-20T03:25:02.000Z", cli: "claude", kind: "tool_result", corr: "b", data: { tool: "mcp__notion__notion-query-data-sources", output: "{}" } },
      { ts: "2026-11-20T03:23:55.670Z", cli: "claude", kind: "tool_error", corr: "c", data: { tool: "mcp__notion__notion-fetch", error: "Input validation error: id: expected string" } },
    ];
    const run = async (events: EvidenceEvent[]) => byId(await agentChecks({ paths, slug: "acme", cli: "claude", unattended: true, ...input(), notionEvidence: notionEvidenceOf(events, "claude") }))["notion.signin"];
    expect(await run(worked)).toMatchObject({ state: "pass", detail: "works, last used 2026-11-20 03:25", fix: null });
    for (const late of [
      { ts: "2026-11-21T09:00:00.000Z", cli: "claude", kind: "tool_call", data: { tool: "mcp__notion__authenticate", input: {} } },
      { ts: "2026-11-21T09:00:00.000Z", cli: "claude", kind: "tool_error", data: { tool: "mcp__notion__notion-search", error: "HTTP 401 Unauthorized" } },
      { ts: "2026-11-21T09:00:00.000Z", cli: "claude", kind: "tool_result", data: { tool: "WaitForMcpServers", output: "ready: false\nNeeds authentication (ask the user to run /mcp): notion" } },
    ]) {
      const r = await run([...worked, late]);
      expect(r).toMatchObject({ state: "warn", fix: "/mcp" });
      expect(r!.detail).toMatch(/^Not signed in to Notion \(a session of this project asked for it on 2026-11-21 09:00\)\. Type the line below/);
    }
    expect(await run([])).toMatchObject({ state: "skip", detail: "not used yet in this project's sessions", fix: null });
    // A validation error is not a sign-in problem; the other CLI's lines do not count.
    expect((await run([worked[2]!, { ...worked[1]!, cli: "codex" }]))!.state).toBe("skip");
  });
  it("Codex's Notion row is its own `codex mcp list` answer: not signed in is quiet unless Codex is the default or tried Notion (P82)", async () => {
    const paths = instance({ unattended: true });
    const home = codexHome(paths, "acme");
    const run = async (o: { auth?: string; events?: EvidenceEvent[]; defaultCli?: "claude" | "codex" }) => byId(await agentChecks({ paths, slug: "acme", cli: "codex", unattended: true, ...input(o.auth ? { notionAuth: o.auth } : {}), notionEvidence: notionEvidenceOf(o.events ?? [], "codex"), defaultCli: o.defaultCli ?? "claude" }))["notion.signin"];
    const quiet = await run({ auth: "not_logged_in" });
    expect(quiet).toMatchObject({ state: "skip", fix: null });
    expect(quiet!.detail).toBe(`Codex is not signed in to Notion; only needed for Notion from Codex: CODEX_HOME=${home} codex mcp login notion`);
    expect(await run({ auth: "not_logged_in", defaultCli: "codex" })).toMatchObject({ state: "warn", fix: `CODEX_HOME=${home} codex mcp login notion` });
    const tried: EvidenceEvent[] = [{ ts: "2026-11-19T03:31:11.308Z", cli: "codex", kind: "tool_call", corr: "x", data: { tool: "exec", input: "text(await tools.mcp__notion__notion_search({query: 'Clients'}));" } }];
    expect((await run({ auth: "not_logged_in", events: tried }))!.state).toBe("warn");
    expect(await run({ auth: "o_auth", events: [...tried, { ts: "2026-11-19T03:31:12.000Z", cli: "codex", kind: "tool_result", corr: "x", data: { tool: "exec", output: "[]" } }] })).toMatchObject({ state: "pass", detail: "signed in (o_auth), last used 2026-11-19 03:31" });
    expect(await run({})).toMatchObject({ state: "skip", detail: "Codex's sign-in to Notion was not read (codex mcp list)" });
    // A Codex exec that never names Notion is not a try.
    expect((await run({ auth: "not_logged_in", events: [{ ...tried[0]!, data: { tool: "exec", input: "tools.mcp__hub__focus({})" } }] }))!.state).toBe("skip");
  });
  it("unattended Claude without the sandbox block fails; a Codex config that bypasses the sandbox fails", async () => {
    const paths = instance({ unattended: true, claudeSandbox: false });
    expect(byId(await agentChecks({ paths, slug: "acme", cli: "claude", unattended: true, ...input() }))["mode"]!.state).toBe("fail");
    writeFileSync(path.join(codexHome(paths, "acme"), "config.toml"), 'sandbox_mode = "danger-full-access"\n');
    expect(byId(await agentChecks({ paths, slug: "acme", cli: "codex", unattended: true, ...input() }))["mode"]).toMatchObject({ state: "fail", detail: "the Codex config bypasses the sandbox" });
  });
  it("a Codex config for the other mode fails; a broken policy file fails", async () => {
    const paths = instance({ unattended: false });
    expect(byId(await agentChecks({ paths, slug: "acme", cli: "codex", unattended: true, ...input() }))["mode"]!.state).toBe("fail");
    writeFileSync(path.join(paths.stateProjects, "acme", "send-policy.json"), "{");
    expect(byId(await agentChecks({ paths, slug: "acme", cli: "claude", unattended: false, ...input() }))["send.pipeline"]!.state).toBe("fail");
  });
  it("the fake rows hold one of each state and a fix on each red row; Codex's Notion row is quiet", () => {
    const rows = fakeAgentRows("acme", "claude");
    expect(new Set(rows.map((r) => r.state))).toEqual(new Set(["pass", "fail", "warn"]));
    expect(rows.filter((r) => r.state === "fail" || r.state === "warn").every((r) => r.fix)).toBe(true);
    expect(rows.find((r) => r.id === "notion.signin")).toMatchObject({ state: "warn", fix: "/mcp" });
    expect(fakeAgentRows("acme", "codex").find((r) => r.id === "notion.signin")).toMatchObject({ state: "skip", fix: null });
  });
});

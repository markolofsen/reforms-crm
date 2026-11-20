import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathsAt } from "@hub/config/paths";
import path from "node:path";
import { createRepos, openDb } from "@hub/db";
import { describe, expect, it } from "vitest";
import { defaultRoot } from "../src/context";
import { recordDraft } from "../src/record-draft";
import { guardDecision, readBinding, resolveBinding, runGuard, runGuardPost, skillScope, writeBinding, writeCodexHome, writeSessionFiles } from "../src/safety";
import { CODEX_FORBIDDEN_PREFIXES, DENIED_TOOLS } from "@hub/agent/deny";
import { claudeEnforcementArgs as enforcementArgs } from "@hub/agent/claude";
import { buildClaudeArgs } from "../src/agent";
import { auditLayout } from "../src/safety";
import { readEvents, logStoreOf } from "@hub/log/store";
import { makeInstance } from "./instance-fixture";

const PROJECTS = path.join(defaultRoot(), "app", "packages", "projects", "test", "fixtures", "projects");
const tmp = () => makeInstance().home;
const LAYOUT = auditLayout(makeInstance().paths);
const call = (tool_name: string, tool_input: unknown = {}) => ({ tool_name, tool_input });
const guard = (c: ReturnType<typeof call>, env: Record<string, string> = { HUB_PROJECT: "acme-travel" }, root = tmp()) =>
  runGuard(JSON.stringify(c), { root, projectsDir: PROJECTS, env });

describe("hub guard", () => {
  it("allows a call inside the project", () => {
    expect(guard(call("mcp__mail-mcp__find_messages", { account: "owner@acme.example" })).code).toBe(0);
    expect(guard(call("Read", { file_path: "projects/acme-travel/project.md" })).stderr).toBe("");
    expect(guard(call("mcp__mail-mcp__create_reply", {})).stderr).toBe("");
  });
  it("P82: a Notion call on another project's database is refused in warn mode too; the project's own passes; an update needs the page read from it first", () => {
    const root = tmp();
    const q = (ds: string) => ({ ...call("mcp__notion__notion-query-data-sources", { data: { mode: "sql", data_source_urls: [`collection://${ds}`], query: "SELECT url" } }), session_id: "s-notion" });
    const foreign = runGuard(JSON.stringify(q("6096f440-6f14-8000-8000-000000001521")), { root, projectsDir: PROJECTS, env: { HUB_PROJECT: "acme-travel" } });
    expect(foreign.code).toBe(2);
    expect(foreign.stderr).toMatch(/is not one of acme-travel's Notion databases \(clients collection:\/\/00000000-0000-4000-8000-000000000001, documents/);
    expect(runGuard(JSON.stringify(q("00000000-0000-4000-8000-000000000001")), { root, projectsDir: PROJECTS, env: { HUB_PROJECT: "acme-travel" } }).code).toBe(0);
    const page = "0000aaaa-0000-4000-8000-0000000000aa";
    const update = { ...call("mcp__notion__notion-update-page", { page_id: page, command: "update_properties", properties: {} }), session_id: "s-notion" };
    expect(runGuard(JSON.stringify(update), { root, projectsDir: PROJECTS, env: { HUB_PROJECT: "acme-travel" } }).code).toBe(2);
    // The post hook records the query's result in the ledger; then the same update passes.
    runGuardPost(JSON.stringify({ ...q("00000000-0000-4000-8000-000000000001"), tool_response: [{ type: "text", text: JSON.stringify({ results: [{ url: `https://app.notion.com/p/${page.replace(/-/g, "")}` }] }) }] }), { root, projectsDir: PROJECTS, env: { HUB_PROJECT: "acme-travel" } });
    expect(runGuard(JSON.stringify(update), { root, projectsDir: PROJECTS, env: { HUB_PROJECT: "acme-travel" } }).code).toBe(0);
    // An unbound session is told only.
    expect(runGuard(JSON.stringify(q("6096f440-6f14-8000-8000-000000001521")), { root, projectsDir: PROJECTS, env: {} }).code).toBe(0);
  });
  it("P82: the post hook adds a note to an unscoped Notion search, nothing to a search narrowed to the project", () => {
    const root = tmp();
    const post = (input: unknown) => runGuardPost(JSON.stringify({ ...call("mcp__notion__notion-search", input), session_id: "s-note", tool_response: { results: [] } }), { root, projectsDir: PROJECTS, env: { HUB_PROJECT: "acme-travel" } });
    expect(JSON.parse(post({ query: "Clients" }).stdout ?? "{}").hookSpecificOutput).toMatchObject({ hookEventName: "PostToolUse", additionalContext: expect.stringContaining("not narrowed to acme-travel") });
    expect(post({ query: "x", data_source_url: "collection://00000000-0000-4000-8000-000000000001" }).stdout).toBeUndefined();
  });
  it("warn mode logs and allows; block mode refuses with exit 2", () => {
    const root = tmp();
    const bad = { ...call("mcp__mail-mcp__find_messages", { account: "x@else.example" }), session_id: "s-guard", tool_use_id: "tu1" };
    const w = runGuard(JSON.stringify(bad), { root, projectsDir: PROJECTS, env: { HUB_PROJECT: "acme-travel" } });
    expect(w.code).toBe(0);
    expect(w.stderr).toMatch(/outside project/);
    // P54: the call and the violation are session log events (state/guard.log is gone).
    const logged = readEvents(logStoreOf(pathsAt(root)), { project: "acme-travel" });
    expect(logged.map((e) => e.kind)).toEqual(["tool_call", "guard"]);
    expect(logged[1]?.data).toMatchObject({ mode: "warn", tool: "mcp__mail-mcp__find_messages" });
    expect(logged[1]?.corr).toBe("tu1");
    expect(existsSync(path.join(root, "state", "guard.log"))).toBe(false);
    const b = runGuard(JSON.stringify(bad), { root, projectsDir: PROJECTS, env: { HUB_PROJECT: "acme-travel", HUB_GUARD: "block" } });
    expect(b.code).toBe(2);
  });
  it.each([
    ["foreign mail account", call("mcp__mail-mcp__find_messages", { account: "a@b.example" })],
    ["foreign knowledge project", call("mcp__knowledge-mcp__knowledge_search", { project: "nordhaus", query: "x" })],
    ["send tool", call("mcp__x__send_message", {})],
    ["Gmail reply", call("mcp__x__reply", {})],
    ["trash", call("mcp__x__trash_thread", {})],
    ["notion delete", call("mcp__notion__notion-delete-pages", {})],
    ["other project folder", call("Read", { file_path: "projects/nordhaus/project.md" })],
    ["glob of all projects", call("Glob", { pattern: "projects/*/project.md" })],
    ["listing of all projects", call("Bash", { command: "ls projects" })],
    ["secrets read", call("Read", { file_path: "/r/state/secrets/notion-token" })],
    ["osascript", call("Bash", { command: "osascript -e 'tell app \"Mail\" to send m'" })],
  ])("blocks in block mode: %s", (_n, c) => {
    expect(guard(c, { HUB_PROJECT: "acme-travel", HUB_GUARD: "block" }).code).toBe(2);
  });
  it("shared _template stays readable; create_reply is not a send", () => {
    expect(guardDecision(call("Read", { file_path: "projects/_template/x.md" }), { slug: "acme-travel", accounts: [], mode: "block", layout: LAYOUT }).violations).toEqual([]);
    expect(guardDecision(call("mcp__mail-mcp__create_reply"), { slug: "acme-travel", accounts: [], mode: "block", layout: LAYOUT }).violations).toEqual([]);
  });
  it("an unbound session still blocks sends and secrets, not project reads", () => {
    const env = { HUB_GUARD: "block" };
    expect(guard(call("Read", { file_path: "projects/acme-travel/project.md" }), env).code).toBe(0);
    expect(guard(call("mcp__x__forward"), env).code).toBe(2);
    expect(guard(call("Read", { file_path: "state/secrets/mail.json" }), env).code).toBe(2);
  });
  it("bad stdin never throws and allows", () => {
    expect(runGuard("not json", { root: tmp(), projectsDir: PROJECTS, env: {} }).code).toBe(0);
  });
});

describe("generated session files", () => {
  const root = tmp();
  const files = writeSessionFiles(root, PROJECTS, "acme-travel", "/n/node");
  const settings = JSON.parse(readFileSync(files.settings, "utf8"));
  it("deny rules cover secrets, the database, other projects and every send/delete tool", () => {
    const d: string[] = settings.permissions.deny;
    expect(d).toContain("Read(./state/secrets/**)");
    expect(d).toContain("Bash(osascript *)");
    // P61: opening things on the owner's screen, and the desktop handoff, are his.
    for (const r of ["Bash(open *)", "Bash(*hub open*)", "Bash(*run.sh open*)", "Bash(*claude --desktop*)", "Bash(*codex app *)"]) expect(d).toContain(r);
    expect(d.some((r) => r.startsWith("Read(./") && r.includes("nordhaus"))).toBe(true);
    expect(d.some((r) => r.includes("acme-travel"))).toBe(false);
    for (const t of ["mcp__mail-mcp__create_outgoing_message", "mcp__notion__notion-delete-pages"]) expect(d).toContain(t);
  });
  it("hook points at hub guard", () => {
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toMatch(/hub\.mjs" guard$/);
  });
  it("P54: the prompt hook names its CLI; the session log hooks, the answer in line", () => {
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toMatch(/hub\.mjs" focus --hook --cli claude$/);
    for (const e of ["SessionStart", "Stop", "StopFailure", "Notification", "PostToolUseFailure", "PermissionDenied", "SessionEnd"]) {
      // the answer's hooks run in line (an async Stop wrote nothing in print mode, 2.1.220); the rest in the background
      expect(settings.hooks[e][0].hooks[0].async).toBe(e === "Stop" || e === "StopFailure" ? undefined : true);
      expect(settings.hooks[e][0].hooks[0].command).toMatch(/hub\.mjs" log --hook --cli claude$/);
    }
    expect(settings.permissions.deny).toContain("Edit(./state/log/**)");
  });
  it("strict MCP: only the hub's servers, the knowledge server pinned to the slug", () => {
    mkdirSync(path.join(root, "config"), { recursive: true });
    writeFileSync(path.join(root, "config", "mcp.json"), JSON.stringify({ mcpServers: { "mail-mcp": { type: "http" }, gmail: { type: "http" }, "knowledge-mcp": { type: "stdio", env: { HUB_PROJECT: "${HUB_PROJECT:-}" } } } }));
    const f = writeSessionFiles(root, PROJECTS, "acme-travel");
    const m = JSON.parse(readFileSync(f.mcp, "utf8")).mcpServers;
    // `hub` (P51) is the core's own server: there even when the instance's file predates it.
    expect(Object.keys(m).sort()).toEqual(["hub", "knowledge-mcp", "mail-mcp"]);
    expect(m["knowledge-mcp"].env.HUB_PROJECT).toBe("acme-travel");
    expect(m.hub.env.HUB_PROJECT).toBe("acme-travel");
  });
  it("claude gets the enforcement flags in = form, and send tools are denied", () => {
    const a = buildClaudeArgs({ mode: "new", project: "acme-travel", extra: [] }, [], files);
    expect(a).toContain("--strict-mcp-config");
    expect(a.find((x) => x.startsWith("--disallowedTools="))).toContain(DENIED_TOOLS[0]);
    expect(enforcementArgs(files)).toContain("--settings");
  });
  it("an unbound session writes to _unbound", () => {
    expect(existsSync(writeSessionFiles(root, PROJECTS, undefined).settings)).toBe(true);
  });
  it("normal mode has no sandbox block; unattended has the OS sandbox with no network, no Apple Events and the policy read-only (P49 S9)", () => {
    expect(settings.sandbox).toBeUndefined();
    const u = JSON.parse(readFileSync(writeSessionFiles(root, PROJECTS, "acme-travel", "/n/node", pathsAt(root), true).settings, "utf8"));
    expect(u.sandbox).toMatchObject({ enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false, network: { allowedDomains: [], allowLocalBinding: false } });
    expect(u.sandbox.allowAppleEvents).toBeUndefined();
    const dw: string[] = u.sandbox.filesystem.denyWrite;
    for (const p of ["state/projects", "state/secrets", "state/codex", "config", "core", "run.sh", ".claude", ".mcp.json"]) expect(dw, p).toContain(path.join(root, p));
    // the database stays writable for `hub record-draft`: its Read/Edit rules would become sandbox denials
    expect(u.permissions.deny.some((r: string) => r.includes("./data/"))).toBe(false);
    expect(u.permissions.deny).toContain("Bash(*hub send*)");
    writeSessionFiles(root, PROJECTS, "acme-travel", "/n/node"); // back to normal for the rest of the suite
  });
});

describe("the Codex home (P49 S10)", () => {
  const root = tmp();
  const owner = tmp();
  writeFileSync(path.join(owner, "auth.json"), "{}");
  writeFileSync(path.join(owner, "config.toml"), 'model = "gpt-test"\nsandbox_mode = "danger-full-access"\n[mcp_servers.slack]\nurl = "https://x"\n');
  mkdirSync(path.join(root, "config"), { recursive: true });
  writeFileSync(path.join(root, "config", "mcp.json"), JSON.stringify({ mcpServers: { "mail-mcp": { type: "http", url: "http://localhost:8787" }, slack: { type: "http", url: "https://x" } } }));
  const home = writeCodexHome({ paths: pathsAt(root), projectsDir: PROJECTS, slug: "acme-travel", unattended: true, instructions: "bound", env: { HOME: "/nowhere", CODEX_HOME: owner } });
  const toml = readFileSync(path.join(home, "config.toml"), "utf8");
  it("P51: the hub MCP server and the focus hook on every prompt", () => {
    expect(toml).toContain('[mcp_servers."hub"]');
    expect(toml).toMatch(/\[\[hooks\.UserPromptSubmit\]\]\n\[\[hooks\.UserPromptSubmit\.hooks\]\]\ntype = "command"\ncommand = ".*hub\.mjs\\" focus --hook --cli codex"\ntimeout = 5/);
  });
  it("P54: the session log hooks, synchronous (Codex 0.146 skips async hooks), no SessionEnd", () => {
    for (const e of ["SessionStart", "Stop", "PermissionRequest"]) expect(toml).toMatch(new RegExp(`\\[\\[hooks\\.${e}\\.hooks\\]\\]\\ntype = "command"\\ncommand = ".*hub\\.mjs\\\\" log --hook --cli codex"\\ntimeout = 10`));
    expect(toml).not.toContain("hooks.SessionEnd");
    expect(toml).not.toContain("async");
  });
  it("holds the hub's servers only, with the send tools off, and none of the owner's", () => {
    expect(toml).toContain('[mcp_servers."mail-mcp"]');
    expect(toml).toMatch(/disabled_tools = \[.*"create_outgoing_message".*\]/);
    // P65 S5: a slow Mail's draft_write must end in mail_slow, never in Codex's own 60 s cut.
    expect(toml).toMatch(/\[mcp_servers\."hub"\]\n(?:(?!\[mcp_servers)[^\n]*\n)*?tool_timeout_sec = 300\n/);
    expect(toml).not.toContain("slack");
  });
  it("is unattended without the bypass: approvals never, the profile's sandbox, network off, the policy read-only", () => {
    expect(toml).toContain('approval_policy = "never"');
    expect(toml).toContain('default_permissions = "hub"');
    expect(toml).not.toMatch(/danger-full-access|dangerously/);
    expect(toml).toContain(`${JSON.stringify(path.join(root, "state", "projects"))} = "read"`);
    expect(toml).toMatch(/\[permissions\.hub\.network\]\nenabled = false/);
    expect(toml).toContain('model = "gpt-test"');
  });
  it("links auth.json and the skills, writes the forbidden rules", () => {
    expect(lstatSync(path.join(home, "auth.json")).isSymbolicLink()).toBe(true);
    expect(readFileSync(path.join(home, "rules", "hub.rules"), "utf8")).toContain('prefix_rule(pattern = ["hub", "send"], decision = "forbidden"');
    // P61: `hub open`, a bare `open` and the desktop handoff are refused without a prompt.
    for (const p of [["open"], ["hub", "open"], ["claude", "--desktop"], ["codex", "app"]]) expect(CODEX_FORBIDDEN_PREFIXES).toContainEqual(p);
    expect(readFileSync(path.join(home, "rules", "hub.rules"), "utf8")).toContain('prefix_rule(pattern = ["open"], decision = "forbidden"');
    expect(existsSync(path.join(home, "skills", "triage-mail", "SKILL.md"))).toBe(true);
  });
});

describe("sticky binding", () => {
  it("continue keeps the stored binding; new unbinds", () => {
    expect(resolveBinding({ mode: "continue", stored: "acme" })).toEqual({ project: "acme", sticky: true });
    expect(resolveBinding({ mode: "new", stored: "acme" })).toEqual({ sticky: false });
    expect(resolveBinding({ mode: "new", requested: "b", stored: "acme" })).toEqual({ project: "b", sticky: false });
  });
  it("a shell bound by HUB_PROJECT refuses a second project", () => {
    expect(() => resolveBinding({ mode: "new", requested: "b", envProject: "a" })).toThrow(/already belongs to project "a"/);
    expect(resolveBinding({ mode: "continue", envProject: "a", stored: "z" }).project).toBe("a");
  });
  it("is stored and cleared on disk", () => {
    const root = tmp();
    writeBinding(root, "acme-travel");
    expect(readBinding(root)).toBe("acme-travel");
    writeBinding(root, undefined);
    expect(readBinding(root)).toBeUndefined();
  });
});

describe("record-draft enforces draft.recipients", () => {
  const cfg = () => { const f = path.join(tmp(), "config.json"); writeFileSync(f, JSON.stringify({ allow_list: ["me@mine.example"] })); return f; };
  const run = (over: Record<string, unknown>, project = "acme-travel") => {
    const db = path.join(tmp(), "app.db");
    return recordDraft({ project, payload: JSON.stringify({ email: "me@mine.example", subject: "s", mailRef: "<1@x>", ...over }), dbPath: db, attempts: 1, projectsDir: PROJECTS, configFile: cfg() }).then(async (r) => ({ r, db }));
  };
  it("test mode: allow-list address passes", async () => {
    expect((await run({})).r.code).toBe(0);
  });
  it("test mode: a client in To or Cc is refused with exit 2 and `not allowed`, nothing written", async () => {
    for (const over of [{ email: "client@x.example" }, { to: "client@x.example" }, { cc: "boss@x.example" }, { to: "Me <me@mine.example>, client@x.example" }]) {
      const { r, db } = await run(over);
      expect(r.code, JSON.stringify(over)).toBe(2);
      expect(r.line).toMatch(/not allowed/);
      const h = openDb(db);
      expect(await createRepos(h.db).clients.list("acme-travel")).toEqual([]);
      h.close();
    }
  });
  it("an unknown project is refused", async () => {
    expect((await run({}, "ghost")).r.code).toBe(2);
  });
});

describe("hub guard: skills of the kind", () => {
  const scope = skillScope("software-support", path.join(defaultRoot(), "skills"));
  const d = (skill: string) => guardDecision(call("Skill", { skill }), { slug: "acme-travel", accounts: [], mode: "block", skills: scope, layout: LAYOUT });
  it("flags a hub skill the kind does not allow, and only that", () => {
    expect(scope?.hub).toContain("calendar");
    expect(d("calendar").violations).toEqual(["skill calendar is not in the skill list of project acme-travel's kind"]);
    expect(d("calendar").block).toBe(true);
    expect(d("triage-mail").violations).toEqual([]);
    expect(d("simplify").violations).toEqual([]); // not a hub skill: not judged
  });
  it("judges nothing for an unknown kind or an unbound session", () => {
    expect(skillScope("no-such-kind", path.join(defaultRoot(), "skills"))).toBeUndefined();
    expect(guardDecision(call("Skill", { skill: "calendar" }), { accounts: [], mode: "block", layout: LAYOUT }).violations).toEqual([]);
  });
});

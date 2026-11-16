import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRepos, openDb } from "@hub/db";
import { describe, expect, it } from "vitest";
import { defaultRoot } from "../src/context.ts";
import { recordDraft } from "../src/record-draft.ts";
import { DENIED_TOOLS, enforcementArgs, guardDecision, readBinding, resolveBinding, runGuard, skillScope, writeBinding, writeSessionFiles } from "../src/safety.ts";
import { buildClaudeArgs } from "../src/agent.ts";

const PROJECTS = path.join(defaultRoot(), "app", "packages", "projects", "test", "fixtures", "projects");
const tmp = () => mkdtempSync(path.join(tmpdir(), "hub-safety-"));
const call = (tool_name: string, tool_input: unknown = {}) => ({ tool_name, tool_input });
const guard = (c: ReturnType<typeof call>, env: Record<string, string> = { HUB_PROJECT: "acme-travel" }, root = tmp()) =>
  runGuard(JSON.stringify(c), { root, projectsDir: PROJECTS, env });

describe("hub guard", () => {
  it("allows a call inside the project", () => {
    expect(guard(call("mcp__mail-mcp__find_messages", { account: "owner@acme.example" })).code).toBe(0);
    expect(guard(call("Read", { file_path: "/x/app/projects/acme-travel/project.md" })).stderr).toBe("");
    expect(guard(call("mcp__mail-mcp__create_reply", {})).stderr).toBe("");
  });
  it("warn mode logs and allows; block mode refuses with exit 2", () => {
    const root = tmp();
    const bad = call("mcp__mail-mcp__find_messages", { account: "x@else.example" });
    const w = runGuard(JSON.stringify(bad), { root, projectsDir: PROJECTS, env: { HUB_PROJECT: "acme-travel" } });
    expect(w.code).toBe(0);
    expect(w.stderr).toMatch(/outside project/);
    expect(readFileSync(path.join(root, "state", "guard.log"), "utf8")).toMatch(/warn acme-travel/);
    const b = runGuard(JSON.stringify(bad), { root, projectsDir: PROJECTS, env: { HUB_PROJECT: "acme-travel", HUB_GUARD: "block" } });
    expect(b.code).toBe(2);
  });
  it.each([
    ["foreign mail account", call("mcp__mail-mcp__find_messages", { account: "a@b.example" })],
    ["foreign knowledge project", call("mcp__knowledge-mcp__knowledge_search", { project: "nordhaus", query: "x" })],
    ["send tool", call("mcp__claude_ai_Gmail__send_message", {})],
    ["Gmail reply", call("mcp__x__reply", {})],
    ["trash", call("mcp__x__trash_thread", {})],
    ["notion delete", call("mcp__notion__notion-delete-pages", {})],
    ["other project folder", call("Read", { file_path: "/r/app/projects/nordhaus/project.md" })],
    ["glob of all projects", call("Glob", { pattern: "app/projects/*/project.md" })],
    ["listing of all projects", call("Bash", { command: "ls app/projects" })],
    ["secrets read", call("Read", { file_path: "/r/state/secrets/notion-token" })],
    ["osascript", call("Bash", { command: "osascript -e 'tell app \"Mail\" to send m'" })],
  ])("blocks in block mode: %s", (_n, c) => {
    expect(guard(c, { HUB_PROJECT: "acme-travel", HUB_GUARD: "block" }).code).toBe(2);
  });
  it("shared _template stays readable; create_reply is not a send", () => {
    expect(guardDecision(call("Read", { file_path: "app/projects/_template/x.md" }), { slug: "acme-travel", accounts: [], mode: "block" }).violations).toEqual([]);
    expect(guardDecision(call("mcp__mail-mcp__create_reply"), { slug: "acme-travel", accounts: [], mode: "block" }).violations).toEqual([]);
  });
  it("an unbound session still blocks sends and secrets, not project reads", () => {
    const env = { HUB_GUARD: "block" };
    expect(guard(call("Read", { file_path: "app/projects/acme-travel/project.md" }), env).code).toBe(0);
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
    expect(d.some((r) => r.startsWith("Read(./") && r.includes("nordhaus"))).toBe(true);
    expect(d.some((r) => r.includes("acme-travel"))).toBe(false);
    for (const t of ["mcp__mail-mcp__create_outgoing_message", "mcp__notion__notion-delete-pages"]) expect(d).toContain(t);
  });
  it("hook points at hub guard", () => {
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toMatch(/hub\.mjs" guard$/);
  });
  it("strict MCP: only the hub's servers, the knowledge server pinned to the slug", () => {
    mkdirSync(path.join(root, "config"), { recursive: true });
    writeFileSync(path.join(root, "config", "mcp.json"), JSON.stringify({ mcpServers: { "mail-mcp": { type: "http" }, gmail: { type: "http" }, "knowledge-mcp": { type: "stdio", env: { HUB_PROJECT: "${HUB_PROJECT:-}" } } } }));
    const f = writeSessionFiles(root, PROJECTS, "acme-travel");
    const m = JSON.parse(readFileSync(f.mcp, "utf8")).mcpServers;
    expect(Object.keys(m).sort()).toEqual(["knowledge-mcp", "mail-mcp"]);
    expect(m["knowledge-mcp"].env.HUB_PROJECT).toBe("acme-travel");
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
  const scope = skillScope("software-support", defaultRoot());
  const d = (skill: string) => guardDecision(call("Skill", { skill }), { slug: "acme-travel", accounts: [], mode: "block", skills: scope });
  it("flags a hub skill the kind does not allow, and only that", () => {
    expect(scope?.hub).toContain("calendar");
    expect(d("calendar").violations).toEqual(["skill calendar is not in the skill list of project acme-travel's kind"]);
    expect(d("calendar").block).toBe(true);
    expect(d("triage-mail").violations).toEqual([]);
    expect(d("simplify").violations).toEqual([]); // not a hub skill: not judged
  });
  it("judges nothing for an unknown kind or an unbound session", () => {
    expect(skillScope("no-such-kind", defaultRoot())).toBeUndefined();
    expect(guardDecision(call("Skill", { skill: "calendar" }), { accounts: [], mode: "block" }).violations).toEqual([]);
  });
});

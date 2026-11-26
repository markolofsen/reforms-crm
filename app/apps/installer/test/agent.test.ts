import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bindingPrompt, sessionRules } from "@hub/agent/session-rules";
import { buildClaudeArgs, buildCodexArgs, extraDirs, listProjects, parseAgentArgs, resolveResume, startSession, type AgentPlan } from "../src/agent";
import { ADVISOR_RULE, claudeBaseArgs, claudeEnforcementArgs } from "@hub/agent/claude";
import { DEFAULT_AGENT_SETTINGS } from "@hub/config";
import { appendEvents, logStoreOf } from "@hub/log/store";
import { pathsAt } from "@hub/config/paths";
import { installLink, linkState, planLink, removeLink } from "../src/link";
import { UsageError } from "../src/term";

const MAP = "/h/shared/notes";
const ID = "8d31964d-2edc-490c-91a8-dfb10ffb47de";

describe("parseAgentArgs: mode selection", () => {
  it("defaults to continue", () => {
    expect(parseAgentArgs([], ["acme"])).toEqual({ mode: "continue", extra: [] });
  });
  it("names a mode", () => {
    expect(parseAgentArgs(["new"], []).mode).toBe("new");
    expect(parseAgentArgs(["pick"], []).mode).toBe("pick");
    expect(parseAgentArgs(["continue"], []).mode).toBe("continue");
  });
  it("a project slug means a fresh session bound to it", () => {
    expect(parseAgentArgs(["acme"], ["acme", "x"])).toEqual({ mode: "new", project: "acme", extra: [] });
  });
  it("passes extra flags through, with or without --", () => {
    expect(parseAgentArgs(["acme", "--", "--model", "opus"], ["acme"]).extra).toEqual(["--model", "opus"]);
    expect(parseAgentArgs(["--model", "opus"], []).extra).toEqual(["--model", "opus"]);
    expect(parseAgentArgs(["--", "--model", "opus"], []).extra).toEqual(["--model", "opus"]);
  });
  it("takes --cli and --prepare anywhere before --, and refuses an unknown CLI", () => {
    expect(parseAgentArgs(["acme", "--cli", "codex"], ["acme"])).toEqual({ mode: "new", project: "acme", extra: [], cli: "codex" });
    expect(parseAgentArgs(["--cli=shell", "acme", "--prepare"], ["acme"])).toMatchObject({ project: "acme", cli: "shell", prepare: true });
    expect(parseAgentArgs(["acme", "--", "--cli", "x"], ["acme"]).extra).toEqual(["--cli", "x"]);
    expect(() => parseAgentArgs(["acme", "--cli", "gemini"], ["acme"])).toThrow(/claude, codex, shell/);
  });
  it("rejects an unknown project and lists the known ones", () => {
    expect(() => parseAgentArgs(["nope"], ["acme", "x"])).toThrow(UsageError);
    expect(() => parseAgentArgs(["nope"], ["acme", "x"])).toThrow(/acme, x/);
  });
});

describe("buildClaudeArgs", () => {
  it("base flags: the one mode skips the prompts (the settings carry the sandbox)", () => {
    expect(claudeBaseArgs([MAP])).toEqual(["--dangerously-skip-permissions", "--chrome", "--add-dir", MAP]);
    expect(claudeBaseArgs()).toEqual(["--dangerously-skip-permissions", "--chrome"]);
  });
  it("pick leads with --resume; never --continue (P64: it would take any project's newest conversation in the instance root)", () => {
    expect(buildClaudeArgs({ mode: "continue", extra: [] }, [MAP])).not.toContain("--continue");
    expect(buildClaudeArgs({ mode: "pick", extra: [] }, [MAP])[0]).toBe("--resume");
    expect(buildClaudeArgs({ mode: "new", extra: [] }, [MAP])).toEqual(claudeBaseArgs([MAP]));
  });
  it("a project adds the binding prompt, extra flags come last", () => {
    const a = buildClaudeArgs({ mode: "new", project: "acme", extra: ["--model", "opus"] }, [MAP]);
    const i = a.indexOf("--append-system-prompt");
    expect(a[i + 1]).toBe(bindingPrompt("acme"));
    expect(a.slice(-2)).toEqual(["--model", "opus"]);
  });
});

describe("buildCodexArgs", () => {
  const home = mkdtempSync(path.join(tmpdir(), "hub-codex-"));
  const paths = pathsAt(home);
  it("never carries the sandbox bypass flag; approvals never; the hub's own hook is trusted (P51)", () => {
    const a = buildCodexArgs({ mode: "new", extra: [] }, paths);
    expect(a.join(" ")).not.toMatch(/bypass-approvals|yolo|danger-full-access/);
    expect(a).toEqual(["-C", home, "-a", "never", "--dangerously-bypass-hook-trust"]);
    expect(buildCodexArgs({ mode: "continue", extra: [] }, paths)).not.toContain("--last");
    expect(buildCodexArgs({ mode: "resume", resume: ID, extra: [] }, paths)).toEqual(["resume", ID, ...buildCodexArgs({ mode: "new", extra: [] }, paths)]);
  });
  it("refuses the bypass flag even when it is passed through", () => {
    expect(() => buildCodexArgs({ mode: "new", extra: ["--dangerously-bypass-approvals-and-sandbox"] }, paths)).toThrow(/sandbox off/);
    expect(() => buildCodexArgs({ mode: "new", extra: ["--yolo"] }, paths)).toThrow(/sandbox off/);
  });
});

describe("extraDirs", () => {
  it("is empty by default and follows HUB_EXTRA_DIRS or config.json, existing folders only", () => {
    const root = mkdtempSync(path.join(tmpdir(), "hubwf-x-"));
    const notes = path.join(root, "notes");
    mkdirSync(notes);
    expect(extraDirs(root, {})).toEqual([]);
    expect(extraDirs(root, { HUB_EXTRA_DIRS: `${notes}:${path.join(root, "missing")}` })).toEqual([notes]);
    mkdirSync(path.join(root, "config"));
    writeFileSync(path.join(root, "config", "config.json"), JSON.stringify({ extra_dirs: ["notes"] }));
    expect(extraDirs(root, {})).toEqual([notes]);
  });
});

describe("bindingPrompt", () => {
  it("pins one project and points to `hub agent`", () => {
    const t = bindingPrompt("acme");
    expect(t).toContain("ONE project: acme (HUB_PROJECT)");
    expect(t).toContain("projects/acme/");
    expect(t).toContain("the hub's tools are bound to it");
    expect(t).toContain("hub agent <other>");
    expect(t).not.toContain("agent.sh");
  });
  it("carries the core's session rules (P51): the focus, revise the open draft, never send", () => {
    const t = bindingPrompt("acme");
    expect(t).toContain(sessionRules("acme"));
    expect(t).toMatch(/Never ask what is on his screen/);
    expect(t).toMatch(/this session is bound to acme/);
  });
});

describe("listProjects", () => {
  it("lists folders with project.md, skips _templates and plain folders", () => {
    const d = mkdtempSync(path.join(tmpdir(), "hub-proj-"));
    for (const n of ["acme", "alpha", "_template", "empty"]) mkdirSync(path.join(d, n));
    for (const n of ["acme", "alpha", "_template"]) writeFileSync(path.join(d, n, "project.md"), "# x");
    expect(listProjects(d)).toEqual(["acme", "alpha"]);
    expect(listProjects(path.join(d, "missing"))).toEqual([]);
  });
});

describe("link", () => {
  const setup = () => {
    const root = mkdtempSync(path.join(tmpdir(), "hub-root-"));
    const home = mkdtempSync(path.join(tmpdir(), "hub-home-"));
    const plan = planLink(root, home, "/usr/bin");
    mkdirSync(path.dirname(plan.target), { recursive: true });
    writeFileSync(plan.target, "#!/usr/bin/env node\n");
    return { plan };
  };
  it("links idempotently and removes", () => {
    const { plan } = setup();
    expect(linkState(plan)).toBe("missing");
    installLink(plan);
    expect(linkState(plan)).toBe("linked");
    expect(installLink(plan).message).toMatch(/already linked/);
    expect(removeLink(plan)).toMatch(/removed/);
    expect(linkState(plan)).toBe("missing");
  });
  it("detects PATH, replaces a stale link, never a real file", () => {
    const { plan } = setup();
    expect(plan.onPath).toBe(false);
    expect(planLink("/r", "/h", "/h/.local/bin:/usr/bin").onPath).toBe(true);
    mkdirSync(plan.dir, { recursive: true });
    symlinkSync("/tmp/old-checkout", plan.linkPath);
    expect(linkState(plan)).toBe("elsewhere");
    installLink(plan);
    expect(linkState(plan)).toBe("linked");
    removeLink(plan);
    writeFileSync(plan.linkPath, "real");
    expect(() => installLink(plan)).toThrow(/not a symlink/);
  });
});

describe("hub on the session's PATH (P52)", () => {
  it("writes <state>/bin/hub that runs this core on this Node with this HUB_HOME", async () => {
    const { mkdtempSync, writeFileSync: wf, statSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { execFileSync } = await import("node:child_process");
    const { pathsAt } = await import("@hub/config/paths");
    const { hubShimDir } = await import("../src/agent");
    const home = mkdtempSync(join(tmpdir(), "hub-shim-"));
    const bin = join(home, "fake hub's.mjs");
    wf(bin, "console.log(JSON.stringify({ home: process.env.HUB_HOME, args: process.argv.slice(2) }));\n");
    const dir = hubShimDir(pathsAt(home), process.execPath, bin);
    expect(statSync(join(dir, "hub")).mode & 0o111).toBeTruthy();
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${dir}:/usr/bin:/bin` };
    delete env.HUB_HOME;
    const out = JSON.parse(execFileSync("hub", ["doctor", "--project", "acme"], { env, encoding: "utf8" }));
    expect(out).toEqual({ home, args: ["doctor", "--project", "acme"] });
  });
});

describe("the bound project's identity in the session rules (P52)", () => {
  it("names its accounts, addresses, aliases and domains, and says they are its own mail", async () => {
    const { projectIdentity } = await import("@hub/agent/session-rules");
    const id = projectIdentity("saas-support", { accounts: ["hello@reforms.ai"], addresses: ["hello@reforms.ai"], aliases: ["info@gptkino.com"], domains: ["reforms.ai", "carapis.com", "cmdop.com", "mlsbali.com", "toponimo.com"] });
    for (const x of ["hello@reforms.ai", "info@gptkino.com", "carapis.com", "cmdop.com", "mlsbali.com", "toponimo.com"]) expect(id).toContain(x);
    expect(id).toMatch(/never refuse it as another project's/);
    const prompt = bindingPrompt("saas-support", "projects", id);
    expect(prompt.endsWith(id)).toBe(true);
    expect(prompt).toContain(sessionRules("saas-support"));
    const a = buildClaudeArgs({ mode: "new", project: "saas-support", extra: [], identity: id }, [MAP]);
    expect(a[a.indexOf("--append-system-prompt") + 1]).toContain("carapis.com");
  });

  it("mail.domains is a project.md field: parsed lowercase, a non-domain refused", async () => {
    const { readProject } = await import("@hub/projects/parse");
    const md = (v: string) => ["# x", "", "## Settings", "", "| Field | Value | Answered | By |", "|---|---|---|---|", "| schema | 1 | 2026-11-14 | agent |", "| mail.accounts | a@x.example | 2026-11-14 | agent |", "| mail.addresses | a@x.example | 2026-11-14 | owner |", `| mail.domains | ${v} | 2026-11-18 | owner |`, ""].join("\n");
    expect(readProject(md("Carapis.com, cmdop.ai"), "x").config.mail.domains).toEqual(["carapis.com", "cmdop.ai"]);
    expect(() => readProject(md("not a domain"), "x")).toThrow(/is not a domain/);
  });
});

describe("P64: --resume <id> resumes one session, with the CURRENT flags", () => {
  it("parses --resume as a hub flag that needs a project and a UUID", () => {
    expect(parseAgentArgs(["acme", "--cli", "claude", "--resume", ID], ["acme"])).toEqual({ mode: "resume", project: "acme", extra: [], cli: "claude", resume: ID });
    expect(parseAgentArgs(["acme", `--resume=${ID}`], ["acme"]).resume).toBe(ID);
    expect(() => parseAgentArgs(["acme", "--resume", "../../etc"], ["acme"])).toThrow(/UUID/);
    expect(() => parseAgentArgs(["--resume", ID], ["acme"])).toThrow(/needs the project/);
    expect(parseAgentArgs(["acme", "--", "--resume", ID], ["acme"])).toMatchObject({ mode: "new", extra: ["--resume", ID] });
  });
  it("Claude: the resume argv is the fresh argv (settings, strict MCP, denied tools, binding prompt) with --resume <id> in front", () => {
    const files = { settings: "/s/settings.json", mcp: "/s/mcp.json", disallowed: ["mcp__mail__send"], rules: [], agent: DEFAULT_AGENT_SETTINGS };
    const plan: AgentPlan = { mode: "new", project: "acme", extra: [] };
    const fresh = buildClaudeArgs(plan, [MAP], files, "projects");
    const resumed = buildClaudeArgs({ ...plan, mode: "resume", resume: ID }, [MAP], files, "projects");
    expect(resumed).toEqual(["--resume", ID, ...fresh]);
    for (const f of [...claudeEnforcementArgs(files), "--append-system-prompt", bindingPrompt("acme", "projects"), "--dangerously-skip-permissions"]) expect(resumed).toContain(f);
  });
  it("P55: the advisor's rule line follows the binding prompt only when the project's advisor is on", () => {
    const files = { settings: "/s/settings.json", mcp: "/s/mcp.json", disallowed: [], rules: [], agent: DEFAULT_AGENT_SETTINGS };
    const plan: AgentPlan = { mode: "new", project: "acme", extra: [] };
    const prompt = (a: typeof files) => { const args = buildClaudeArgs(plan, [], a, "projects"); return args[args.indexOf("--append-system-prompt") + 1]; };
    expect(prompt(files)).toBe(bindingPrompt("acme", "projects"));
    expect(prompt({ ...files, agent: { ...DEFAULT_AGENT_SETTINGS, advisor: true } })).toBe(`${bindingPrompt("acme", "projects")}\n\n${ADVISOR_RULE}`);
    expect(sessionRules("acme")).not.toContain("advisor");
  });
});

describe("P64: resolveResume reads the session log; a refusal starts fresh and says why", () => {
  const setup = () => {
    const home = mkdtempSync(path.join(tmpdir(), "hub-resume-"));
    const paths = pathsAt(home);
    mkdirSync(paths.secrets, { recursive: true });
    const transcript = path.join(home, "t", `${ID}.jsonl`);
    mkdirSync(path.dirname(transcript), { recursive: true });
    writeFileSync(transcript, "{}\n");
    const store = logStoreOf(paths);
    const at = new Date("2026-11-19T06:02:48.000Z");
    appendEvents(store, [
      { ts: at.toISOString(), project: "acme", session: ID, cli: "claude", kind: "session", data: { phase: "start", transcript } },
      { ts: "2026-11-19T06:03:02.000Z", project: "acme", session: ID, cli: "claude", kind: "prompt", data: { text: "о чем мы?" } },
    ], at);
    return { paths };
  };
  it("an id the log has for this project and CLI is resumed; another project's or CLI's is refused", () => {
    const { paths } = setup();
    const o = { paths, instructions: "x" };
    expect(resolveResume({ mode: "resume", project: "acme", resume: ID, extra: [] }, "claude", o)).toEqual({ plan: { mode: "resume", project: "acme", resume: ID, extra: [] }, line: null });
    const other = resolveResume({ mode: "resume", project: "beta", resume: ID, extra: [] }, "claude", o);
    expect(other.plan).toEqual({ mode: "new", project: "beta", extra: [] });
    expect(other.line).toMatch(/^Not resumed: the log has no claude session 8d31964d of beta\. A fresh session\.$/);
    expect(resolveResume({ mode: "resume", project: "acme", resume: ID, extra: [] }, "codex", o).plan.mode).toBe("new");
  });
  it("continue resolves the bound project's last session (no cut-off), else a fresh one with a line", () => {
    const { paths } = setup();
    expect(resolveResume({ mode: "continue", project: "acme", extra: [] }, "claude", { paths, instructions: "x", now: new Date("2027-01-01T00:00:00Z") }).plan).toMatchObject({ mode: "resume", resume: ID });
    expect(resolveResume({ mode: "continue", project: "beta", extra: [] }, "claude", { paths, instructions: "x" })).toEqual({ plan: { mode: "new", project: "beta", extra: [] }, line: "No earlier session of this project to continue: a fresh session." });
  });
  it("a fresh start is left alone", () => {
    const { paths } = setup();
    const plan: AgentPlan = { mode: "new", project: "acme", extra: [] };
    expect(resolveResume(plan, "claude", { paths, instructions: "x" })).toEqual({ plan, line: null });
  });
  it("P164: the launcher's second check keeps a modern Codex resume id and the native resume argv", () => {
    const { paths } = setup();
    const transcript = path.join(paths.codexHomes, "acme", "sessions", `${ID}.jsonl`);
    mkdirSync(path.dirname(transcript), { recursive: true });
    const message = (...text: string[]) => JSON.stringify({ type: "response_item", payload: { type: "message", role: "developer", content: text.map((text) => ({ type: "input_text", text })) } });
    writeFileSync(transcript, [message("Codex model rules"), message("CLI skills", "CURRENT HUB RULES", "CLI permissions")].join("\n"));
    appendEvents(logStoreOf(paths), [
      { ts: "2026-11-19T06:02:48.000Z", project: "acme", session: ID, cli: "codex", kind: "session", data: { phase: "start", transcript } },
      { ts: "2026-11-19T06:03:02.000Z", project: "acme", session: ID, cli: "codex", kind: "prompt", data: { text: "remember this" } },
    ], new Date("2026-11-19T06:03:02.000Z"));
    for (const mode of ["continue", "resume"] as const) {
      const r = resolveResume({ mode, project: "acme", resume: ID, extra: [] }, "codex", { paths, instructions: "CURRENT HUB RULES" });
      expect(r.line).toBeNull();
      expect(r.plan).toMatchObject({ mode: "resume", resume: ID });
      expect(buildCodexArgs(r.plan, paths).slice(0, 2)).toEqual(["resume", ID]);
    }
  });
});

describe("P165: resume failures preserve the conversation", () => {
  const plan: AgentPlan = { mode: "resume", project: "acme", resume: ID, extra: [] };
  it.each([1, 2, 130])("exit %i never launches a blank replacement", async (exitCode) => {
    const runs: AgentPlan[] = [];
    const said: string[] = [];
    const code = await startSession(plan, async (p) => { runs.push(p); return exitCode; }, { cli: "codex", say: (l) => said.push(l) });
    expect(code).toBe(exitCode);
    expect(runs).toEqual([plan]);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(`hub agent acme --cli codex --resume ${ID}`);
    expect(said[0]).toContain("No new session was started");
  });
  it("successful resume and an explicit new session run once without a failure message", async () => {
    const runs: AgentPlan[] = [];
    const said: string[] = [];
    const start = async (p: AgentPlan) => { runs.push(p); return p.mode === "new" ? 1 : 0; };
    expect(await startSession(plan, start, { cli: "claude", say: (l) => said.push(l) })).toBe(0);
    const fresh: AgentPlan = { mode: "new", project: "acme", extra: [] };
    expect(await startSession(fresh, start, { cli: "claude", say: (l) => said.push(l) })).toBe(1);
    expect(runs).toEqual([plan, fresh]);
    expect(said).toEqual([]);
  });
});

import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bindingPrompt, buildClaudeArgs, buildCodexArgs, extraDirs, listProjects, parseAgentArgs } from "../src/agent";
import { claudeBaseArgs } from "@hub/agent/claude";
import { pathsAt } from "@hub/config/paths";
import { installLink, linkState, planLink, removeLink } from "../src/link";
import { UsageError } from "../src/term";

const MAP = "/h/shared/notes";

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
  it("base flags: normal mode asks (no bypass), unattended skips the prompts", () => {
    expect(claudeBaseArgs(false, [MAP])).toEqual(["--chrome", "--add-dir", MAP]);
    expect(claudeBaseArgs(true)).toEqual(["--dangerously-skip-permissions", "--chrome"]);
  });
  it("continue and pick lead with their flag", () => {
    expect(buildClaudeArgs({ mode: "continue", extra: [] }, [MAP])[0]).toBe("--continue");
    expect(buildClaudeArgs({ mode: "pick", extra: [] }, [MAP])[0]).toBe("--resume");
    expect(buildClaudeArgs({ mode: "new", extra: [] }, [MAP])).toEqual(claudeBaseArgs(false, [MAP]));
    expect(buildClaudeArgs({ mode: "new", extra: [] }, [MAP], undefined, undefined, true)).toEqual(claudeBaseArgs(true, [MAP]));
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
  it("never carries the bypass flag; unattended means approvals never, normal on-request", () => {
    for (const unattended of [true, false]) {
      const a = buildCodexArgs({ mode: "new", extra: [] }, paths, unattended);
      expect(a.join(" ")).not.toMatch(/dangerously|yolo/);
      expect(a).toEqual(["-C", home, "-a", unattended ? "never" : "on-request"]);
    }
    expect(buildCodexArgs({ mode: "continue", extra: [] }, paths, true).slice(0, 2)).toEqual(["resume", "--last"]);
  });
  it("refuses the bypass flag even when it is passed through", () => {
    expect(() => buildCodexArgs({ mode: "new", extra: ["--dangerously-bypass-approvals-and-sandbox"] }, paths, true)).toThrow(/sandbox off/);
    expect(() => buildCodexArgs({ mode: "new", extra: ["--yolo"] }, paths, false)).toThrow(/sandbox off/);
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
    expect(t).toContain("project=acme");
    expect(t).toContain("hub agent <other>");
    expect(t).not.toContain("agent.sh");
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

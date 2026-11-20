import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { codexSessionPaths, hubPaths, type HubPaths } from "@hub/config/paths";
import { BROWSER_TOOL_TIMEOUT_SEC, browserRow, CLAUDE_CHROME_SERVER, CODEX_BROWSER_SERVER, codexBrowserServer, PLAYWRIGHT_MCP_VERSION, playwrightCli, type BrowserCheckInput } from "../src/browser";
import { claudeBaseArgs, claudeDisallowed, claudeSettings } from "../src/claude";
import { codexConfigToml } from "../src/codex";
import { sessionCapabilities } from "../src/connectors";
import { DENIED_TOOLS, denyRules } from "../src/deny";

// P77, decision 0040: both CLIs start with a browser, and nothing of the hub narrows it.

function instance(): { paths: HubPaths; projects: string } {
  const home = mkdtempSync(path.join(tmpdir(), "hub-browser-"));
  mkdirSync(path.join(home, "projects", "acme"), { recursive: true });
  return { paths: hubPaths({ home, env: {} }), projects: path.join(home, "projects") };
}

describe("Claude Code: Claude in Chrome", () => {
  it("every session starts with --chrome, in both modes", () => {
    expect(claudeBaseArgs(false)).toContain("--chrome");
    expect(claudeBaseArgs(true)).toContain("--chrome");
  });
  it("no deny rule, disallowed tool or settings rule names the Chrome tools, in either mode", () => {
    const { paths, projects } = instance();
    const all = [...DENIED_TOOLS, ...denyRules(projects, paths.home, "acme", paths), ...claudeDisallowed()];
    for (const unattended of [false, true]) all.push(...((claudeSettings({ paths, projectsDir: projects, slug: "acme", nodeBin: "/n/node", unattended }).permissions as { deny: string[] }).deny));
    expect(all.filter((r) => r.includes(CLAUDE_CHROME_SERVER) || /chrome/i.test(r))).toEqual([]);
  });
});

describe("Codex: Playwright MCP in the generated config", () => {
  it("the pinned package is installed and its cli.js resolves", () => {
    expect(existsSync(playwrightCli())).toBe(true);
    expect(PLAYWRIGHT_MCP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("one server per session: the hub's Node, the pinned cli.js, installed Chrome, the project's own profile; no tool disabled", () => {
    const { paths, projects } = instance();
    for (const unattended of [false, true]) {
      const toml = codexConfigToml({ paths, projectsDir: projects, slug: "acme", unattended, servers: {}, instructions: "acme only", nodeBin: "/n/node", playwrightCli: "/core/cli.js" });
      const p = codexSessionPaths(paths, "acme");
      const at = toml.indexOf(`[mcp_servers."${CODEX_BROWSER_SERVER}"]`);
      expect(at).toBeGreaterThan(0);
      const section = toml.slice(at).split("\n\n")[0] ?? "";
      expect(section).toContain('command = "/n/node"');
      expect(section).toContain(`args = ${JSON.stringify(["/core/cli.js", "--browser", "chrome", "--user-data-dir", p.browserProfile, "--output-dir", p.browserOutput]).replaceAll(",", ", ")}`);
      expect(section).toContain(`tool_timeout_sec = ${BROWSER_TOOL_TIMEOUT_SEC}`);
      expect(section).not.toMatch(/disabled_tools|enabled_tools/);
      // The profile holds the owner's sign-ins: a command of the session may not read it.
      expect(toml).toContain(`${JSON.stringify(p.browserProfile)} = "none"`);
    }
  });
  it("each project gets its own profile, an unbound session its own", () => {
    const { paths } = instance();
    const a = codexBrowserServer(paths, "acme", "/n/node", "/c.js").args;
    const b = codexBrowserServer(paths, "beta", "/n/node", "/c.js").args;
    const u = codexBrowserServer(paths, undefined, "/n/node", "/c.js").args;
    expect(new Set([a[4], b[4], u[4]]).size).toBe(3);
    expect(u[4]).toContain("_unbound");
  });
});

describe("the capabilities line names the browser and the send door", () => {
  it("per CLI", () => {
    const c = sessionCapabilities("acme", [], "claude");
    const x = sessionCapabilities("acme", [], "codex");
    expect(c).toContain("browser: Claude in Chrome");
    expect(x).toContain(`browser: Playwright MCP (${CODEX_BROWSER_SERVER})`);
    for (const l of [c, x]) expect(l).toMatch(/never a way to send: mail and messenger messages go only through the hub's drafts and its send door/);
  });
});

describe("the Browser row", () => {
  const base = (o: Partial<BrowserCheckInput> & Pick<BrowserCheckInput, "cli">): BrowserCheckInput => {
    const { paths } = instance();
    const claudeJson = path.join(paths.home, "claude.json");
    writeFileSync(claudeJson, JSON.stringify({ cachedChromeExtensionInstalled: true }));
    return { paths, slug: "acme", signedIn: { ready: true, detail: "2.1.220 · signed in (claude.ai)" }, denied: [], codexSection: `[mcp_servers."${CODEX_BROWSER_SERVER}"]`, answer: async () => ({ ok: true, tools: ["browser_navigate"], detail: "" }), prepare: "hub agent acme --prepare", claudeJson, chromeApp: paths.home, ...o };
  };
  it("Claude: works; an API-key sign-in or no extension is a look; a deny rule on Chrome fails", async () => {
    expect(await browserRow(base({ cli: "claude" }))).toMatchObject({ id: "browser", title: "Browser", state: "pass", fix: null });
    expect(await browserRow(base({ cli: "claude", signedIn: { ready: true, detail: "2.1.220 · signed in (api_key)" } }))).toMatchObject({ state: "warn", fix: "claude auth login" });
    expect(await browserRow(base({ cli: "claude", claudeJson: "/nonexistent.json" }))).toMatchObject({ state: "warn", fix: "/chrome" });
    expect((await browserRow(base({ cli: "claude", denied: [`mcp__${CLAUDE_CHROME_SERVER}__navigate`] }))).state).toBe("fail");
  });
  it("Codex: works; no section, no Chrome, no answer each fail with the fix", async () => {
    expect(await browserRow(base({ cli: "codex" }))).toMatchObject({ state: "pass", fix: null });
    expect(await browserRow(base({ cli: "codex", codexSection: "" }))).toMatchObject({ state: "fail", fix: "hub agent acme --prepare" });
    expect((await browserRow(base({ cli: "codex", chromeApp: "/nonexistent.app" }))).state).toBe("fail");
    expect((await browserRow(base({ cli: "codex", answer: async () => ({ ok: false, tools: [], detail: "no answer in 10 s" }) }))).detail).toMatch(/does not answer/);
  });
});

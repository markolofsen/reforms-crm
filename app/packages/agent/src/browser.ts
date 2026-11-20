import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { codexSessionPaths, type AgentCli, type HubPaths } from "@hub/config/paths";

// P77, decision 0040: the browser of each CLI in a hub session. The guard does not narrow it (owner, 2026-11-20).
// - Claude Code: Claude in Chrome, by `--chrome` (`claudeBaseArgs`): the owner's own Chrome and its sign-ins, through the extension.
//   Measured in the 2.1.220 binary: `--chrome` adds a stdio server `claude-in-chrome` to the same dynamic map as `--mcp-config`,
//   which `--strict-mcp-config` keeps (it drops only the disk configs). It needs a claude.ai sign-in (an API key or setup-token turns
//   it off) and the extension; in unattended mode (`--dangerously-skip-permissions`) the CLI starts it with its site checks skipped.
// - Codex: its own Chrome extension works only in the desktop app, so a hub Codex session gets Playwright MCP (pinned in this
//   package) in its generated config: installed Google Chrome, a persistent profile of the project's own under its Codex home.
//   The owner signs in there himself, once; the agent never types a password. `--extension` (his own Chrome, through the
//   Playwright bridge extension) is the way to his everyday sign-ins if he ever wants them in Codex.

/** The Claude Code server `--chrome` adds; no deny rule or disallowed tool may name it. */
export const CLAUDE_CHROME_SERVER = "claude-in-chrome";

/** The Codex session's browser server: its name in `config.toml`, so its tools are `playwright.browser_*`. */
export const CODEX_BROWSER_SERVER = "playwright";

/** The pinned `@playwright/mcp` (package.json, exact; released 2026-10-31, at least 14 days before it was pinned). */
export const PLAYWRIGHT_MCP_VERSION = "0.0.84";

/**
 * How long Codex lets one browser call run. Playwright's navigation timeout is 60 s and Codex cuts a tool call at 60 s by default:
 * cut first, the agent would see a generic error and retry (the same race P65 S5 fixed for `hub`).
 */
export const BROWSER_TOOL_TIMEOUT_SEC = 120;

/** Google Chrome, the browser Playwright starts (`--browser chrome`: the installed one; Playwright downloads none). */
export const CHROME_APP = "/Applications/Google Chrome.app";

/** The pinned server's `cli.js`, absolute (the package exports only its index and package.json). */
export function playwrightCli(): string {
  return path.join(path.dirname(createRequire(import.meta.url).resolve("@playwright/mcp/package.json")), "cli.js");
}

/**
 * The browser server of a Codex session: the hub's Node runs the pinned `cli.js` (Codex starts stdio servers with a minimal
 * environment, so no shim that needs `node` on PATH), headed, with the project's own profile and output folder.
 */
export function codexBrowserServer(paths: Pick<HubPaths, "codexHomes">, slug: string | undefined, nodeBin: string, cli: string = playwrightCli()): { type: "stdio"; command: string; args: string[] } {
  const p = codexSessionPaths(paths, slug);
  return { type: "stdio", command: nodeBin, args: [cli, "--browser", "chrome", "--user-data-dir", p.browserProfile, "--output-dir", p.browserOutput] };
}

/** The browser part of the capabilities line (0040 point 3): what it is, what it is for, and that it is no send path. */
export function browserCapability(cli: AgentCli): string {
  const use = "for reading the web and Notion pages; it is never a way to send: mail and messenger messages go only through the hub's drafts and its send door";
  return cli === "codex"
    ? `browser: Playwright MCP (${CODEX_BROWSER_SERVER}), Google Chrome with this project's own profile (a sign-in there is the owner's, typed by him, never by you), ${use}`
    : `browser: Claude in Chrome, the owner's Chrome and his sign-ins (a login page or CAPTCHA is his: stop and ask), ${use}`;
}

type State = "pass" | "warn" | "fail" | "skip";
export interface BrowserRow { id: string; title: string; state: State; detail: string; fix: string | null }

export interface BrowserCheckInput {
  paths: HubPaths;
  slug: string;
  cli: AgentCli;
  /** The detector's sign-in fact of this CLI: ready, and its detail (`… · signed in (claude.ai)`). */
  signedIn: { ready: boolean; detail: string };
  /** Claude: the session's deny rules and disallowed tools. */
  denied: readonly string[];
  /** Codex: the session's `config.toml` section of the browser server ("" when absent), and its text is null when there is no config. */
  codexSection: string | null;
  answer: (name: string, spec: Record<string, unknown>) => Promise<{ ok: boolean; tools: string[]; detail: string }>;
  prepare: string;
  /** `~/.claude.json` (the CLI records the paired extension there); default from HOME. */
  claudeJson?: string;
  chromeApp?: string;
  nodeBin?: string;
  /** The server's `cli.js`; default the pinned package. */
  playwrightCli?: string;
}

/** The Claude in Chrome extension as Claude Code recorded it: installed, or paired with a device. */
export function chromeExtensionSeen(file: string): boolean {
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as { cachedChromeExtensionInstalled?: unknown; chromeExtension?: { pairedDeviceId?: unknown } };
    return j.cachedChromeExtensionInstalled === true || Boolean(j.chromeExtension?.pairedDeviceId);
  } catch { return false; }
}

/** One "Browser" row per CLI (Settings ▸ Agent, `hub doctor --only Agent`): works, or why not and the fix. Read only. */
export async function browserRow(i: BrowserCheckInput): Promise<BrowserRow> {
  const r = (state: State, detail: string, fix: string | null = null): BrowserRow => ({ id: "browser", title: "Browser", state, detail, fix: state === "pass" || state === "skip" ? null : fix });
  if (i.cli === "claude") {
    const narrowed = i.denied.filter((t) => t.includes(`mcp__${CLAUDE_CHROME_SERVER}`));
    if (narrowed.length) return r("fail", `a deny rule names the Chrome tools (${narrowed.join(", ")}); decision 0040 keeps them all`, "hub core update");
    if (!i.signedIn.ready) return r("skip", "Claude Code is not signed in");
    const method = /\(([^)]+)\)\s*$/.exec(i.signedIn.detail)?.[1];
    if (method && method !== "claude.ai") return r("warn", `signed in with ${method}: Claude Code keeps Claude in Chrome off unless it is signed in with claude.ai`, "claude auth login");
    if (!chromeExtensionSeen(i.claudeJson ?? path.join(process.env.HOME ?? "", ".claude.json"))) return r("warn", "Claude in Chrome: the extension was not seen on this Mac. Install it in Chrome, then type the line below in this project's Claude Code session", "/chrome");
    return r("pass", "Claude in Chrome (--chrome): your Chrome and its sign-ins, every tool of it");
  }
  const cli = i.playwrightCli ?? (() => { try { return playwrightCli(); } catch { return ""; } })();
  if (!cli || !existsSync(cli)) return r("fail", `Playwright MCP ${PLAYWRIGHT_MCP_VERSION} is not installed in the core`, "hub core update");
  if (!existsSync(i.chromeApp ?? CHROME_APP)) return r("fail", "Google Chrome is not installed: Playwright MCP starts the installed Chrome", "brew install --cask google-chrome");
  if (i.codexSection === null || i.codexSection === "") return r("fail", "the Codex config has no browser server yet", i.prepare);
  const a = await i.answer(CODEX_BROWSER_SERVER, codexBrowserServer(i.paths, i.slug, i.nodeBin ?? process.execPath, cli)).catch((e: Error) => ({ ok: false, tools: [] as string[], detail: e.message }));
  if (!a.ok) return r("fail", `Playwright MCP does not answer: ${a.detail}`, "hub doctor --only Agent");
  const profile = codexSessionPaths(i.paths, i.slug).browserProfile;
  return r("pass", `Playwright MCP ${PLAYWRIGHT_MCP_VERSION}, ${a.tools.length} tools; Chrome profile ${profile} (${existsSync(profile) ? "used before" : "new: sign in to a site there yourself, once"})`);
}

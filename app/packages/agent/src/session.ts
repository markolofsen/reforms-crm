import path from "node:path";
import type { AgentCli, HubPaths } from "@hub/config/paths";

// The one permission mode of a hub agent session (P49 section 5A; owner 2026-11-25: no friction, no switch), both CLIs: no
// prompts, and the OS sandbox is on by itself: no loopback or other network from commands, no Apple Events, and the files
// below are read-only. MCP connectors run in the CLI process, outside the sandbox, unchanged. Bypass without the sandbox does
// not exist. The mode says nothing about who is there: a session the owner started is attended, a background run the Hub
// started is not (`backgroundRunOf` of `@hub/config/follow-ups`).

/** The versions the guards were measured on (research 21 section 5); older ones are a failed Agent tools row. */
export const MEASURED_VERSIONS: Record<AgentCli, string> = { claude: "2.1.220", codex: "0.146.0" };

export const CLI_LABELS: Record<AgentCli, string> = { claude: "Claude Code", codex: "Codex" };

/**
 * What a session may not write, absolute paths: the send policy and the generated session files
 * (`state/projects`), secrets, the Codex homes, the instance config (allow-list, switches), the core, the instance's
 * own launcher, Claude's project settings, the MCP file the session config is built from, and the git folder (hooks).
 * The project folder, the evidence ledger and the database stay writable: `hub sequences enrol|judge` write there (P129 A9 moves them into `hub mcp`; then the database folder becomes read-only).
 */
export function protectedPaths(paths: HubPaths): string[] {
  const home = paths.home;
  return [...new Set([
    paths.stateProjects,
    // Decision 0048: the instance's autopilot switch; the project's lives in send-policy.json under stateProjects.
    paths.autopilot,
    paths.secrets,
    paths.codexHomes,
    paths.configDir,
    paths.core,
    path.join(home, "core"),
    path.join(home, "run.sh"),
    path.join(home, ".claude"),
    // Codex reads project hooks from here; `hub agent` runs Codex with hook trust bypassed for its own generated hook (P51).
    path.join(home, ".codex"),
    paths.mcpFile,
    path.join(home, ".git"),
    path.join(home, "CLAUDE.md"),
    path.join(home, "AGENTS.md"),
  ])];
}

/**
 * Claude's protected paths: the shared list plus the agent session log (P54). Claude runs its hooks outside the sandbox (the
 * sandbox wraps the Bash tool), so the hooks still write the log while the agent cannot. Not in the Codex profile: whether
 * Codex runs hooks under it is unmeasured, and a read-only log there would be a silent one (P54 section 3, point 15).
 */
export const claudeProtectedPaths = (paths: HubPaths): string[] => [...new Set([...protectedPaths(paths), paths.log])];

/**
 * Claude Code's `sandbox` block of every session. `failIfUnavailable`: no sandbox, no session (never a silent
 * unsandboxed run). No network allowlist: a command reaches no host, loopback included (the send route); the MCP
 * servers are the CLI's own calls. Apple Events stay off (no `osascript` to Mail).
 */
export function claudeSandbox(paths: HubPaths): Record<string, unknown> {
  return {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
    network: { allowedDomains: [], allowLocalBinding: false },
    filesystem: { denyWrite: claudeProtectedPaths(paths) },
  };
}

/** The Claude flags of the mode: no prompts; the generated settings carry the sandbox (`failIfUnavailable`). */
export const CLAUDE_MODE_ARGS: readonly string[] = ["--dangerously-skip-permissions"];

/** The Codex bypass flag. Never passed, in any mode: it turns the sandbox off, the only layer that held (research 21, test 6). */
export const CODEX_BYPASS = "--dangerously-bypass-approvals-and-sandbox";

/** The Codex flags of the mode: no approval prompts; the sandbox is the generated permissions profile. */
export const CODEX_MODE_ARGS: readonly string[] = ["-a", "never"];

/** The one sentence the launcher and the terminal tab show for the mode. */
export const MODE_LINE = "no prompts, OS sandbox on (no network or Apple Events from commands; policy, config and core read-only)";

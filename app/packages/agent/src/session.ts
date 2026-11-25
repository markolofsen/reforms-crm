import path from "node:path";
import type { AgentCli, HubPaths } from "@hub/config/paths";

// The one permission mode of a hub agent session (P49 section 5A; owner 2026-11-25: no friction, no switch), both CLIs: no
// prompts, and the OS sandbox is on by itself: no network from commands (loopback included), no Apple Events, and the files
// below are read-only. MCP connectors run in the CLI process, outside the sandbox, unchanged. Bypass without the sandbox does
// not exist. The mode says nothing about who is there: a session the owner started is attended, a background run the Hub
// started is not (`backgroundRunOf` of `@hub/config/follow-ups`).

/** The versions the guards were measured on (research 21 section 5); older ones are a failed Agent tools row. */
export const MEASURED_VERSIONS: Record<AgentCli, string> = { claude: "2.1.220", codex: "0.146.0" };

export const CLI_LABELS: Record<AgentCli, string> = { claude: "Claude Code", codex: "Codex" };

/**
 * What an owner's session may not write, absolute paths (3l, owner 2026-11-25: "По умолчанию агенты получают полный доступ…
 * Захуя запрещать-то?"): only what holds the agent's own permissions and guards, so it cannot unlock itself. That is the session
 * files and the send policy (`state/projects`), the autopilot switch, secrets, the Codex homes, the core (the guard, the deny rules
 * and the send door are its code) with the instance's launcher, Claude's and Codex's project settings, and the MCP files a session's
 * servers come from, plus the instance config file (its allow-list). Everything else is writable: the rest of `config/`,
 * project.md, knowledge, the instance's own git and memory files, the database folder. Background runs never use this list:
 * each builds its own tight profile.
 */
export function protectedPaths(paths: HubPaths): string[] {
  const home = paths.home;
  return [...new Set([
    paths.stateProjects,
    // Decision 0048: the instance's autopilot switch; the project's lives in send-policy.json under stateProjects.
    paths.autopilot,
    paths.secrets,
    paths.codexHomes,
    paths.configFile,
    path.join(paths.configDir, "mcp.json"),
    paths.core,
    path.join(home, "core"),
    path.join(home, "run.sh"),
    path.join(home, ".claude"),
    // Codex reads project hooks from here; `hub agent` runs Codex with hook trust bypassed for its own generated hook (P51).
    path.join(home, ".codex"),
    paths.mcpFile,
  ])];
}

/**
 * Claude's protected paths: the shared list plus the agent session log (P54). Claude runs its hooks outside the sandbox (the
 * sandbox wraps the Bash tool), so the hooks still write the log while the agent cannot. Not in the Codex profile: whether
 * Codex runs hooks under it is unmeasured, and a read-only log there would be a silent one (P54 section 3, point 15).
 */
export const claudeProtectedPaths = (paths: HubPaths): string[] => [...new Set([...protectedPaths(paths), paths.log])];

/**
 * Claude Code's `sandbox` block of an owner's session. `failIfUnavailable`: no sandbox, no session (never a silent unsandboxed
 * run). No network from commands, loopback included: the Hub's admin routes (the review's ticket, the batch run) trust a
 * same-site request, and a name denylist cannot keep loopback out (a DNS name that resolves to 127.0.0.1 passes it), so 3l's open
 * network waits for a door that does not trust loopback. Apple Events stay off. The MCP servers are the CLI's own calls.
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
export const MODE_LINE = "no prompts, OS sandbox on (no network or Apple Events from commands; secrets, the send policy, the guards and the core read-only)";

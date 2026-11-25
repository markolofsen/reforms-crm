import os from "node:os";
import path from "node:path";
import type { AgentCli, HubPaths } from "@hub/config/paths";

// The one permission mode of a hub agent session (P49 section 5A; owner 2026-11-25: no friction, no switch), both CLIs: no
// prompts, and the OS sandbox is on by itself: Claude's commands reach every host but loopback (3l; Codex's stay offline, its
// profile has no per-host rule), no Apple Events, and the files below are read-only. MCP connectors run in the CLI process, outside the sandbox, unchanged. Bypass without the sandbox does
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
 * 3l (coordinator, 2026-11-25): the owner's known token files outside the instance, unreadable in an owner's session now that its
 * network is open (a Read deny rule and the sandbox's denyRead). A fixed list, no prompts. `~/.zshrc` stays readable (too broad
 * to deny); the session rules say a key is never copied out of it.
 */
export const OWNER_SECRET_FILES: readonly string[] = [".google-multi-mcp/config.json", ".config/crm/notion.json", ".config/reforms-hub/openrouter-key", ".ssh", ".aws", ".netrc"];
/** The same files as absolute paths under `home` (the sandbox's denyRead). */
export const ownerSecretPaths = (home: string): string[] => OWNER_SECRET_FILES.map((f) => path.join(home, f));
/** The Read deny rules of those files (`~/` is the user's home in Claude's rules; a folder is denied with everything under it). */
const OWNER_SECRET_DIRS = new Set([".ssh", ".aws"]);
export const ownerSecretReadRules = (): string[] => OWNER_SECRET_FILES.flatMap((f) => (OWNER_SECRET_DIRS.has(f) ? [`Read(~/${f})`, `Read(~/${f}/**)`] : [`Read(~/${f})`]));

/**
 * The names a command may not reach (3l): loopback, where the Hub's own server and admin listen, and the public names known to
 * resolve to it. A defence in depth, not a wall: any other name that resolves to 127.0.0.1 still reaches the admin (the owner's
 * decision, 2026-11-25: open access, no pairing).
 */
export const LOOPBACK_HOSTS: readonly string[] = ["localhost", "*.localhost", "127.0.0.1", "::1", "0.0.0.0", "*.nip.io", "*.sslip.io", "*.xip.io", "localtest.me", "*.localtest.me", "lvh.me", "*.lvh.me", "*.vcap.me"];

/**
 * Claude Code's `sandbox` block of an owner's session. `failIfUnavailable`: no sandbox, no session (never a silent unsandboxed
 * run). 3l: every host is open (`*`) but {@link LOOPBACK_HOSTS}, and a local server may bind; the protected paths are
 * read-only. Apple Events stay off (no `osascript` to Mail). The MCP servers are the CLI's own calls.
 */
export function claudeSandbox(paths: HubPaths, home: string = os.homedir()): Record<string, unknown> {
  return {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: true,
    allowUnsandboxedCommands: false,
    network: { allowedDomains: ["*"], deniedDomains: [...LOOPBACK_HOSTS], allowLocalBinding: true },
    filesystem: { denyWrite: claudeProtectedPaths(paths), denyRead: [paths.secrets, ...ownerSecretPaths(home)] },
  };
}

/** The Claude flags of the mode: no prompts; the generated settings carry the sandbox (`failIfUnavailable`). */
export const CLAUDE_MODE_ARGS: readonly string[] = ["--dangerously-skip-permissions"];

/** The Codex bypass flag. Never passed, in any mode: it turns the sandbox off, the only layer that held (research 21, test 6). */
export const CODEX_BYPASS = "--dangerously-bypass-approvals-and-sandbox";

/** The Codex flags of the mode: no approval prompts; the sandbox is the generated permissions profile. */
export const CODEX_MODE_ARGS: readonly string[] = ["-a", "never"];

/** The one sentence the launcher and the terminal tab show for the mode. */
export const MODE_LINE = "no prompts, OS sandbox on (network open but loopback, no Apple Events; secrets, the send policy, the guards and the core read-only)";

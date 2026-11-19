import path from "node:path";
import type { AgentCli, HubPaths } from "@hub/config/paths";
import { denyRules, DENIED_TOOLS } from "./deny";
import { claudeModeArgs, claudeProtectedPaths, claudeSandbox } from "./session";

// A Claude Code session of `hub agent`, built without writing (the launcher writes it; the Agent tools check reads it).

export interface ClaudeSessionInput {
  paths: HubPaths;
  projectsDir: string;
  slug: string | undefined;
  /** The Node that runs the hub (the hooks call `hub guard` with it). */
  nodeBin: string;
  unattended: boolean;
}

/**
 * Edit rules for the protected paths, in every mode: the Edit and Write tools are not sandboxed (only commands are), so the
 * send policy and the session's own config need a deny rule as well (live, 2026-11-18: an unattended Edit of
 * send-policy.json went through with the sandbox alone). `./` is the instance root (where the session starts), `//` absolute.
 */
export function protectedEditRules(paths: HubPaths): string[] {
  const out: string[] = [];
  for (const p of claudeProtectedPaths(paths)) {
    const rel = path.relative(paths.home, p);
    const spec = rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? `./${rel.split(path.sep).join("/")}` : `/${p}`;
    out.push(`Edit(${spec})`, `Edit(${spec}/**)`);
  }
  return out;
}

/**
 * `state/projects/<slug>/settings.json`: deny rules, the guard hooks, and in unattended mode the sandbox. In unattended
 * mode the database folder is left out of the Read/Edit deny rules: Claude turns them into sandbox read and write
 * denials, and `hub record-draft` (the agent's one writer, decision 0009) must open the database. The database holds
 * no permission to send: a manual send needs a person's ticket (S12), an autosend the policy file (S11).
 */
export function claudeSettings(i: ClaudeSessionInput): Record<string, unknown> {
  const dbRules = new Set(["Read", "Edit"].map((t) => `${t}(./${(path.relative(i.paths.home, path.dirname(i.paths.db)) || ".").split(path.sep).join("/")}/**)`));
  const all = denyRules(i.projectsDir, i.paths.home, i.slug, i.paths);
  const deny = [...(i.unattended ? all.filter((r) => !dbRules.has(r)) : all), ...protectedEditRules(i.paths)];
  const hub = `${JSON.stringify(i.nodeBin)} ${JSON.stringify(i.paths.hubBin)} guard`;
  return {
    permissions: { deny },
    hooks: {
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: hub, timeout: 20 }] }],
      // P28 B3: the evidence ledger (what was read before each reply). Fires inside subagents too (S1), keyed by session_id and agent_id.
      PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: `${hub} --post`, timeout: 20 }] }],
      // P51: one `[Hub focus, data]` line per prompt while the admin's focus is fresh; nothing otherwise, never a block.
      UserPromptSubmit: [{ hooks: [{ type: "command", command: focusHookCommand(i.nodeBin, i.paths, "claude"), timeout: 5 }] }],
      // P54: the session log's other events. In the background (`async`), except the answer (Stop, StopFailure): measured in
      // print mode on 2.1.220, an async Stop hook wrote nothing, so it runs in line, after the answer is already shown.
      ...Object.fromEntries(CLAUDE_LOG_EVENTS.map((e) => [e, [{ hooks: [{ type: "command", command: logHookCommand(i.nodeBin, i.paths, "claude"), ...(CLAUDE_LOG_IN_LINE.has(e) ? { timeout: 10 } : { timeout: 20, async: true }) }] }]])),
    },
    ...(i.unattended ? { sandbox: claudeSandbox(i.paths) } : {}),
  };
}

/** The prompt hook of both CLIs (P51): `hub focus --hook`, with the hub's own Node. It also logs the prompt (P54), so it names its CLI. */
export const focusHookCommand = (nodeBin: string, paths: HubPaths, cli: AgentCli): string => `${JSON.stringify(nodeBin)} ${JSON.stringify(paths.hubBin)} focus --hook --cli ${cli}`;

/** The session log hook of both CLIs (P54): `hub log --hook --cli <cli>`. */
export const logHookCommand = (nodeBin: string, paths: HubPaths, cli: AgentCli): string => `${JSON.stringify(nodeBin)} ${JSON.stringify(paths.hubBin)} log --hook --cli ${cli}`;

/**
 * Claude Code events `hub log --hook` takes (P54). The prompt is logged by the focus hook and the tool calls by `hub guard`
 * (both already run), so neither is here.
 */
export const CLAUDE_LOG_EVENTS = ["SessionStart", "Stop", "StopFailure", "Notification", "PostToolUseFailure", "PermissionDenied", "SessionEnd"] as const;
const CLAUDE_LOG_IN_LINE: ReadonlySet<string> = new Set(["Stop", "StopFailure"]);

export interface ClaudeFiles { settings: string; mcp: string; disallowed: string[] }

/** Flags that enforce the files. `=` forms: the variadic flags would otherwise swallow the next argument. */
export function claudeEnforcementArgs(f: ClaudeFiles): string[] {
  return ["--settings", f.settings, "--strict-mcp-config", `--mcp-config=${f.mcp}`, `--disallowedTools=${f.disallowed.join(",")}`];
}

/** Fixed flags of a mode, then Chrome for web and Notion checks, then the extra readable folders. */
export const claudeBaseArgs = (unattended: boolean, extraDirs: string[] = []): string[] => [...claudeModeArgs(unattended), "--chrome", ...extraDirs.flatMap((d) => ["--add-dir", d])];

export const claudeDisallowed = (): string[] => [...DENIED_TOOLS];

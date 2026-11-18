import path from "node:path";
import type { HubPaths } from "@hub/config/paths";
import { denyRules, DENIED_TOOLS } from "./deny";
import { claudeModeArgs, claudeSandbox, protectedPaths } from "./session";

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
  for (const p of protectedPaths(paths)) {
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
      UserPromptSubmit: [{ hooks: [{ type: "command", command: focusHookCommand(i.nodeBin, i.paths), timeout: 5 }] }],
    },
    ...(i.unattended ? { sandbox: claudeSandbox(i.paths) } : {}),
  };
}

/** The prompt hook of both CLIs (P51): `hub focus --hook`, with the hub's own Node. */
export const focusHookCommand = (nodeBin: string, paths: HubPaths): string => `${JSON.stringify(nodeBin)} ${JSON.stringify(paths.hubBin)} focus --hook`;

export interface ClaudeFiles { settings: string; mcp: string; disallowed: string[] }

/** Flags that enforce the files. `=` forms: the variadic flags would otherwise swallow the next argument. */
export function claudeEnforcementArgs(f: ClaudeFiles): string[] {
  return ["--settings", f.settings, "--strict-mcp-config", `--mcp-config=${f.mcp}`, `--disallowedTools=${f.disallowed.join(",")}`];
}

/** Fixed flags of a mode, then Chrome for web and Notion checks, then the extra readable folders. */
export const claudeBaseArgs = (unattended: boolean, extraDirs: string[] = []): string[] => [...claudeModeArgs(unattended), "--chrome", ...extraDirs.flatMap((d) => ["--add-dir", d])];

export const claudeDisallowed = (): string[] => [...DENIED_TOOLS];

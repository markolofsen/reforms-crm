import path from "node:path";
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from "@hub/config";
import type { AgentCli, HubPaths } from "@hub/config/paths";
import { connectorDeniedTools, type AttachedConnector } from "./connectors";
import { deniedTools, denyRules } from "./deny";
import { CLAUDE_MODE_ARGS, claudeProtectedPaths, claudeSandbox, ownerSecretReadRules } from "./session";
import { coreAccess } from "./core-access";

// A Claude Code session of `hub agent`, built without writing (the launcher writes it; the Agent tools check reads it).

export interface ClaudeSessionInput {
  paths: HubPaths;
  projectsDir: string;
  slug: string | undefined;
  /** The Node that runs the hub (the hooks call `hub guard` with it). */
  nodeBin: string;
  /** P55: the project's model and advisor (Settings ▸ Agent); the default when left out. */
  agent?: AgentSettings;
  /** P62: the project's attached connectors; every tool of theirs off the allowlist is denied by name. */
  connectors?: readonly AttachedConnector[];
}

/** Claude Code's own off switch for the advisor tool: an absent `advisorModel` cannot unset the owner's personal one. */
export const ADVISOR_OFF_ENV = "CLAUDE_CODE_DISABLE_ADVISOR_TOOL";

/**
 * P55: the model keys of the session's settings.json. Pinned per project, so a hub session never inherits the owner's
 * personal `model` or `advisorModel` from `~/.claude/settings.json` (`--settings` is a higher layer than the user's file;
 * a key it leaves out falls through). Advisor on: `advisorModel`. Off: no `advisorModel`, and the CLI's disable variable in
 * `env` (`hub agent` also sets it in the child's environment, the authoritative copy).
 */
export function claudeModelSettings(a: AgentSettings = DEFAULT_AGENT_SETTINGS): Record<string, unknown> {
  return a.advisor ? { model: a.model, advisorModel: a.advisorModel } : { model: a.model, env: { [ADVISOR_OFF_ENV]: "1" } };
}

/**
 * P55: the rule line of a Claude session with the advisor on (Codex has no advisor tool; off, there is nothing to consult).
 * Appended after the binding prompt, never in `sessionRules()` (that text is shared with Codex and with `AGENTS.md`).
 */
export const ADVISOR_RULE =
  "Advisor: consult the `advisor` tool before you change project instructions (project.md, a workflow, knowledge), before a draft for a hard client, and before a step that cannot be undone. Not for lookups, and not when the owner gave an explicit instruction: then act.";

/**
 * Edit rules for the protected paths, in every mode: the Edit and Write tools are not sandboxed (only commands are), so the
 * send policy and the session's own config need a deny rule as well (live, 2026-11-18: a sandboxed Edit of
 * send-policy.json went through with the sandbox alone). `./` is the instance root (where the session starts), `//` absolute.
 */
export function protectedEditRules(paths: HubPaths): string[] {
  const out: string[] = [];
  // P159 part 2: Claude turns an Edit deny rule into a sandbox write denial, so the core is denied entry by entry (its git dir
  // stays writable for worktrees; measured on 2.1.220: one `Edit(//<core>/**)` made `.git/FETCH_HEAD` unwritable).
  const core = coreAccess(paths.core);
  const listed = claudeProtectedPaths(paths).flatMap((p) => (p === paths.core ? [...core.checkout, ...core.gitReadOnly] : [p]));
  for (const p of listed) {
    const rel = path.relative(paths.home, p);
    const spec = rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? `./${rel.split(path.sep).join("/")}` : `/${p}`;
    out.push(`Edit(${spec})`, `Edit(${spec}/**)`);
  }
  return out;
}

/**
 * P129 verdict 13 (decision 0045 point 13): the memory files of the folders above the instance (`@projects/CLAUDE.md`,
 * `crm/CLAUDE.md`: django-cfg, a lead-form check) are rules for developers of other projects. Claude Code loads every
 * `CLAUDE.md` from the working directory up; its `claudeMdExcludes` setting (picomatch on absolute paths, measured in the
 * 2.1.220 binary) drops them. The instance's own `CLAUDE.md` and the owner's `~/.claude/CLAUDE.md` stay.
 */
export function ancestorMemoryExcludes(home: string): string[] {
  const out: string[] = [];
  for (let dir = path.dirname(path.resolve(home)); ; dir = path.dirname(dir)) {
    const base = dir.split(path.sep).join("/").replace(/\/$/, "");
    out.push(`${base}/CLAUDE.md`, `${base}/CLAUDE.local.md`);
    if (path.dirname(dir) === dir) break;
  }
  return out;
}

/**
 * `state/projects/<slug>/settings.json`: deny rules, the guard hooks and the sandbox. The database folder is left out of the
 * Read/Edit deny rules: Claude turns them into sandbox read and write
 * denials, and `hub sequences enrol|judge` (until P129 A9 moves them into `hub mcp`, which records drafts outside the sandbox) must open the database. The database holds
 * no permission to send: a manual send needs a person's ticket (S12), an autosend the policy file (S11).
 */
export function claudeSettings(i: ClaudeSessionInput): Record<string, unknown> {
  const dbRules = new Set(["Read", "Edit"].map((t) => `${t}(./${(path.relative(i.paths.home, path.dirname(i.paths.db)) || ".").split(path.sep).join("/")}/**)`));
  const all = denyRules(i.projectsDir, i.paths.home, i.slug, i.paths);
  const deny = [...all.filter((r) => !dbRules.has(r)), ...connectorDeniedTools(i.connectors ?? []), ...protectedEditRules(i.paths), ...ownerSecretReadRules()];
  const hub = `${JSON.stringify(i.nodeBin)} ${JSON.stringify(i.paths.hubBin)} guard`;
  return {
    ...claudeModelSettings(i.agent),
    claudeMdExcludes: ancestorMemoryExcludes(i.paths.home),
    permissions: { deny },
    hooks: {
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: hub, timeout: 20 }] }],
      // The session ledger (Notion reads for the guard's update rule, messenger history reads). Fires inside subagents too, keyed by session_id and agent_id.
      PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: `${hub} --post`, timeout: 20 }] }],
      // P51: one `[Hub focus, data]` line per prompt while the admin's focus is fresh; nothing otherwise, never a block.
      UserPromptSubmit: [{ hooks: [{ type: "command", command: focusHookCommand(i.nodeBin, i.paths, "claude"), timeout: 5 }] }],
      // P54: the session log's other events. In the background (`async`), except the answer (Stop, StopFailure): measured in
      // print mode on 2.1.220, an async Stop hook wrote nothing, so it runs in line, after the answer is already shown.
      ...Object.fromEntries(CLAUDE_LOG_EVENTS.map((e) => [e, [{ hooks: [{ type: "command", command: logHookCommand(i.nodeBin, i.paths, "claude"), ...(CLAUDE_LOG_IN_LINE.has(e) ? { timeout: 10 } : { timeout: 20, async: true }) }] }, ...(e === "PostToolUseFailure" ? [POST_FAILURE_GUARD(hub)] : [])]])),
    },
    sandbox: claudeSandbox(i.paths),
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
/**
 * P154 verdict 5: an MCP error result fires `PostToolUseFailure`, whose only output is `additionalContext` (observed on 2.1.220),
 * so vendor guidance in it is answered with a note by `hub guard --post-failure`. Not async: an async hook cannot add context.
 */
const POST_FAILURE_GUARD = (hub: string) => ({ matcher: "mcp__.*", hooks: [{ type: "command", command: `${hub} --post-failure`, timeout: 10 }] });

export const CLAUDE_LOG_EVENTS = ["SessionStart", "Stop", "StopFailure", "Notification", "PostToolUseFailure", "PermissionDenied", "SessionEnd"] as const;
const CLAUDE_LOG_IN_LINE: ReadonlySet<string> = new Set(["Stop", "StopFailure"]);

export interface ClaudeFiles { settings: string; mcp: string; disallowed: string[] }

/** Flags that enforce the files. `=` forms: the variadic flags would otherwise swallow the next argument. */
export function claudeEnforcementArgs(f: ClaudeFiles): string[] {
  return ["--settings", f.settings, "--strict-mcp-config", `--mcp-config=${f.mcp}`, `--disallowedTools=${f.disallowed.join(",")}`];
}

/** The server `--chrome` adds (Claude in Chrome, the owner's extension); no deny rule or disallowed tool may name it (decision 0040). */
export const CLAUDE_CHROME_SERVER = "claude-in-chrome";

/**
 * The mode's fixed flags, then `--chrome` (decision 0040 as amended: the owner's own Claude in Chrome, every session,
 * all its tools; the Hub adds no browser), then the extra readable folders. Measured in the 2.1.220 binary: `--chrome` adds the
 * stdio server `claude-in-chrome` to the same dynamic map as `--mcp-config`, which `--strict-mcp-config` keeps.
 */
export const claudeBaseArgs = (extraDirs: string[] = []): string[] => [...CLAUDE_MODE_ARGS, "--chrome", ...extraDirs.flatMap((d) => ["--add-dir", d])];

/** `--disallowedTools` of an owner's session: the hub's denied tools (decision 0046) and, P62, every attached connector's tool off its allowlist. */
export const claudeDisallowed = (connectors: readonly AttachedConnector[] = []): string[] => [...deniedTools("owner"), ...connectorDeniedTools(connectors)];

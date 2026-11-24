import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { userInfo } from "node:os";
import { ACTION_ENV } from "@hub/config/action-id";
import { AUTOPILOT_CHAT_ENV, AUTOPILOT_HUB_TOOLS, AUTOPILOT_MAX_TURNS, AUTOPILOT_MODEL, AUTOPILOT_SKILL, type BrainTurn } from "@hub/config/autopilot";
import type { HubPaths } from "@hub/config/paths";
import { ADVISOR_OFF_ENV, ancestorMemoryExcludes } from "../claude";
import { deniedTools } from "../deny";
import { PROJECT_CAPABILITY_ENV } from "../mcp/binding";
import { HUB_MCP_ATTENDED_TOOLS, HUB_MCP_TOOLS } from "../mcp/server";

// One autopilot turn's Claude Code files and flags (decision 0048, P139 A3), built without spawning. The six rules A0 measured
// on Claude Code 2.1.220 (the plan, section 6) are here:
//   1. the child gets `USER`, `HOME` and `PATH` (the keychain item of the plan sign-in is found by user name), never an empty env;
//   2. `MCP_CONNECTION_NONBLOCKING=false` (print mode otherwise starts with `hub: pending`) and the advisor tool off;
//   3. `--tools ""` (no built-in tool: no Bash, Read, Write or WebFetch) plus `--disallowedTools` for every hub tool outside the
//      six (`--allowedTools` only pre-approves, it does not restrict);
//   4. `stream-json --verbose`, so the brain reads the `init` event first (`brain.ts` checks it);
//   5. the result is judged by `is_error` (`brain.ts`);
//   6. `--no-session-persistence`: no session file in `~/.claude/projects`.
// No hooks run (`disableAllHooks`): the hub's prompt hook would log the turn's prompt as the owner's words (decision 0046 reads
// them), and the owner's personal hooks are not the turn's. No shell exists, so there is no sandbox to set: the turn's reach is
// the six bound tools of its own `hub mcp` (verdict 28 as built).

/** The hub tools of a turn as Claude names them. */
export const AUTOPILOT_ALLOWED: readonly string[] = AUTOPILOT_HUB_TOOLS.map((t) => `mcp__hub__${t}`);

/** Every other hub tool (the attended send included) and the hub's deny list of every unattended session: denied by name. */
export const autopilotDisallowed = (): string[] => {
  const own = new Set<string>(AUTOPILOT_HUB_TOOLS);
  const hub = [...HUB_MCP_TOOLS, ...HUB_MCP_ATTENDED_TOOLS].filter((t) => !own.has(t)).map((t) => `mcp__hub__${t}`);
  return [...new Set([...hub, ...deniedTools(true)])];
};

/** Where one chat's turn files live: `state/projects/<slug>/autopilot/<chat row id>/` (per chat: the pool runs two at once). */
export const autopilotDir = (paths: Pick<HubPaths, "stateProjects">, project: string, chat: number): string => path.join(paths.stateProjects, project, "autopilot", String(chat));

/** The turn's settings file: the model, the advisor off, no hooks, no memory file of the folders above, the six tools pre-approved. */
export function autopilotSettings(dir: string, home: string): Record<string, unknown> {
  return {
    model: AUTOPILOT_MODEL,
    env: { [ADVISOR_OFF_ENV]: "1" },
    disableAllHooks: true,
    claudeMdExcludes: [...ancestorMemoryExcludes(dir), `${home.split(path.sep).join("/")}/.claude/CLAUDE.md`],
    permissions: { allow: [...AUTOPILOT_ALLOWED], deny: autopilotDisallowed() },
  };
}

/** The turn's MCP file: the core's `hub mcp` only, bound to the project (its capability) and to the one chat. */
export function autopilotMcp(o: { paths: Pick<HubPaths, "home" | "hubBin">; nodeBin: string; turn: BrainTurn; capability: string; db?: string | undefined }): Record<string, unknown> {
  const env: Record<string, string> = {
    HUB_HOME: o.paths.home,
    HUB_PROJECT: o.turn.chat.project,
    [PROJECT_CAPABILITY_ENV]: o.capability,
    [AUTOPILOT_CHAT_ENV]: String(o.turn.chat.chat),
    [ACTION_ENV]: o.turn.actionId,
    ...(o.db ? { HUB_DB: o.db } : {}),
  };
  return { mcpServers: { hub: { type: "stdio", command: o.nodeBin, args: [o.paths.hubBin, "mcp"], env } } };
}

export interface AutopilotFilesOnDisk {
  settings: string;
  mcp: string;
  /** The file holding the skill's text (`autopilotSkillText`), the turn's appended system prompt. */
  skill: string;
}

/** The CLI's flags. `=` forms for the variadic flags, and the prompt on stdin, so no flag swallows another argument. */
export function autopilotArgs(f: AutopilotFilesOnDisk, model: string = AUTOPILOT_MODEL, maxTurns: number = AUTOPILOT_MAX_TURNS): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    model,
    "--max-turns",
    String(maxTurns),
    "--tools",
    "",
    `--allowedTools=${AUTOPILOT_ALLOWED.join(",")}`,
    `--disallowedTools=${autopilotDisallowed().join(",")}`,
    "--permission-mode",
    "dontAsk",
    "--strict-mcp-config",
    `--mcp-config=${f.mcp}`,
    "--settings",
    f.settings,
    "--no-session-persistence",
    "--append-system-prompt-file",
    f.skill,
  ];
}

/** The keys of the server's environment a turn keeps; everything else (a session's `HUB_*`, `CLAUDECODE`, keys) stays out. */
const KEPT = ["HOME", "USER", "LOGNAME", "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "SHELL", "TERM"] as const;

/** Rule 1 and 2: the child's environment. `USER` from the OS when the server has none (the plan sign-in needs it). */
export function autopilotEnv(env: NodeJS.ProcessEnv, nodeBin: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const k of KEPT) if (env[k]) out[k] = env[k];
  const who = (() => {
    try {
      return userInfo().username;
    } catch {
      return undefined;
    }
  })();
  out.USER ??= who;
  out.LOGNAME ??= out.USER;
  out.HOME ??= (() => {
    try {
      return userInfo().homedir;
    } catch {
      return undefined;
    }
  })();
  const nodeDir = path.dirname(nodeBin);
  out.PATH = [nodeDir, ...(out.PATH ?? "/usr/bin:/bin").split(":").filter((d) => d && d !== nodeDir)].join(":");
  out.MCP_CONNECTION_NONBLOCKING = "false";
  out[ADVISOR_OFF_ENV] = "1";
  return out;
}

/** The skill the turn follows, without its frontmatter; null when the core has none (the turn then fails, never runs bare). */
export function autopilotSkillText(paths: Pick<HubPaths, "skills">): string | null {
  const f = path.join(paths.skills, AUTOPILOT_SKILL, "SKILL.md");
  if (!existsSync(f)) return null;
  const body = readFileSync(f, "utf8").replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  return body || null;
}

/** The turn's prompt: facts only (ids, counts, the mode and what the skill needs to know). Never a client's text. */
export function autopilotPrompt(t: BrainTurn): string {
  const lines = [
    `Autopilot turn ${t.actionId}: project ${t.chat.project}, chat:${t.chat.chat} (${t.chat.channel}).`,
    `The client wrote ${t.burst.messages} new message${t.burst.messages === 1 ? "" : "s"}, the first at ${t.burst.firstAt}.`,
    t.revise !== null ? `Your own draft ${t.revise} still waits in this chat: revise it with draft=${t.revise} for everything the client wrote since.` : "No draft waits in this chat.",
    t.disclose ? "This is your first message in this chat today: end it with the assistant line." : "No assistant line in this reply.",
    t.mode === "dry_run" ? "Dry run: the owner reads your draft before anything is sent." : "On: a draft with verdict send goes out without the owner's click.",
    "Follow the autopilot-reply rules of your system prompt, then stop.",
  ];
  return lines.join("\n");
}

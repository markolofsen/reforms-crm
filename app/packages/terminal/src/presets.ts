import path from "node:path";
import type { AgentCli } from "@hub/config/paths";
import { PRESET_LABELS, type TerminalPreset } from "@hub/contract/terminal";

// What a tab runs: a fixed server-side table (P49 S7). The browser names a preset and the project of its URL, never a
// command or a path. `claude` and `codex` type the core's own launcher into the shell, so cwd, HUB_HOME, Node, the
// linked skills, the deny rules, the strict MCP config, the sandbox and the guard are always `hub agent`'s.

/** Server variables a terminal never inherits: the database, the fake switches, the API port, Node flags. */
export const SERVER_ONLY_ENV = ["HUB_MAILER", "HUB_DB", "HUB_PORT", "HUB_CONNECTIONS_PROBE", "HUB_TERMINAL_SHELL", "HUB_AGENT_TOOLS", "NODE_OPTIONS"] as const;

export interface EnvInput {
  /** The server's environment. */
  base: NodeJS.ProcessEnv;
  home: string;
  project: string | null;
  /** The Node the server runs on: first on PATH (the owner's default `node` may be an old one). */
  nodeBin: string;
  /** The admin's resolved theme when the tab started: `COLORFGBG` says it to a CLI that reads it (the screen also answers OSC 10/11 queries). */
  theme?: "light" | "dark" | undefined;
}

/** rxvt's `COLORFGBG` (`fg;bg` as ANSI indexes): dark text on light, or light on dark. */
const COLORFGBG = { light: "0;15", dark: "15;0" } as const;

export function terminalEnv(i: EnvInput): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...i.base };
  for (const k of SERVER_ONLY_ENV) delete env[k];
  delete env.HUB_PROJECT;
  delete env.COLORFGBG;
  const lang = env.LANG && /utf-?8/i.test(env.LANG) ? env.LANG : "en_US.UTF-8";
  return {
    ...env,
    HUB_HOME: i.home,
    ...(i.project ? { HUB_PROJECT: i.project } : {}),
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: lang,
    TERM_PROGRAM: "hub",
    ...(i.theme ? { COLORFGBG: COLORFGBG[i.theme] } : {}),
    PATH: [path.dirname(i.nodeBin), env.PATH ?? ""].filter(Boolean).join(path.delimiter),
  };
}

/** The presets a tab offers, the instance's default CLI first, Shell last; only Shell without a project. */
export function presetOrder(defaultCli: AgentCli, hasProject: boolean): TerminalPreset[] {
  if (!hasProject) return ["shell"];
  return defaultCli === "codex" ? ["codex", "claude", "shell"] : ["claude", "codex", "shell"];
}

/**
 * The agent's argv for `claude` and `codex` (the core launcher, `hub agent <slug> --cli <x>`); null for `shell`. Never a
 * string a shell parses: v0.9.1 typed the command into an interactive zsh after its first output, and a keystroke or a
 * line-editor redraw that arrived first corrupted it ("zsh: no such file or directory: д/Users/..."). The slug is checked
 * against the registry by the caller.
 */
export function presetArgv(preset: TerminalPreset, project: string | null, o: { nodeBin: string; hubBin: string; resume?: string | undefined }): string[] | null {
  if (preset === "shell") return null;
  if (!project) throw new Error(`${PRESET_LABELS[preset]} needs a project`);
  // P64: the id comes from the session log, never from the browser; still checked here, so the argv stays a fixed shape.
  if (o.resume !== undefined && !RESUME_ID.test(o.resume)) throw new Error("resume takes a session id (a UUID)");
  return [o.nodeBin, o.hubBin, "agent", project, "--cli", preset, ...(o.resume ? ["--resume", o.resume] : [])];
}

/** A session id of Claude Code or Codex (the shape `hub agent --resume` accepts). */
const RESUME_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * What the PTY runs. Shell: the owner's login shell (`-l -i`). An agent: the same login shell for its environment (PATH,
 * nvm, the CLIs), which at once `exec`s the argv given as positional parameters (`-c 'exec "$0" "$@"'`): no prompt, no
 * typing, no parsing of the argv; the session ends when the agent exits.
 */
export function spawnLine(shell: string, argv: string[] | null): { file: string; args: string[] } {
  return argv ? { file: shell, args: ["-l", "-i", "-c", 'exec "$0" "$@"', ...argv] } : { file: shell, args: ["-l", "-i"] };
}

export const sessionTitle = (preset: TerminalPreset, project: string | null, resumed = false): string =>
  `${project ? `${project} · ${PRESET_LABELS[preset]}` : PRESET_LABELS[preset]}${resumed ? " · resumed" : ""}`;

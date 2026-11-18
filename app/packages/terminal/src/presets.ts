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
}

export function terminalEnv(i: EnvInput): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...i.base };
  for (const k of SERVER_ONLY_ENV) delete env[k];
  delete env.HUB_PROJECT;
  const lang = env.LANG && /utf-?8/i.test(env.LANG) ? env.LANG : "en_US.UTF-8";
  return {
    ...env,
    HUB_HOME: i.home,
    ...(i.project ? { HUB_PROJECT: i.project } : {}),
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: lang,
    TERM_PROGRAM: "hub",
    PATH: [path.dirname(i.nodeBin), env.PATH ?? ""].filter(Boolean).join(path.delimiter),
  };
}

/** The presets a tab offers, the instance's default CLI first, Shell last; only Shell without a project. */
export function presetOrder(defaultCli: AgentCli, hasProject: boolean): TerminalPreset[] {
  if (!hasProject) return ["shell"];
  return defaultCli === "codex" ? ["codex", "claude", "shell"] : ["claude", "codex", "shell"];
}

const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** The line typed into the shell after its first prompt; null for `shell`. The slug is checked against the registry by the caller. */
export function presetCommand(preset: TerminalPreset, project: string | null, o: { nodeBin: string; hubBin: string }): string | null {
  if (preset === "shell") return null;
  if (!project) throw new Error(`${PRESET_LABELS[preset]} needs a project`);
  return `${quote(o.nodeBin)} ${quote(o.hubBin)} agent ${project} --cli ${preset}`;
}

export const sessionTitle = (preset: TerminalPreset, project: string | null): string => (project ? `${project} · ${PRESET_LABELS[preset]}` : PRESET_LABELS[preset]);

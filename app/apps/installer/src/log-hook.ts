import { readFileSync } from "node:fs";
import { hubPaths } from "@hub/config/paths";
import { importQueued } from "@hub/log/claude-transcript";
import { importRollout } from "@hub/log/codex-rollout";
import type { LogCli } from "@hub/log/event";
import { hookEvents, parsePayload, promptEvents } from "@hub/log/hooks";
import { appendEvents, logStoreOf } from "@hub/log/store";

// The session log's hook entries (P54). `hub log --hook --cli <cli>` takes the events of `CLAUDE_LOG_EVENTS` (async in
// Claude) and `CODEX_LOG_EVENTS` (sync in Codex); the prompt comes from the focus hook (`logPrompt`). `bin/hub.mjs` starts
// this without the CLI. Every error is silence and exit 0: a log must never stop or slow a session.

const project = (env: NodeJS.ProcessEnv): string | null => env.HUB_PROJECT?.trim() || null;

/** The prompt and the focus line the prompt hook added. */
export function logPrompt(stdin: string, cli: LogCli, focusLine: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  const p = parsePayload(stdin);
  if (!p) return false;
  return appendEvents(logStoreOf(hubPaths({ env })), promptEvents(p, cli, project(env), focusLine));
}

/**
 * One hook event. A Codex `Stop` also imports that turn's tool calls from the rollout, before the answer; a Claude `Stop` the
 * messages the owner queued while the turn ran (they ran no prompt hook).
 */
export function logHook(stdin: string, cli: LogCli, env: NodeJS.ProcessEnv = process.env): boolean {
  const p = parsePayload(stdin);
  if (!p) return false;
  const store = logStoreOf(hubPaths({ env }));
  const transcript = typeof p.transcript_path === "string" ? p.transcript_path : "";
  const session = typeof p.session_id === "string" ? p.session_id : "";
  if (cli === "codex" && p.hook_event_name === "Stop" && transcript && session) {
    importRollout(store, { file: transcript, project: project(env), session, ...(typeof p.turn_id === "string" ? { turn: p.turn_id } : {}) });
  }
  if (cli === "claude" && p.hook_event_name === "Stop" && transcript && session) {
    importQueued(store, { file: transcript, project: project(env), session, ...(typeof p.prompt_id === "string" ? { turn: p.prompt_id } : {}) });
  }
  return appendEvents(store, hookEvents(p, cli, project(env)));
}

export function runLogHook(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): void {
  try {
    const i = argv.indexOf("--cli");
    logHook(readFileSync(0, "utf8"), argv[i + 1] === "codex" ? "codex" : "claude", env);
  } catch {
    /* silence */
  }
}

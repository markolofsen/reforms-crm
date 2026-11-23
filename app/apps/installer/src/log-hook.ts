import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { readCoreVersion } from "@hub/config/core-version";
import { hubPaths, type HubPaths } from "@hub/config/paths";
import { importQueued } from "@hub/log/claude-transcript";
import { importRollout } from "@hub/log/codex-rollout";
import type { LogCli, NewLogEvent } from "@hub/log/event";
import { hookEvents, parsePayload, promptEvents } from "@hub/log/hooks";
import { appendEvents, logStoreOf } from "@hub/log/store";
import { configureOps, errFields, ops } from "@hub/log/ops";

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

/** P129 verdict 9: an 8-hex hash of each linked skill's `SKILL.md`, so `hub log` says which text ran (no `version:` key). */
export function skillHashes(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, e.name, "SKILL.md");
    if (existsSync(file)) out[e.name] = createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 8);
  }
  return out;
}

/** A session start also records the core version and the skill hashes (P129 A6); other events pass through. */
export function withSessionFacts(events: NewLogEvent[], paths: HubPaths): NewLogEvent[] {
  return events.map((e) => (e.kind === "session" && e.data.phase === "start" ? { ...e, data: { ...e.data, core: readCoreVersion(paths.home) ?? "unknown", skills: skillHashes(paths.skills) } } : e));
}

/**
 * One hook event. A Codex `Stop` also imports that turn's tool calls from the rollout, before the answer; a Claude `Stop` the
 * messages the owner queued while the turn ran (they ran no prompt hook).
 */
export function logHook(stdin: string, cli: LogCli, env: NodeJS.ProcessEnv = process.env): boolean {
  const p = parsePayload(stdin);
  if (!p) return false;
  const paths = hubPaths({ env });
  const store = logStoreOf(paths);
  const transcript = typeof p.transcript_path === "string" ? p.transcript_path : "";
  const session = typeof p.session_id === "string" ? p.session_id : "";
  if (cli === "codex" && p.hook_event_name === "Stop" && transcript && session) {
    importRollout(store, { file: transcript, project: project(env), session, ...(typeof p.turn_id === "string" ? { turn: p.turn_id } : {}) });
  }
  if (cli === "claude" && p.hook_event_name === "Stop" && transcript && session) {
    importQueued(store, { file: transcript, project: project(env), session, ...(typeof p.prompt_id === "string" ? { turn: p.prompt_id } : {}) });
  }
  return appendEvents(store, withSessionFacts(hookEvents(p, cli, project(env)), paths));
}

export function runLogHook(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): void {
  try {
    const i = argv.indexOf("--cli");
    logHook(readFileSync(0, "utf8"), argv[i + 1] === "codex" ? "codex" : "claude", env);
  } catch (e) {
    // A hook stays silent for the session (stderr would reach Claude Code); its failure is an ops line in the file only (P86).
    configureOps({ stderr: false });
    ops("agent").warn("the session log hook failed; this event is not in the agent log", { cli: argv.includes("codex") ? "codex" : "claude", ...errFields(e) });
  }
}

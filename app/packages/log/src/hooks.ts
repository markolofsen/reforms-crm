import { isActionId, toolActionOf } from "@hub/config/action-id";
import type { LogCli, NewLogEvent } from "./event";
import { notionWriteOf } from "./notion-writes";
import { capStrings, cut, TEXT_CAP, toolInput, toolOutput } from "./privacy";

// Hook input of Claude Code 2.1.220 and Codex 0.146 into log events (P54 section 3b). Fields read: `session_id`,
// `prompt_id` (Claude) or `turn_id` (Codex), `agent_id`, `transcript_path`, `cwd`, and per event `prompt`,
// `last_assistant_message`, `tool_name`, `tool_input`, `tool_response`, `tool_use_id`, `duration_ms`, `error`,
// `notification_type`, `message`, `reason`, `source`, `model`. A payload without a session id is no event.

export type HookPayload = Record<string, unknown>;

const str = (p: HookPayload, k: string): string | undefined => {
  const v = p[k];
  return typeof v === "string" && v !== "" ? v : undefined;
};
const num = (p: HookPayload, k: string): number | undefined => (typeof p[k] === "number" ? p[k] : undefined);

/** Parses a hook's stdin; anything but a JSON object is null. */
export function parsePayload(text: string): HookPayload | null {
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v)) : null;
  } catch {
    return null;
  }
}

/** The envelope every event of this payload shares, or null without a session id. */
export function envelope(p: HookPayload, cli: LogCli, project: string | null): Omit<NewLogEvent, "kind" | "data"> | null {
  const session = str(p, "session_id");
  if (!session) return null;
  const turn = str(p, "prompt_id") ?? str(p, "turn_id");
  const agent = str(p, "agent_id");
  return { project, session, cli, ...(turn ? { turn } : {}), ...(agent ? { agent } : {}) };
}

const tool = (p: HookPayload): string => str(p, "tool_name") ?? "?";
const corrOf = (p: HookPayload): { corr?: string } => {
  const c = str(p, "tool_use_id") ?? str(p, "call_id");
  return c ? { corr: c } : {};
};

/** UserPromptSubmit: the owner's prompt, and the focus line the hook added to it (when it added one). */
export function promptEvents(p: HookPayload, cli: LogCli, project: string | null, focusLine: string | null): NewLogEvent[] {
  const env = envelope(p, cli, project);
  const text = str(p, "prompt");
  if (!env || text === undefined) return [];
  const out: NewLogEvent[] = [{ ...env, kind: "prompt", data: { text: cut(text, TEXT_CAP) } }];
  if (focusLine) out.push({ ...env, kind: "focus", data: { line: focusLine } });
  return out;
}

/** PreToolUse (`hub guard`): the call, and the guard's violations when it saw any. */
export function toolCallEvents(p: HookPayload, cli: LogCli, project: string | null, guard?: { mode: string; violations: readonly string[] }): NewLogEvent[] {
  const env = envelope(p, cli, project);
  if (!env) return [];
  const name = tool(p);
  const notion = notionWriteOf(name, p.tool_input);
  const out: NewLogEvent[] = [{ ...env, ...corrOf(p), kind: "tool_call", data: { tool: name, input: toolInput(name, p.tool_input), ...(notion ? { notion } : {}) } }];
  if (guard?.violations.length) out.push({ ...env, ...corrOf(p), kind: "guard", data: { mode: guard.mode, tool: name, violations: [...guard.violations] } });
  return out;
}

/** PostToolUse (`hub guard --post`): the result, from the ORIGINAL response (before any slimming the hook prints). */
export function toolResultEvent(p: HookPayload, cli: LogCli, project: string | null): NewLogEvent | null {
  const env = envelope(p, cli, project);
  if (!env) return null;
  const name = tool(p);
  const ms = num(p, "duration_ms");
  return { ...env, ...corrOf(p), kind: "tool_result", data: { tool: name, output: toolOutput(name, p.tool_response), ...(ms !== undefined ? { ms } : {}) } };
}

/** Notification types that mean the CLI is waiting on the owner. Other notifications are not logged. */
const ASKING = new Set(["permission_prompt", "idle_prompt", "elicitation_dialog", "elicitation_url_dialog", "agent_needs_input"]);

/** The events of `hub log --hook`: session start and end, the answer, failures, and waits on the owner. */
export function hookEvents(p: HookPayload, cli: LogCli, project: string | null): NewLogEvent[] {
  const env = envelope(p, cli, project);
  if (!env) return [];
  const transcript = str(p, "transcript_path");
  const name = tool(p);
  switch (str(p, "hook_event_name")) {
    case "SessionStart":
      return [{ ...env, kind: "session", data: { phase: "start", ...pick(p, ["source", "model", "cwd"]), ...(transcript ? { transcript } : {}) } }];
    case "SessionEnd":
      return [{ ...env, kind: "session", data: { phase: "end", ...pick(p, ["reason"]) } }];
    case "Stop": {
      const text = str(p, "last_assistant_message");
      return [{ ...env, kind: "answer", data: { text: text === undefined ? null : cut(text, TEXT_CAP), ...(transcript ? { transcript } : {}) } }];
    }
    case "StopFailure":
      return [{ ...env, kind: "error", data: { source: "stop_failure", message: cut(str(p, "error") ?? str(p, "reason") ?? str(p, "message") ?? "", TEXT_CAP), detail: capStrings(rest(p)) } }];
    case "PostToolUseFailure":
      return [{ ...env, ...corrOf(p), kind: "tool_error", data: { tool: name, error: cut(str(p, "error") ?? "", TEXT_CAP), ...(p.is_interrupt === true ? { interrupt: true } : {}) } }];
    case "PermissionDenied":
      return [{ ...env, ...corrOf(p), kind: "tool_error", data: { tool: name, error: cut(str(p, "reason") ?? "", TEXT_CAP), denied: true } }];
    case "PermissionRequest":
      return [{ ...env, kind: "asked", data: { why: "permission_request", tool: name, input: toolInput(name, p.tool_input) } }];
    case "Notification": {
      const why = str(p, "notification_type");
      if (!why || !ASKING.has(why)) return [];
      return [{ ...env, kind: "asked", data: { why, ...(str(p, "message") ? { message: cut(str(p, "message") ?? "", TEXT_CAP) } : {}) } }];
    }
    case "UserPromptSubmit":
      return promptEvents(p, cli, project, null);
    default:
      return [];
  }
}

const COMMON = new Set(["session_id", "prompt_id", "turn_id", "transcript_path", "cwd", "scratchpad_dir", "permission_mode", "effort", "hook_event_name", "agent_id", "agent_type"]);
const rest = (p: HookPayload): Record<string, unknown> => Object.fromEntries(Object.entries(p).filter(([k]) => !COMMON.has(k)));
function pick(p: HookPayload, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = str(p, k);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

const TOOL_KINDS = new Set(["tool_call", "tool_result", "tool_error", "guard"]);

/**
 * P137 L1: every event carries the session's action (`HUB_ACTION`); a tool call's events the call's own (the session's id and the
 * call id's five letters), the same id `hub mcp` runs that call under, so its ops lines and the session log meet on one id.
 */
export function stampAction(events: NewLogEvent[], action: string | undefined): NewLogEvent[] {
  if (!isActionId(action)) return events;
  return events.map((e) => ({ ...e, action: TOOL_KINDS.has(e.kind) ? toolActionOf(action, e.corr) : action }));
}

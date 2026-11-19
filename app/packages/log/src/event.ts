import { z } from "zod";

// The one event model of the agent session log (P54). Every source writes this shape: the prompt hook, the guard hooks,
// `hub log --hook` and the Codex rollout import. A line that does not parse is skipped by the reader, never fatal.

export const LOG_CLIS = ["claude", "codex"] as const;
export type LogCli = (typeof LOG_CLIS)[number];

export const LOG_KINDS = ["session", "prompt", "focus", "answer", "tool_call", "tool_result", "tool_error", "asked", "guard", "error"] as const;
export type LogKind = (typeof LOG_KINDS)[number];

/** What each kind means, for `hub log --help` and the docs. A total map: a new kind fails the build until it is described. */
export const LOG_KIND_LABELS: Record<LogKind, string> = {
  session: "a session started or ended (with the native transcript's path)",
  prompt: "what the owner typed",
  focus: "the [Hub focus, data] line the prompt hook added",
  answer: "the agent's final message of a turn",
  tool_call: "a tool call, before it runs",
  tool_result: "a tool call's result",
  tool_error: "a tool call that failed or was refused",
  asked: "the CLI waited on the owner (a permission prompt, an idle wait, a permission request)",
  guard: "a violation the hub guard saw (warn or block)",
  error: "the turn ended on an error (an API failure)",
};

export const logEvent = z.object({
  v: z.literal(1),
  ts: z.string(),
  project: z.string().nullable(),
  session: z.string().min(1),
  cli: z.enum(LOG_CLIS),
  kind: z.enum(LOG_KINDS),
  /** Claude `prompt_id`, Codex `turn_id`: a prompt, its tool calls and its answer share it. */
  turn: z.string().optional(),
  /** The tool call id (`tool_use_id`, `call_id`): pairs a call with its result or error. */
  corr: z.string().optional(),
  /** A subagent's `agent_id`. */
  agent: z.string().optional(),
  data: z.record(z.string(), z.unknown()),
});
export type LogEvent = z.infer<typeof logEvent>;

/** An event before the writer stamps, redacts and caps it. */
export type NewLogEvent = Omit<LogEvent, "v" | "ts"> & { ts?: string };

export const isLogKind = (v: string): v is LogKind => (LOG_KINDS as readonly string[]).includes(v);
export const isLogCli = (v: string): v is LogCli => (LOG_CLIS as readonly string[]).includes(v);

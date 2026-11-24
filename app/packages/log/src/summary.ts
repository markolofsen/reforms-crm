import type { LogCli, LogEvent } from "./event";

// Analysis over the log (P54 section 3, point 12): sessions, turns, and where the agent asked instead of acting.
// A turn is one prompt and what followed it up to the next prompt (its `turn` id when the CLI gives one, else the order).

/**
 * asked_without_acting: the answer ends in a question and no tool ran; asked_after_acting: the same after tool calls;
 * waited_on_owner: a permission prompt, an idle wait or a permission request; no_answer: a prompt with no answer (the turn
 * stalled or the session was closed); errors: a tool error, a refusal or an API failure.
 */
export const TURN_FLAGS = ["asked_without_acting", "asked_after_acting", "waited_on_owner", "no_answer", "errors"] as const;
export type TurnFlag = (typeof TURN_FLAGS)[number];

export const TURN_FLAG_LABELS: Record<TurnFlag, string> = {
  asked_without_acting: "asked instead of acting",
  asked_after_acting: "asked after acting",
  waited_on_owner: "waited on the owner",
  no_answer: "no answer",
  errors: "errors",
};

export interface Turn {
  at: string;
  /** The turn's last event (P133: its time, for the median turn time). */
  end: string;
  /** P133: a tool call of the turn carried the owner's words (`owner_request`). */
  ownerWords: boolean;
  prompt: string | null;
  /** Messages the owner typed while the turn ran (Claude queues them mid-turn; they open no turn of their own). */
  queued: string[];
  focus: string | null;
  answer: string | null;
  tools: string[];
  errors: string[];
  asked: string[];
  guard: string[];
  flags: TurnFlag[];
}

export interface SessionSummary {
  session: string;
  project: string | null;
  cli: LogCli;
  start: string;
  end: string;
  transcript: string | null;
  prompts: number;
  answers: number;
  toolCalls: number;
  /** Tool names by number of calls, most first. */
  topTools: Array<[string, number]>;
  errors: number;
  guard: number;
  /** P133 (P131 verdict 6): tool calls that wrote to Notion (`data.notion` of the call). */
  notionWrites: number;
  turns: Turn[];
  flags: Record<TurnFlag, number>;
  friction: Friction;
}

/**
 * P133 (P129 section 6): the counters the agent layer is measured by, one week of use after A8 against the baseline of
 * 2026-11-19 to 2026-11-23 (32 shell writer calls, 20 of 23 evidence warnings on the owner's words, ToolSearch in 13 of 75 turns).
 */
export interface Friction {
  /** Shell calls of a deleted hub writer (`hub record-draft`, `hub record-client`): target 0. */
  shellWriters: number;
  /** Guard evidence warnings (thread and profile not read) in turns that carried the owner's words: target 0. */
  evidenceOnOwnerWords: number;
  /** Turns with a ToolSearch call: recorded. */
  toolSearchTurns: number;
  /** Turns with an AskUserQuestion call after the owner's prompt: target 0. */
  askUserTurns: number;
  /** Turns that asked instead of acting (`asked_without_acting`): target 0. */
  askedWithoutActing: number;
  /** The median seconds from a prompt to its turn's last event, over turns with a prompt; null with none. Recorded. */
  medianTurnSeconds: number | null;
}

/** A shell command that runs a hub writer (the agent records through the hub tools since P129 A3). */
const SHELL_WRITER = /\bhub\s+record-(draft|client)\b/;
/** The guard's evidence rule (`@hub/agent/evidence/ledger`): the thread and profile, or the Notion record, not read. */
const EVIDENCE_WARNING = /thread and profile|read this client's record/;
const BASH_TOOLS = new Set(["Bash", "exec_command", "shell"]);

const commandOf = (input: unknown): string => {
  if (!input || typeof input !== "object") return "";
  const v = "command" in input ? input.command : "cmd" in input ? input.cmd : undefined;
  return typeof v === "string" ? v : Array.isArray(v) ? v.map(String).join(" ") : "";
};

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};

/** The friction counters of one session's events and turns. */
export function frictionOf(events: readonly LogEvent[], turns: readonly Turn[]): Friction {
  const shellWriters = events.filter((e) => e.kind === "tool_call" && BASH_TOOLS.has(text(e.data.tool) ?? "") && SHELL_WRITER.test(commandOf(e.data.input))).length;
  const asked = turns.filter((t) => t.prompt !== null);
  return {
    shellWriters,
    evidenceOnOwnerWords: turns.filter((t) => t.ownerWords).reduce((n, t) => n + t.guard.filter((g) => EVIDENCE_WARNING.test(g)).length, 0),
    toolSearchTurns: turns.filter((t) => t.tools.includes("ToolSearch")).length,
    askUserTurns: asked.filter((t) => t.tools.includes("AskUserQuestion")).length,
    askedWithoutActing: turns.filter((t) => t.flags.includes("asked_without_acting")).length,
    medianTurnSeconds: medianTurn(asked),
  };
}

const medianTurn = (asked: readonly Turn[]): number | null => median(asked.map((t) => (Date.parse(t.end) - Date.parse(t.at)) / 1000).filter((x) => Number.isFinite(x) && x >= 0));

/** The counters over several sessions (a week of use): sums, and the median over all their turns. */
export function frictionTotal(sums: readonly SessionSummary[]): Friction {
  const add = (k: Exclude<keyof Friction, "medianTurnSeconds">) => sums.reduce((n, s) => n + s.friction[k], 0);
  return {
    shellWriters: add("shellWriters"),
    evidenceOnOwnerWords: add("evidenceOnOwnerWords"),
    toolSearchTurns: add("toolSearchTurns"),
    askUserTurns: add("askUserTurns"),
    askedWithoutActing: add("askedWithoutActing"),
    medianTurnSeconds: medianTurn(sums.flatMap((s) => s.turns).filter((t) => t.prompt !== null)),
  };
}

const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** True when a text's last sentence is a question (trailing markup and quotes ignored). */
export function endsInQuestion(t: string | null): boolean {
  if (!t) return false;
  const tail = t.trim().replace(/[\s*_`"'»)\]]+$/u, "");
  return /[?？]$/u.test(tail);
}

const emptyFlags = (): Record<TurnFlag, number> => ({ asked_without_acting: 0, asked_after_acting: 0, waited_on_owner: 0, no_answer: 0, errors: 0 });

function flagsOf(t: Omit<Turn, "flags">): TurnFlag[] {
  const out: TurnFlag[] = [];
  if (endsInQuestion(t.answer)) out.push(t.tools.length ? "asked_after_acting" : "asked_without_acting");
  if (t.asked.length) out.push("waited_on_owner");
  if (t.prompt !== null && t.answer === null) out.push("no_answer");
  if (t.errors.length) out.push("errors");
  return out;
}

const hasOwnerWords = (input: unknown): boolean => !!input && typeof input === "object" && "owner_request" in input && typeof input.owner_request === "string" && input.owner_request.trim() !== "";

/** The turns of one session's events (oldest first). Events before the first prompt form a turn with no prompt. */
export function turnsOf(events: readonly LogEvent[]): Turn[] {
  const turns: Array<Omit<Turn, "flags">> = [];
  let cur: Omit<Turn, "flags"> | null = null;
  const byId = new Map<string, Omit<Turn, "flags">>();
  const open = (at: string): Omit<Turn, "flags"> => {
    const t = { at, end: at, ownerWords: false, prompt: null, queued: [], focus: null, answer: null, tools: [], errors: [], asked: [], guard: [] };
    turns.push(t);
    return t;
  };
  for (const e of events) {
    if (e.kind === "session") continue;
    if (e.kind === "prompt" && e.data.queued === true) {
      const into: Omit<Turn, "flags"> = (e.turn ? byId.get(e.turn) : undefined) ?? cur ?? (cur = open(e.ts));
      into.queued.push(text(e.data.text) ?? "");
      continue;
    }
    if (e.kind === "prompt") {
      cur = open(e.ts);
      cur.prompt = text(e.data.text) ?? "";
      if (e.turn) byId.set(e.turn, cur);
      continue;
    }
    // A late answer may arrive after the next prompt was typed; its turn id finds it. Without one, the current turn.
    const t: Omit<Turn, "flags"> = (e.turn ? byId.get(e.turn) : undefined) ?? cur ?? (cur = open(e.ts));
    if (e.ts > t.end) t.end = e.ts;
    if (e.kind === "tool_call" && hasOwnerWords(e.data.input)) t.ownerWords = true;
    if (e.kind === "focus") t.focus = text(e.data.line);
    else if (e.kind === "answer") t.answer = text(e.data.text) ?? "";
    else if (e.kind === "tool_call") t.tools.push(text(e.data.tool) ?? "?");
    else if (e.kind === "tool_error" || e.kind === "error") t.errors.push(`${text(e.data.tool) ?? text(e.data.source) ?? "error"}: ${text(e.data.error) ?? text(e.data.message) ?? ""}`);
    else if (e.kind === "asked") t.asked.push(`${text(e.data.why) ?? "asked"}${text(e.data.tool) ? ` ${text(e.data.tool)}` : ""}`);
    else if (e.kind === "guard") t.guard.push(Array.isArray(e.data.violations) ? e.data.violations.map(String).join("; ") : "");
  }
  return turns.map((t) => ({ ...t, flags: flagsOf(t) }));
}

/** One summary per session, newest first. */
export function summarize(events: readonly LogEvent[]): SessionSummary[] {
  const by = new Map<string, LogEvent[]>();
  for (const e of events) by.set(e.session, [...(by.get(e.session) ?? []), e]);
  const out: SessionSummary[] = [];
  for (const [session, list] of by) {
    const first = list[0];
    const last = list[list.length - 1];
    if (!first || !last) continue;
    const counts = new Map<string, number>();
    for (const e of list) if (e.kind === "tool_call") { const n = text(e.data.tool) ?? "?"; counts.set(n, (counts.get(n) ?? 0) + 1); }
    const turns = turnsOf(list);
    const flags = emptyFlags();
    for (const t of turns) for (const f of t.flags) flags[f]++;
    const transcript = list.map((e) => text(e.data.transcript)).find((x) => x !== null) ?? null;
    out.push({
      session, project: first.project, cli: first.cli, start: first.ts, end: last.ts, transcript,
      prompts: list.filter((e) => e.kind === "prompt" && e.data.queued !== true).length,
      answers: list.filter((e) => e.kind === "answer").length,
      toolCalls: list.filter((e) => e.kind === "tool_call").length,
      topTools: [...counts].sort((a, b) => b[1] - a[1]),
      errors: list.filter((e) => e.kind === "tool_error" || e.kind === "error").length,
      guard: list.filter((e) => e.kind === "guard").length,
      notionWrites: list.filter((e) => e.kind === "tool_call" && e.data.notion !== undefined).length,
      turns, flags,
      friction: frictionOf(list, turns),
    });
  }
  return out.sort((a, b) => (a.start < b.start ? 1 : -1));
}

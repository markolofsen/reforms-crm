import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import path from "node:path";
import { logEvent, type LogCli, type LogEvent } from "./event";
import { ASKED_LABELS, labelOfTool, type Labelled } from "./feed-labels";
import { dayOf, projectDir, type LogStore } from "./store";
import { endsInQuestion } from "./summary";

// The agent activity feed (P59): a thin read of the tail of the session log (P54), never a second writer. What the admin
// gets is the label of each recent event (table 4c of the plan, in `feed-labels.ts`), the tone of each turn that ended
// (verdict 8) and whether the agent waits on the owner. Never a prompt, an answer, a command, a tool's input or output:
// the reply's only text is the label.

/** An event and its position in the log: `<day>:<byte offset>`, zero-padded so positions compare as strings. Append order, not time order (Codex writes a turn's calls at `Stop`, back-dated). */
export interface Placed { pos: string; e: LogEvent }
export const posOf = (day: string, offset: number): string => `${day}:${String(offset).padStart(12, "0")}`;

export type FeedState = "running" | "done" | "failed" | "refused";
export type FeedTone = "attention" | "ready" | "problem";
export interface FeedRow { id: string; at: string; cli: LogCli; session: string; label: string; state: FeedState; draft: number | null }
export interface FeedTurn { id: string; tone: FeedTone }
export interface Feed { rows: FeedRow[]; turns: FeedTurn[]; cursor: string; waiting: boolean }

/** The last `maxBytes` of one day file as placed events; a line cut by the window's start is dropped. */
function tailOf(file: string, day: string, maxBytes: number): { events: Placed[]; bytes: number } {
  let fd: number;
  try { fd = openSync(file, "r"); } catch { return { events: [], bytes: 0 }; }
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const out: Placed[] = [];
    let at = 0;
    if (start > 0) at = buf.indexOf(0x0a) + 1 || buf.length;
    while (at < buf.length) {
      const nl = buf.indexOf(0x0a, at);
      if (nl < 0) break; // a line still being written
      const line = buf.subarray(at, nl).toString("utf8");
      const pos = posOf(day, start + at);
      at = nl + 1;
      if (!line.trim()) continue;
      let raw: unknown;
      try { raw = JSON.parse(line); } catch { continue; }
      const r = logEvent.safeParse(raw);
      if (r.success) out.push({ pos, e: r.data });
    }
    return { events: out, bytes: buf.length };
  } finally {
    closeSync(fd);
  }
}

/** The end of one project's log: today's day file (UTC), and yesterday's when today's is shorter than the window. */
export function tailEvents(store: LogStore, project: string, now: Date = new Date(), maxBytes = 65_536): Placed[] {
  const dir = projectDir(store, project);
  const today = dayOf(now.toISOString());
  const yesterday = dayOf(new Date(now.getTime() - 86_400_000).toISOString());
  const recent = tailOf(path.join(dir, `${today}.jsonl`), today, maxBytes);
  return recent.bytes < maxBytes / 2 ? [...tailOf(path.join(dir, `${yesterday}.jsonl`), yesterday, maxBytes - recent.bytes).events, ...recent.events] : recent.events;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const viaOf = (e: LogEvent): string[] => (Array.isArray(e.data.via) ? e.data.via.filter((x): x is string => typeof x === "string") : []);
const turnKey = (e: LogEvent): string => `${e.session}:${e.turn ?? "-"}`;
const RANK: Record<FeedTone, number> = { ready: 1, attention: 2, problem: 3 };
const higher = (a: FeedTone | null, b: FeedTone): FeedTone => (a && RANK[a] >= RANK[b] ? a : b);

interface Paired { result?: Placed; error?: Placed }

/** Results and errors by call id. */
function pairs(events: readonly Placed[]): Map<string, Paired> {
  const out = new Map<string, Paired>();
  for (const p of events) {
    if (!p.e.corr || (p.e.kind !== "tool_result" && p.e.kind !== "tool_error")) continue;
    const cur = out.get(p.e.corr) ?? {};
    if (p.e.kind === "tool_result") cur.result = p;
    else cur.error = p;
    out.set(p.e.corr, cur);
  }
  return out;
}

function callLabel(e: LogEvent, paired: Paired | undefined): (Labelled & { state: FeedState }) | null {
  const err = paired?.error?.e;
  const state: FeedState = err ? (err.data.denied === true ? "refused" : "failed") : paired?.result ? "done" : "running";
  const l = labelOfTool(str(e.data.tool) ?? "?", e.data.input, paired?.result?.e.data.output, state === "done", viaOf(e));
  return l ? { ...l, state } : null;
}

/** What one event shows, or null when it is not shown. A tool call's state comes from its paired result or error. */
function rowOf(p: Placed, calls: Map<string, LogEvent>, paired: Map<string, Paired>): FeedRow | null {
  const { e } = p;
  const row = (label: string, draft: number | null = null, state: FeedState = "done"): FeedRow => ({ id: p.pos, at: e.ts, cli: e.cli, session: e.session.slice(0, 8), label: label.slice(0, 120), state, draft });
  switch (e.kind) {
    case "tool_call": {
      const l = callLabel(e, e.corr ? paired.get(e.corr) : undefined);
      return l ? row(l.label, l.draft, l.state) : null;
    }
    case "answer":
      return row(endsInQuestion(str(e.data.text)) ? "asks you a question" : "answered");
    case "asked": {
      const why = str(e.data.why) ?? "";
      const base = ASKED_LABELS[why]?.label ?? "waiting for you";
      const tool = str(e.data.tool);
      const l = why === "permission_request" && tool ? labelOfTool(tool, e.data.input, undefined, false) : null;
      return row(tool && why === "permission_request" ? `${base}: ${l?.label ?? tool}` : base);
    }
    case "guard": {
      const call = e.corr ? calls.get(e.corr) : undefined;
      const tool = str(e.data.tool) ?? "?";
      const l = labelOfTool(tool, call?.data.input, undefined, false, call ? viaOf(call) : []);
      return row(`guard warning: ${l?.label ?? tool}`, l?.draft ?? null);
    }
    case "error":
      return row("stopped on an error");
    default:
      return null; // prompt, focus, session, and results (they live on their call's row)
  }
}

/** Whether an event asks for the owner: a question at the end of a turn, or a wait that needs his answer. */
const asksOwner = (e: LogEvent): boolean => (e.kind === "answer" && endsInQuestion(str(e.data.text))) || (e.kind === "asked" && ASKED_LABELS[str(e.data.why) ?? ""]?.attention === true);
const endsTurn = (e: LogEvent): boolean => e.kind === "answer" || e.kind === "error" || asksOwner(e);

/** The tone of every turn that ended (verdict 8: highest wins; one per turn). Ordered by where it ended. */
function tonesOf(events: readonly Placed[], paired: Map<string, Paired>): FeedTurn[] {
  const tone = new Map<string, FeedTone | null>();
  const ended = new Map<string, string>();
  for (const { pos, e } of events) {
    const k = turnKey(e);
    let t = tone.get(k) ?? null;
    if (e.kind === "guard" || e.kind === "error") t = higher(t, "problem");
    if (asksOwner(e)) t = higher(t, "attention");
    if (e.kind === "tool_call") {
      const l = callLabel(e, e.corr ? paired.get(e.corr) : undefined);
      if (l?.ready) t = higher(t, "ready");
    }
    tone.set(k, t);
    if (endsTurn(e)) ended.set(k, pos);
  }
  return [...ended]
    .sort((a, b) => (a[1] < b[1] ? -1 : 1))
    .flatMap(([id]) => {
      const t = tone.get(id);
      return t ? [{ id, tone: t }] : [];
    });
}

/** Events that say nothing about whether the agent still waits: an idle reminder, a session's start. */
const quiet = (e: LogEvent): boolean => (e.kind === "asked" && str(e.data.why) === "idle_prompt") || (e.kind === "session" && e.data.phase === "start");

/** True when some session's latest event asks for the owner, under an hour ago, and nothing (a prompt, a call, its end) came after it. */
function waitingOf(events: readonly Placed[], now: Date): boolean {
  const last = new Map<string, LogEvent>();
  for (const { e } of events) if (!quiet(e)) last.set(e.session, e);
  return [...last.values()].some((e) => asksOwner(e) && now.getTime() - Date.parse(e.ts) < 3_600_000);
}

/** The feed of placed events (oldest position first): the newest `n` rows by time, the ended turns' tones, the cursor, and whether the agent waits. */
export function feedOf(events: readonly Placed[], now: Date = new Date(), n = 5): Feed {
  const paired = pairs(events);
  const calls = new Map<string, LogEvent>();
  for (const { e } of events) if (e.kind === "tool_call" && e.corr) calls.set(e.corr, e);
  const rows = events
    .map((p) => rowOf(p, calls, paired))
    .filter((r): r is FeedRow => r !== null)
    .sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1))
    .slice(0, n);
  return { rows, turns: tonesOf(events, paired).slice(-10), cursor: events[events.length - 1]?.pos ?? "", waiting: waitingOf(events, now) };
}

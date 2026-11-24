import { hubPaths } from "@hub/config/paths";
import { isLogCli, isLogKind, LOG_KINDS, type LogEvent, type LogKind } from "@hub/log/event";
import { readEvents, logStoreOf, type LogFilter } from "@hub/log/store";
import { frictionTotal, summarize, TURN_FLAG_LABELS, TURN_FLAGS, type Friction, type SessionSummary } from "@hub/log/summary";
import { c, UsageError } from "./term";

// `hub log` (P54): read the agent session log. Views: events (default), tail (follow), sessions, summary (where the agent
// asked instead of acting, waited on the owner, stalled or failed). Read only.

export const LOG_VIEWS = ["events", "tail", "sessions", "summary"] as const;
export type LogView = (typeof LOG_VIEWS)[number];

export interface LogOptions { project?: string; session?: string; kind?: string; cli?: string; since?: string; until?: string; limit?: string; json?: boolean }

/** `30m`, `6h`, `7d`, or an ISO date or time; relative to `now`. */
export function sinceOf(v: string, now: Date = new Date()): string {
  const m = /^(\d+)([mhd])$/.exec(v.trim());
  if (m) {
    const unit = m[2] === "m" ? 60_000 : m[2] === "h" ? 3_600_000 : 86_400_000;
    return new Date(now.getTime() - Number(m[1]) * unit).toISOString();
  }
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new UsageError(`--since takes 30m, 6h, 7d or a date, got "${v}"`);
  return new Date(t).toISOString();
}

export function filterOf(o: LogOptions, env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): LogFilter {
  const kinds: LogKind[] = [];
  for (const k of (o.kind ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    if (!isLogKind(k)) throw new UsageError(`--kind takes ${LOG_KINDS.join(", ")}, got "${k}"`);
    kinds.push(k);
  }
  if (o.cli && !isLogCli(o.cli)) throw new UsageError(`--cli takes claude or codex, got "${o.cli}"`);
  const project = o.project ?? (env.HUB_PROJECT?.trim() || undefined);
  return {
    ...(project ? { project } : {}),
    ...(o.session ? { session: o.session } : {}),
    ...(kinds.length ? { kinds } : {}),
    ...(o.cli && isLogCli(o.cli) ? { cli: o.cli } : {}),
    // A session id names its own window; otherwise the last 7 days.
    ...(o.since ? { since: sinceOf(o.since, now) } : o.session ? {} : { since: sinceOf("7d", now) }),
    ...(o.until ? { until: sinceOf(o.until, now) } : {}),
  };
}

const one = (s: string, n: number): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const t = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v));

/** One line of text for an event's data. */
/** `Notion write notion-update-page 1f2e…, 9a8b…`, from a tool call's `notion` field (`@hub/log`), else null. */
function notionLine(v: unknown): string | null {
  if (!v || typeof v !== "object" || !("action" in v) || typeof v.action !== "string") return null;
  const ids = "ids" in v && Array.isArray(v.ids) ? v.ids.map(String) : [];
  return `Notion write ${v.action}${ids.length ? ` ${ids.join(", ")}` : " (no page id in the call)"}`;
}

export function eventText(e: LogEvent): string {
  const d = e.data;
  switch (e.kind) {
    case "prompt": return `${d.queued === true ? "(queued) " : ""}${one(t(d.text), 200)}`;
    case "focus": return one(t(d.line), 200);
    case "answer": return one(t(d.text), 200);
    // P133 (P131 verdict 6): a Notion write names its action and the pages it touched.
    case "tool_call": return notionLine(d.notion) ?? `${t(d.tool)} ${one(t(d.input), 140)}`;
    case "tool_result": return `${t(d.tool)}${typeof d.ms === "number" ? ` ${d.ms} ms` : ""} ${one(t(d.output), 140)}`;
    case "tool_error": return `${t(d.tool)}${d.denied === true ? " (refused)" : ""}: ${one(t(d.error), 160)}`;
    case "asked": return `${t(d.why)}${d.tool ? ` ${t(d.tool)}` : ""}${d.message ? `: ${one(t(d.message), 140)}` : ""}`;
    case "guard": return `${t(d.mode)} ${t(d.tool)}: ${one(Array.isArray(d.violations) ? d.violations.map(String).join("; ") : "", 160)}`;
    case "session": return `${t(d.phase)}${d.source ? ` (${t(d.source)})` : ""}${d.reason ? ` (${t(d.reason)})` : ""}${d.core ? ` core ${t(d.core)}` : ""}${d.skills && typeof d.skills === "object" ? ` skills ${Object.entries(d.skills).map(([k, v]) => `${k}@${String(v)}`).join(" ")}` : ""}${d.transcript ? ` ${t(d.transcript)}` : ""}`;
    case "error": return `${t(d.source)}: ${one(t(d.message), 160)}`;
  }
}

const KIND_COLOR: Record<LogKind, (s: string) => string> = {
  session: c.dim, prompt: c.cyan, focus: c.dim, answer: c.green, tool_call: (s) => s, tool_result: c.dim, tool_error: c.yellow, asked: c.yellow, guard: c.yellow, error: c.yellow,
};

/** An event's time in the machine's local time zone, `YYYY-MM-DD HH:MM:SS` (the files keep UTC). */
export function localStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export const eventLine = (e: LogEvent): string =>
  `${c.dim(localStamp(e.ts))}  ${e.session.slice(0, 8)}  ${e.cli.padEnd(6)} ${KIND_COLOR[e.kind](e.kind.padEnd(11))} ${eventText(e)}`;

/** P133 (P129 section 6): the friction counters in one line. */
export const frictionLine = (fr: Friction): string =>
  `friction: shell writers ${fr.shellWriters}, evidence warnings on the owner's words ${fr.evidenceOnOwnerWords}, ToolSearch turns ${fr.toolSearchTurns}, AskUserQuestion turns ${fr.askUserTurns}, asked instead of acting ${fr.askedWithoutActing}, median turn ${fr.medianTurnSeconds === null ? "-" : `${Math.round(fr.medianTurnSeconds)} s`}`;

export function summaryLines(s: SessionSummary): string[] {
  const out = [
    `${c.bold(`session ${s.session.slice(0, 8)}`)}  ${s.cli}  ${s.project ?? "(unbound)"}  ${localStamp(s.start).slice(0, 16)} to ${localStamp(s.end).slice(11, 16)}`,
    `  ${s.prompts} prompts, ${s.answers} answers, ${s.toolCalls} tool calls${s.topTools.length ? ` (${s.topTools.slice(0, 5).map(([n, k]) => `${n} ${k}`).join(", ")})` : ""}, ${s.errors} errors, ${s.guard} guard, ${s.notionWrites} Notion writes`,
  ];
  if (s.transcript) out.push(c.dim(`  transcript ${s.transcript}`));
  const flagged = TURN_FLAGS.filter((f) => s.flags[f] > 0);
  out.push(`  ${flagged.length ? flagged.map((f) => `${TURN_FLAG_LABELS[f]} ${s.flags[f]}`).join(", ") : "every turn acted and answered"}`);
  // P133 (P129 section 6): the friction counters the agent layer is measured by.
  out.push(`  ${frictionLine(s.friction)}`);
  for (const turn of s.turns.filter((x) => x.flags.length)) {
    out.push(`  ${c.yellow(localStamp(turn.at).slice(11, 19))} ${turn.flags.map((f) => TURN_FLAG_LABELS[f]).join(", ")}${turn.tools.length ? c.dim(` (${turn.tools.length} tool calls)`) : ""}`);
    if (turn.prompt !== null) out.push(`    Q: ${one(turn.prompt, 220)}`);
    for (const q of turn.queued) out.push(`    Q (queued): ${one(q, 220)}`);
    if (turn.answer !== null) out.push(`    A: ${one(turn.answer, 220)}`);
    for (const x of [...turn.asked, ...turn.errors]) out.push(c.dim(`    - ${one(x, 200)}`));
  }
  return out;
}

const limitOf = (o: LogOptions, d: number): number => {
  const n = o.limit === undefined ? d : Number(o.limit);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`--limit takes a whole number, got "${o.limit}"`);
  return n;
};

/** Runs one view. `tail` resolves only when the process is stopped. */
export async function runLogCommand(view: string, o: LogOptions, out: (s: string) => void = console.log, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (!(LOG_VIEWS as readonly string[]).includes(view)) throw new UsageError(`hub log takes ${LOG_VIEWS.join(", ")}, got "${view}"`);
  const store = logStoreOf(hubPaths({ env }));
  const f = filterOf(o, env);
  const events = readEvents(store, f);
  if (view === "summary" || view === "sessions") {
    const sums = summarize(events).slice(0, limitOf(o, view === "summary" ? 10 : 50));
    if (o.json) { out(JSON.stringify(view === "summary" ? sums : sums.map(({ turns: _t, ...rest }) => rest))); return 0; }
    if (!sums.length) { out(c.dim("no sessions in the log for this filter")); return 0; }
    if (view === "sessions") for (const s of sums) out(`${s.session.slice(0, 8)}  ${s.cli.padEnd(6)} ${(s.project ?? "(unbound)").padEnd(16)} ${localStamp(s.start).slice(0, 16)}  ${s.prompts} prompts  ${s.toolCalls} tools  ${s.errors} errors  ${(Object.values(s.flags).reduce((a, b) => a + b, 0))} flagged`);
    else {
      for (const [k, s] of sums.entries()) { if (k) out(""); for (const l of summaryLines(s)) out(l); }
      out("");
      out(c.bold(`${sums.length} ${sums.length === 1 ? "session" : "sessions"}, ${frictionLine(frictionTotal(sums))}`));
    }
    return 0;
  }
  const last = events.slice(-limitOf(o, view === "tail" ? 20 : 200));
  for (const e of last) out(o.json ? JSON.stringify(e) : eventLine(e));
  if (view !== "tail") return 0;
  let seen = events.length;
  const from = f.since;
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const now = readEvents(store, { ...f, ...(from ? { since: from } : {}) });
    for (const e of now.slice(seen)) out(o.json ? JSON.stringify(e) : eventLine(e));
    seen = now.length;
  }
}

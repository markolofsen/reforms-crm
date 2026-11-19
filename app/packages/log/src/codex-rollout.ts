import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { NewLogEvent } from "./event";
import { toolInput, toolOutput } from "./privacy";
import { appendEvents, projectDir, type LogStore } from "./store";

// Codex runs hooks synchronously (0.146 skips async ones), so a hook per tool call would cost a Node start per call.
// Instead the Stop hook (once per turn) imports the turn's tool calls from Codex's own rollout (P54 section 3, point 3),
// from a byte cursor per session, so each line is imported once. Shapes read: `response_item` with payload `function_call`
// (`name`, optional `namespace`, `arguments` JSON text) or `custom_tool_call` (`name`, `input`), and their `*_output`
// (`call_id`, `output`); `turn_context` (`turn_id`). Unknown lines are skipped. Measured only on a Codex desktop rollout.

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v)) : null);
const s = (o: Obj, k: string): string | undefined => (typeof o[k] === "string" ? String(o[k]) : undefined);

const cursorFile = (store: LogStore, project: string | null, session: string): string =>
  path.join(projectDir(store, project), ".cursor", session.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120));

function readCursor(file: string): number {
  try { const n = Number(readFileSync(file, "utf8").trim()); return Number.isInteger(n) && n >= 0 ? n : 0; } catch { return 0; }
}

/** The bytes of `file` from `offset` up to the last complete line, and the new offset. */
function readFrom(file: string, offset: number): { text: string; next: number } {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const start = offset <= size ? offset : 0; // a shorter file was replaced: start over
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const end = buf.lastIndexOf(0x0a) + 1;
    return { text: buf.subarray(0, end).toString("utf8"), next: start + end };
  } finally {
    closeSync(fd);
  }
}

const toolName = (p: Obj): string => {
  const name = s(p, "name") ?? "?";
  const ns = s(p, "namespace");
  return ns ? `${ns}__${name}` : name;
};

function argsOf(p: Obj): unknown {
  const a = p.arguments ?? p.input;
  if (typeof a !== "string") return a ?? null;
  try { return JSON.parse(a); } catch { return a; }
}

/** Rollout lines into tool events. `names` maps a call id to its tool, across calls to this function's caller. */
export function rolloutEvents(text: string, base: { project: string | null; session: string; turn?: string }, names: Map<string, string> = new Map()): NewLogEvent[] {
  const out: NewLogEvent[] = [];
  let turn = base.turn;
  for (const l of text.split("\n")) {
    if (!l.trim()) continue;
    let line: Obj | null;
    try { line = obj(JSON.parse(l)); } catch { continue; }
    const p = line ? obj(line.payload) : null;
    if (!line || !p) continue;
    if (line.type === "turn_context") { turn = s(p, "turn_id") ?? turn; continue; }
    if (line.type !== "response_item") continue;
    const type = s(p, "type");
    const corr = s(p, "call_id");
    const env = { project: base.project, session: base.session, cli: "codex" as const, ...(s(line, "timestamp") ? { ts: s(line, "timestamp") } : {}), ...(turn ? { turn } : {}), ...(corr ? { corr } : {}) };
    if (type === "function_call" || type === "custom_tool_call") {
      const name = toolName(p);
      if (corr) names.set(corr, name);
      out.push({ ...env, kind: "tool_call", data: { tool: name, input: toolInput(name, argsOf(p)) } });
    } else if (type === "function_call_output" || type === "custom_tool_call_output") {
      const name = (corr && names.get(corr)) ?? "?";
      out.push({ ...env, kind: "tool_result", data: { tool: name, output: toolOutput(name, p.output) } });
    }
  }
  return out;
}

/** Imports the new part of one session's rollout. Returns the number of events written. Never throws. */
export function importRollout(store: LogStore, o: { file: string; project: string | null; session: string; turn?: string }): number {
  try {
    if (!existsSync(o.file)) return 0;
    const cur = cursorFile(store, o.project, o.session);
    const { text, next } = readFrom(o.file, readCursor(cur));
    // The tool names of calls made before the cursor (their outputs may come after it) are re-read from the whole file once.
    const names = new Map<string, string>();
    if (readCursor(cur) > 0) rolloutEvents(readFrom(o.file, 0).text, o, names);
    const events = rolloutEvents(text, o, names);
    if (events.length) appendEvents(store, events);
    mkdirSync(path.dirname(cur), { recursive: true, mode: 0o700 });
    writeFileSync(cur, String(next), { mode: 0o600 });
    return events.length;
  } catch {
    return 0;
  }
}

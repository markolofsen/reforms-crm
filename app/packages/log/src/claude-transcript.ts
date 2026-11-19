import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { cursorFile, readCursor, readFrom } from "./codex-rollout";
import type { NewLogEvent } from "./event";
import { cut, TEXT_CAP } from "./privacy";
import { appendEvents, type LogStore } from "./store";

// A message the owner typed while a Claude Code turn was running is queued and handed to the model mid-turn; no
// `UserPromptSubmit` runs for it (P57 R0, 2026-11-19: "Ну, просто напиши ..." entered at 11:30:37 and the turn acted on it,
// but the log had no prompt). Claude's transcript keeps it as an attachment `{type: "queued_command", prompt, commandMode:
// "prompt", origin: {kind: "human"}}`. The Stop hook reads the new part of the transcript from a byte cursor (the Codex
// rollout's, under its own name) and logs each one as a `prompt` of that turn with `queued: true`, at its own time.
// Measured on Claude Code 2.1.220.

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v)) : null);

/** Queued owner messages in transcript lines, as prompt events of `turn`. Lines that do not name one are not parsed. */
export function queuedPrompts(text: string, base: { project: string | null; session: string; turn?: string }): NewLogEvent[] {
  const out: NewLogEvent[] = [];
  for (const l of text.split("\n")) {
    if (!l.includes("queued_command")) continue;
    let line: Obj | null;
    try { line = obj(JSON.parse(l)); } catch { continue; }
    const a = line ? obj(line.attachment) : null;
    if (!line || !a || a.type !== "queued_command" || typeof a.prompt !== "string") continue;
    if (a.commandMode !== undefined && a.commandMode !== "prompt") continue;
    const origin = obj(a.origin);
    if (origin && origin.kind !== "human") continue;
    const ts = typeof a.timestamp === "string" ? a.timestamp : typeof line.timestamp === "string" ? line.timestamp : undefined;
    out.push({ project: base.project, session: base.session, cli: "claude", kind: "prompt", ...(ts ? { ts } : {}), ...(base.turn ? { turn: base.turn } : {}), data: { text: cut(a.prompt, TEXT_CAP), queued: true } });
  }
  return out;
}

/** Imports the queued messages in the new part of one Claude transcript. Returns how many were written. Never throws. */
export function importQueued(store: LogStore, o: { file: string; project: string | null; session: string; turn?: string }): number {
  try {
    if (!existsSync(o.file)) return 0;
    const cur = cursorFile(store, o.project, `claude-${o.session}`);
    const { text, next } = readFrom(o.file, readCursor(cur));
    const events = queuedPrompts(text, o);
    if (events.length) appendEvents(store, events);
    mkdirSync(path.dirname(cur), { recursive: true, mode: 0o700 });
    writeFileSync(cur, String(next), { mode: 0o600 });
    return events.length;
  } catch {
    return 0;
  }
}

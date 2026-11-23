import { entryFor, type LedgerEntry } from "./ledger";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathsAt } from "@hub/config/paths";

// Where the evidence ledger lives (P28 B3): state/evidence/<slug>/<session_id>.jsonl, one thin line per tool call
// (no bodies; see `./ledger.ts`; P126 P1 moved the evidence ledger from `@hub/projects` to `@hub/agent/evidence`), and state/evidence/<slug>/records.jsonl, one line per the draft record (`draft_write`)
// with the evidence block and the reply's sketch. `state/` is git-ignored. Keyed by session_id of the PARENT session;
// a subagent's calls carry `aid` (S1: hooks fire in subagents with the parent's session_id).

export const evidenceDir = (root: string, slug: string) => path.join(pathsAt(root).evidence, slug);
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "_";
export const sessionFile = (root: string, slug: string, sid: string) => path.join(evidenceDir(root, slug), `${safe(sid)}.jsonl`);
export const recordsFile = (root: string, slug: string) => path.join(evidenceDir(root, slug), "records.jsonl");

export function readLines<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const out: T[] = [];
  for (const l of readFileSync(file, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try { out.push(JSON.parse(l) as T); } catch { /* a torn line must not stop a check */ }
  }
  return out;
}

export function appendLine(file: string, line: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(line) + "\n");
}

export const readSession = (root: string, slug: string, sid: string) => readLines<LedgerEntry>(sessionFile(root, slug, sid));

/** The session file written to most recently (what the draft record (`draft_write`) cross-checks against). */
export function latestSession(root: string, slug: string): { sid: string; entries: LedgerEntry[] } | null {
  const dir = evidenceDir(root, slug);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl") && f !== "records.jsonl").map((f) => ({ f, t: statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  const top = files[0];
  return top ? { sid: top.f.replace(/\.jsonl$/, ""), entries: readLines<LedgerEntry>(path.join(dir, top.f)) } : null;
}

export interface PostPayload { session_id?: unknown; agent_id?: unknown; tool_name?: unknown; tool_input?: unknown; tool_response?: unknown }

/** PostToolUse: append the call's summary. Returns whether a line was written. Never throws. */
export function recordPost(root: string, slug: string, p: PostPayload, now = new Date()): boolean {
  try {
    const sid = typeof p.session_id === "string" ? p.session_id : "";
    if (!sid) return false;
    const aid = typeof p.agent_id === "string" && p.agent_id ? p.agent_id : undefined;
    const prior = readSession(root, slug, sid);
    const e = entryFor(prior, { name: String(p.tool_name ?? ""), input: p.tool_input, result: p.tool_response }, aid ? { aid } : {});
    if (!e) return false;
    appendLine(sessionFile(root, slug, sid), { ts: now.toISOString(), sid, ...e });
    return true;
  } catch { return false; }
}

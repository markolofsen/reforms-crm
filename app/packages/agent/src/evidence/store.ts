import { entryFor, type LedgerEntry } from "./ledger";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathsAt } from "@hub/config/paths";

// Where the session ledger lives (P28 B3, narrowed by P140 K2): state/evidence/<slug>/<session_id>.jsonl, one thin line per
// Notion or messenger-history call (no bodies; see `./ledger.ts`). `state/` is git-ignored. Keyed by session_id of the PARENT
// session; a subagent's calls carry `aid` (S1: hooks fire in subagents with the parent's session_id).

export const evidenceDir = (root: string, slug: string) => path.join(pathsAt(root).evidence, slug);
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "_";
export const sessionFile = (root: string, slug: string, sid: string) => path.join(evidenceDir(root, slug), `${safe(sid)}.jsonl`);

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

export interface PostPayload { session_id?: unknown; agent_id?: unknown; tool_name?: unknown; tool_input?: unknown; tool_response?: unknown }

/** PostToolUse: append the call's summary. Returns whether a line was written. Never throws. */
export function recordPost(root: string, slug: string, p: PostPayload, now = new Date()): boolean {
  try {
    const sid = typeof p.session_id === "string" ? p.session_id : "";
    if (!sid) return false;
    const aid = typeof p.agent_id === "string" && p.agent_id ? p.agent_id : undefined;
    const e = entryFor({ name: String(p.tool_name ?? ""), input: p.tool_input, result: p.tool_response }, aid);
    if (!e) return false;
    appendLine(sessionFile(root, slug, sid), { ts: now.toISOString(), sid, ...e });
    return true;
  } catch { return false; }
}

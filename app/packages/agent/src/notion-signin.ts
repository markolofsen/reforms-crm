import type { AgentCli } from "@hub/config/paths";

// P82 S1: whether a session of this project can use the Notion connector, from what the CLI itself knows, never from a call of
// the hub's own (the hub holds no Notion OAuth token of either CLI, so its unauthenticated `initialize` got 401 by construction).
// Claude Code: the project's own session log (a Notion tool answered, or the CLI asked for sign-in). Codex: `codex mcp list
// --json`'s `auth_status`, plus its log. Pure: the callers read the log (`@hub/log`), this package imports none.

/** How far back the session log is read for the row. */
export const NOTION_EVIDENCE_DAYS = 14;

/** A log event as far as this reader needs it (`@hub/log/event` `LogEvent`, structurally). */
export interface EvidenceEvent { ts: string; cli: string; kind: string; corr?: string | undefined; data: Record<string, unknown> }

export interface NotionEvidence {
  /** The newest Notion tool result of this CLI's sessions (ISO), or null. */
  lastWorked: string | null;
  /** The newest sign-in request of this CLI's sessions (ISO), or null. */
  needsSignIn: string | null;
  /** A session of this CLI called a Notion tool at all in the window. */
  tried: boolean;
}

export const NO_NOTION_EVIDENCE: NotionEvidence = { lastWorked: null, needsSignIn: null, tried: false };

/**
 * Markers of "needs sign-in" (P82 S0 point 4, Claude Code 2.1.220): a server that needs OAuth exposes only the pseudo-tool
 * `mcp__notion__authenticate`; `WaitForMcpServers` answers "Needs authentication (ask the user to run /mcp): notion"; weaker, a
 * Notion tool's error that says 401 or unauthorized.
 */
const AUTH_TOOL = "mcp__notion__authenticate";
const AUTH_ERROR = /\b401\b|unauthori[sz]ed|invalid_token|needs? auth/i;
const WAIT_NEEDS_AUTH = /Needs authentication[^\n]*\bnotion\b/;
const isNotionTool = (t: string): boolean => t.startsWith("mcp__notion__") && t !== AUTH_TOOL;
const text = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v ?? ""));

/** The newest evidence of each kind for one CLI, from events of any order (the caller filters project and window). */
export function notionEvidenceOf(events: readonly EvidenceEvent[], cli: AgentCli): NotionEvidence {
  let lastWorked: string | null = null;
  let needsSignIn: string | null = null;
  let tried = false;
  const later = (a: string | null, b: string): string => (a && a > b ? a : b);
  // Codex logs MCP calls as `exec` scripts (`tools.mcp__notion__…(…)`): the call names the tool, its result is paired by corr.
  const codexCalls = new Set<string>();
  for (const e of events) {
    if (e.cli !== cli) continue;
    const tool = String(e.data.tool ?? "");
    if (cli === "codex") {
      if (e.kind === "tool_call" && tool === "exec" && /\bmcp__notion__/.test(text(e.data.input))) { tried = true; if (e.corr) codexCalls.add(e.corr); }
      continue;
    }
    if (tool === AUTH_TOOL) { needsSignIn = later(needsSignIn, e.ts); tried = true; continue; }
    if (e.kind === "tool_result" && tool === "WaitForMcpServers" && WAIT_NEEDS_AUTH.test(text(e.data.output))) { needsSignIn = later(needsSignIn, e.ts); continue; }
    if (!isNotionTool(tool)) continue;
    tried = true;
    if (e.kind === "tool_result") lastWorked = later(lastWorked, e.ts);
    else if (e.kind === "tool_error" && AUTH_ERROR.test(text(e.data.error))) needsSignIn = later(needsSignIn, e.ts);
  }
  if (cli === "codex") {
    for (const e of events) {
      if (e.cli !== "codex" || !e.corr || !codexCalls.has(e.corr)) continue;
      if (e.kind === "tool_result") lastWorked = later(lastWorked, e.ts);
      else if (e.kind === "tool_error" && AUTH_ERROR.test(text(e.data.error))) needsSignIn = later(needsSignIn, e.ts);
    }
  }
  return { lastWorked, needsSignIn, tried };
}

/** `2026-11-20 03:25` (UTC, as the log stores it). */
const when = (iso: string): string => iso.slice(0, 16).replace("T", " ");

/** The Notion row's sign-in sentence, in his words: what is wrong and what to do (the fix line carries the command). */
export const notionSignIn = (detail: string, cli: AgentCli): string =>
  `Not signed in to Notion (${detail}). ${cli === "codex" ? "Run the line below once." : "Type the line below in this project's Claude Code session and sign in."}`;

/** The fix of that row: what to type in the session (Claude Code), or the one command (Codex). */
export const notionFix = (cli: AgentCli, codexHome?: string): string => (cli === "codex" ? `${codexHome ? `CODEX_HOME=${codexHome} ` : ""}codex mcp login notion` : "/mcp");

export interface NotionRow { state: "pass" | "warn" | "skip"; detail: string; fix: string | null }

/** Codex's own answer: the `notion` entry's `auth_status` of `codex mcp list --json`, or null when it could not be read. */
export function codexNotionAuth(stdout: string): string | null {
  try {
    const list: unknown = JSON.parse(stdout);
    if (!Array.isArray(list)) return null;
    const n = list.find((x): x is { name: string; auth_status?: unknown } => !!x && typeof x === "object" && (x as { name?: unknown }).name === "notion");
    return n && typeof n.auth_status === "string" ? n.auth_status : null;
  } catch { return null; }
}

/**
 * The state rule (P82 4A, "never a warning I cannot act on"): works is a pass; a sign-in request seen in this CLI's own sessions
 * after its last success is a warn with the fix; Codex not signed in is a warn only when Codex is the project's default CLI or a
 * Codex session tried Notion, else a quiet skip that names the command; never used is a quiet skip.
 */
export function notionRow(o: { cli: AgentCli; evidence: NotionEvidence; defaultCli: AgentCli; codexHome: string; codexAuth?: string | null }): NotionRow {
  const { cli, evidence: ev } = o;
  const fix = notionFix(cli, o.codexHome);
  const failedLast = !!ev.needsSignIn && (!ev.lastWorked || ev.needsSignIn > ev.lastWorked);
  if (cli === "claude") {
    if (failedLast) return { state: "warn", detail: notionSignIn(`a session of this project asked for it on ${when(ev.needsSignIn ?? "")}`, cli), fix };
    if (ev.lastWorked) return { state: "pass", detail: `works, last used ${when(ev.lastWorked)}`, fix: null };
    return { state: "skip", detail: "not used yet in this project's sessions", fix: null };
  }
  const auth = o.codexAuth ?? null;
  if (auth === null) return { state: "skip", detail: "Codex's sign-in to Notion was not read (codex mcp list)", fix: null };
  if (auth === "not_logged_in" || auth === "unsupported") {
    if (o.defaultCli === "codex" || ev.tried) return { state: "warn", detail: notionSignIn(`codex mcp list: ${auth}`, cli), fix };
    return { state: "skip", detail: `Codex is not signed in to Notion; only needed for Notion from Codex: ${fix}`, fix: null };
  }
  if (failedLast) return { state: "warn", detail: notionSignIn(`a Codex session of this project was refused on ${when(ev.needsSignIn ?? "")}`, cli), fix };
  return { state: "pass", detail: ev.lastWorked ? `signed in (${auth}), last used ${when(ev.lastWorked)}` : `signed in (${auth})`, fix: null };
}

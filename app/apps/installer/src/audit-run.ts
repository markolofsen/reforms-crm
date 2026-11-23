import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { auditToolCalls, defaultProjectsRoot, loadProject, toolCallsFromLog, type ToolCall } from "@hub/projects";
import { auditEvidence, replayCalls, type ClaimedRecord, type EvidenceRow, type LedgerEntry } from "@hub/agent/evidence/ledger";
import { hubPaths, instanceFeatures } from "@hub/config/paths";
import { auditLayout, skillScope } from "./safety";

export interface AuditResult { project: string; calls: number; violations: string[]; evidence: EvidenceRow[] }

/** A session file, or a session folder: `*.jsonl` of the main session and `subagents/*.jsonl` (each subagent keyed by its file name). */
function readLogs(target: string): Array<{ aid?: string; calls: ToolCall[] }> {
  if (!statSync(target).isDirectory()) return [{ calls: toolCallsFromLog(readFileSync(target, "utf8")) }];
  const jsonl = (d: string) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".jsonl")).sort().map((f) => path.join(d, f)) : []);
  const main = jsonl(target).map((f) => ({ calls: toolCallsFromLog(readFileSync(f, "utf8")) }));
  const subs = jsonl(path.join(target, "subagents")).map((f) => ({ aid: path.basename(f, ".jsonl"), calls: toolCallsFromLog(readFileSync(f, "utf8")) }));
  return [...main, ...subs];
}

/**
 * Audit a session log (stream-json or a Claude Code transcript; or a session folder with `subagents/`) against one
 * project's mail accounts and folder, and tabulate the evidence behind every reply (P28 B4). Read only.
 */
export function auditRun(logFile: string, slug: string, projectsRoot?: string): AuditResult {
  const p = loadProject(projectsRoot ?? defaultProjectsRoot(), slug);
  const logs = readLogs(logFile);
  const calls = logs.flatMap((l) => l.calls);
  const entries: LedgerEntry[] = [];
  const claims: Array<{ after: number; claim: ClaimedRecord }> = [];
  for (const l of logs) replayCalls(l.calls, entries, claims, l.aid);
  return {
    project: slug,
    calls: calls.length,
    violations: auditToolCalls(calls, slug, p.parsed.config.mail.accounts, skillScope(p.parsed.config.kind, hubPaths().skills), auditLayout(hubPaths()), { unattended: instanceFeatures(hubPaths()).agent.unattended }),
    evidence: auditEvidence(entries, claims),
  };
}

/** The evidence table as text (columns of research 15 section 3.2). */
export function evidenceTable(rows: readonly EvidenceRow[]): string[] {
  const head = ["#", "client", "read", "profile", "facts", "anchors", "max sim", "verdict"];
  const body = rows.map((r, i) => [String(i + 1), r.client, r.read, r.profile, String(r.facts), r.anchors, r.maxSim.toFixed(2), r.verdict.toUpperCase()]);
  const w = head.map((h, c) => Math.max(h.length, ...body.map((r) => r[c]!.length)));
  const fmt = (r: string[]) => r.map((x, c) => x.padEnd(w[c]!)).join("  ").trimEnd();
  const out = [fmt(head), ...body.map(fmt)];
  rows.forEach((r, i) => { if (r.notes.length) out.push(`  #${i + 1}: ${r.notes.join("; ")}`); });
  return out;
}

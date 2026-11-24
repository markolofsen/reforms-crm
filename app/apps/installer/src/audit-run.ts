import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { auditToolCalls, toolCallsFromLog, type ToolCall } from "@hub/projects/audit";
import { defaultProjectsRoot } from "@hub/projects/registry";
import { projectStore } from "@hub/projects/store";
import { hubPaths, instanceFeatures } from "@hub/config/paths";
import { auditLayout, skillScope } from "./safety";

export interface AuditResult { project: string; calls: number; violations: string[] }

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
 * project's mail accounts and folder. Read only. What a reply was based on is not audited (P140 K2).
 */
export function auditRun(logFile: string, slug: string, projectsRoot?: string): AuditResult {
  const p = projectStore({ projects: projectsRoot ?? defaultProjectsRoot() }).file(slug);
  const logs = readLogs(logFile);
  const calls = logs.flatMap((l) => l.calls);
  return {
    project: slug,
    calls: calls.length,
    violations: auditToolCalls(calls, slug, p.parsed.config.mail.accounts, skillScope(p.parsed.config.kind, hubPaths().skills), auditLayout(hubPaths()), { unattended: instanceFeatures(hubPaths()).agent.unattended }),
  };
}

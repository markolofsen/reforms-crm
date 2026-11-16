// Workflows: playbooks an agent follows for one kind of job ("triage an incoming email", "follow up a quiet client").
// The mechanism is core; the workflows are a project's own files: `<project>/workflows/<name>.md`, one per workflow.
//
// A file is a front matter block (name, status, run_mode, applies_to, description; source and exported are optional)
// and a body with the sections Goal, Steps and Done when (Input, Do not and Report back are optional).
//
//   status    Draft    a person is still reviewing it: an agent runs it only when the owner names it
//             Active   reviewed: an agent may pick it, as run_mode allows
//             Retired  never run, kept for the record
//   run_mode  Manual          only when the owner asks for it by name
//             Agent may pick  the agent chooses it when its description fits the job
//             Automatic       an agent may run it without being asked (it still never sends: sending has its own gate)
//
// Selection is one rule, `usage()`: the agent reads the index (name + description), not every body, then reads the one file.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const WORKFLOW_STATUSES = ["Draft", "Active", "Retired"] as const;
export const WORKFLOW_RUN_MODES = ["Manual", "Agent may pick", "Automatic"] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];
export type WorkflowRunMode = (typeof WORKFLOW_RUN_MODES)[number];
/** `agent` = the agent may pick it on its own; `request` = only when the owner names it; `never` = retired. */
export type WorkflowUsage = "agent" | "request" | "never";

export const REQUIRED_SECTIONS = ["Goal", "Steps", "Done when"] as const;
export const OPTIONAL_SECTIONS = ["Input", "Do not", "Report back"] as const;

export interface WorkflowIssue {
  severity: "error" | "warning";
  message: string;
}

export interface Workflow {
  /** File name without `.md`. */
  id: string;
  file: string;
  name: string;
  status: WorkflowStatus | null;
  runMode: WorkflowRunMode | null;
  appliesTo: string[];
  description: string;
  source: string | null;
  usage: WorkflowUsage;
  sections: string[];
  issues: WorkflowIssue[];
}

/** The one selection rule. A workflow with a broken status or run mode is never picked by an agent. */
export function usage(status: WorkflowStatus | null, runMode: WorkflowRunMode | null): WorkflowUsage {
  if (status === "Retired") return "never";
  if (status === "Active" && (runMode === "Agent may pick" || runMode === "Automatic")) return "agent";
  return "request";
}

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try {
      return JSON.parse(t) as string;
    } catch {
      return t.slice(1, -1);
    }
  }
  return t;
}

/** `key: value` lines between the two `---` fences. Returns null when there is no front matter. */
function frontMatter(text: string): { fields: Map<string, string>; body: string } | null {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return null;
  const fields = new Map<string, string>();
  for (const l of lines.slice(1, end)) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(l);
    if (m) fields.set(m[1]!, m[2]!);
  }
  return { fields, body: lines.slice(end + 1).join("\n") };
}

function listOf(raw: string | undefined): string[] | null {
  if (raw === undefined) return [];
  const t = raw.trim();
  if (t === "") return [];
  try {
    const v: unknown = JSON.parse(t);
    return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
  } catch {
    return null;
  }
}

/** Headings of level 2 or 3 outside code fences, e.g. `### Steps`. */
function sectionsOf(body: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const l of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
    if (fenced) continue;
    const m = /^#{2,3}\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) out.push(m[1]!);
  }
  return out;
}

export function parseWorkflow(text: string, file: string): Workflow {
  const id = file.replace(/^.*[\\/]/, "").replace(/\.md$/i, "");
  const issues: WorkflowIssue[] = [];
  const err = (message: string) => issues.push({ severity: "error", message });
  const warn = (message: string) => issues.push({ severity: "warning", message });

  const fm = frontMatter(text);
  if (!fm) {
    err("no front matter (a block between two `---` lines at the top)");
    return { id, file, name: id, status: null, runMode: null, appliesTo: [], description: "", source: null, usage: "request", sections: [], issues };
  }
  const f = fm.fields;
  const name = unquote(f.get("name") ?? "");
  if (!name) err("front matter has no `name`");

  const statusRaw = unquote(f.get("status") ?? "");
  const status = (WORKFLOW_STATUSES as readonly string[]).includes(statusRaw) ? (statusRaw as WorkflowStatus) : null;
  if (!status) err(`status "${statusRaw}" is not one of ${WORKFLOW_STATUSES.join(", ")}`);

  const modeRaw = unquote(f.get("run_mode") ?? "");
  const runMode = (WORKFLOW_RUN_MODES as readonly string[]).includes(modeRaw) ? (modeRaw as WorkflowRunMode) : null;
  if (!runMode) err(`run_mode "${modeRaw}" is not one of ${WORKFLOW_RUN_MODES.join(", ")}`);

  const appliesTo = listOf(f.get("applies_to"));
  if (appliesTo === null) err('applies_to must be a JSON list of strings, e.g. ["Lead", "Client"]');

  const description = unquote(f.get("description") ?? "");
  if (!description) err("front matter has no `description` (the agent chooses a workflow by it)");
  else if (!/^use when\b/i.test(description)) warn('description should start with "Use when ..." so the agent can match it to a job');

  const sections = sectionsOf(fm.body);
  const has = (s: string) => sections.some((x) => x.toLowerCase() === s.toLowerCase());
  for (const s of REQUIRED_SECTIONS) if (!has(s)) err(`missing section "${s}"`);
  if (status === "Active" && !has("Do not")) warn('an Active workflow should say what it must not do (section "Do not")');

  return {
    id,
    file,
    name: name || id,
    status,
    runMode,
    appliesTo: appliesTo ?? [],
    description,
    source: unquote(f.get("source") ?? "") || null,
    usage: usage(status, runMode),
    sections,
    issues,
  };
}

/** `<project folder>/workflows/*.md` except README.md, sorted by file name. A missing folder is an empty list. */
export function loadWorkflows(projectFolder: string): Workflow[] {
  const dir = join(projectFolder, "workflows");
  if (!existsSync(dir)) return [];
  const out: Workflow[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.toLowerCase().endsWith(".md") || name.toLowerCase() === "readme.md") continue;
    out.push(parseWorkflow(readFileSync(join(dir, name), "utf8"), name));
  }
  const seen = new Map<string, string>();
  for (const w of out) {
    const key = w.name.trim().toLowerCase();
    const prev = seen.get(key);
    if (prev) w.issues.push({ severity: "error", message: `name "${w.name}" is also used by ${prev}` });
    else seen.set(key, w.file);
  }
  return out;
}

export const workflowErrors = (w: Workflow[]): number => w.reduce((n, x) => n + x.issues.filter((i) => i.severity === "error").length, 0);

/** What an agent reads first: the workflows it may pick on its own, as `name — description`. Bodies are not included. */
export function agentIndex(all: Workflow[]): Array<{ file: string; name: string; description: string; appliesTo: string[]; runMode: WorkflowRunMode | null }> {
  return all
    .filter((w) => w.usage === "agent" && !w.issues.some((i) => i.severity === "error"))
    .map((w) => ({ file: `workflows/${w.file}`, name: w.name, description: w.description, appliesTo: w.appliesTo, runMode: w.runMode }));
}

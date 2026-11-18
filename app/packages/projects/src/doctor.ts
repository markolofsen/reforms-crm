// `doctor --project <slug>`: the checks of K5 that need no installer code. Everything that touches the outside world
// (Mail.app, Notion, the MCP config, the knowledge index) is injected, so the installer wires the real thing and tests
// pass fakes.
import { formatIssue, hasErrors } from "./parse";
import { kindOf } from "./kinds";
import type { ProjectConfig } from "./schema";
import { loadWorkflows, workflowErrors } from "./workflows";
import { isUsable, loadSequences, sequenceErrors } from "@hub/sequences";
import { duplicateClaims, type LoadedProject } from "./registry";

export type CheckOutcome = "pass" | "fail" | "skipped";
export interface Check {
  name: string;
  outcome: CheckOutcome;
  detail: string;
}

export interface DoctorInput {
  project: LoadedProject;
  /** Every project, to find an address claimed twice. */
  all: LoadedProject[];
  /** Account names Mail.app returns from `list_accounts`; undefined when Mail was not asked. */
  mailAccounts?: string[];
  /** Reads every listed database with the project's token (`notion-dump check`); undefined when Notion was not asked. */
  notionCheck?: () => Promise<{ ok: boolean; detail: string; skipped?: boolean }>;
  /** Entry files under knowledge/ and rows in `knowledge_docs` for the project. */
  knowledgeFiles?: number;
  knowledgeDocs?: number;
  /** Accounts the per-run mail MCP allow-list admits for this project. */
  mcpMailAccounts?: string[];
}

const skip = (name: string, why: string): Check => ({ name, outcome: "skipped", detail: why });

export async function doctorProject(input: DoctorInput): Promise<Check[]> {
  const { project, all } = input;
  const p = project.parsed;
  const c = p.config;
  const checks: Check[] = [];

  const kind = kindOf(c.kind);
  const has = (m: (typeof c.modules)[number]) => c.modules.includes(m);
  const off = (name: string): Check => skip(name, `module not used by kind ${c.kind}`);

  const errors = p.issues.filter((i) => i.severity === "error");
  checks.push({
    name: "project.md parses",
    outcome: hasErrors(p.issues) ? "fail" : "pass",
    detail: errors.length ? errors.map(formatIssue).join("; ") : "schema 1",
  });

  checks.push(
    kind
      ? { name: "kind is known", outcome: "pass", detail: `${kind.id}: ${c.modules.join(", ")}` }
      : { name: "kind is known", outcome: "fail", detail: `unknown kind "${c.kind}"` },
  );

  if (!has("mail")) {
    for (const n of ["mail accounts exist", "sender is one of the addresses"]) checks.push(off(n));
  } else {
    checks.push(
      c.mail.accounts.length === 0
        ? { name: "mail accounts exist", outcome: "fail", detail: "mail.accounts is empty" }
        : input.mailAccounts === undefined
          ? skip("mail accounts exist", "Mail accounts were not read here")
          : (() => {
              const have = new Set(input.mailAccounts.map((a) => a.trim().toLowerCase()));
              const missing = c.mail.accounts.filter((a) => !have.has(a.trim().toLowerCase()));
              return missing.length
                ? { name: "mail accounts exist", outcome: "fail" as const, detail: `not in Mail: ${missing.join(", ")}; Mail has: ${input.mailAccounts.join(", ") || "nothing (is Mail.app open and mail-mcp running? see step mail.daemon)"}` }
                : { name: "mail accounts exist", outcome: "pass" as const, detail: c.mail.accounts.join(", ") };
            })(),
    );

    checks.push(
      !c.mail.sender
        ? { name: "sender is one of the addresses", outcome: "fail", detail: "no mail.sender and no mail.addresses" }
        : c.mail.addresses.includes(c.mail.sender)
          ? { name: "sender is one of the addresses", outcome: "pass", detail: c.mail.sender }
          : { name: "sender is one of the addresses", outcome: "fail", detail: `${c.mail.sender} is not in mail.addresses (${c.mail.addresses.join(", ") || "empty"})` },
    );

  }

  const claims = duplicateClaims(all).filter((d) => d.projects.includes(p.slug));
  checks.push(
    claims.length
      ? { name: "no address claimed twice", outcome: "fail", detail: claims.map((d) => `${d.address} also claimed by ${d.projects.filter((s) => s !== p.slug).join(", ")}`).join("; ") }
      : { name: "no address claimed twice", outcome: "pass", detail: `${c.mail.addresses.length} address(es)` },
  );

  if (c.status === "active") {
    checks.push(
      c.mail.addresses.length + c.mail.accounts.length === 0
        ? { name: "active project has an address", outcome: "fail", detail: "status is active but nothing routes to it" }
        : { name: "active project has an address", outcome: "pass", detail: "routable" },
    );
  }

  checks.push(sendCheck(c, has("mail")));

  if (!has("notion")) checks.push(off("notion databases readable"));
  else if (input.notionCheck === undefined) checks.push(skip("notion databases readable", "Notion was not asked"));
  else if (c.notion.databases.length === 0) checks.push({ name: "notion databases readable", outcome: "fail", detail: "no ## Notion databases" });
  else {
    const r = await input.notionCheck().catch((e: unknown) => ({ ok: false, skipped: false, detail: e instanceof Error ? e.message : String(e) }));
    checks.push({ name: "notion databases readable", outcome: r.skipped ? "skipped" : r.ok ? "pass" : "fail", detail: r.detail });
  }

  checks.push(
    !has("knowledge")
      ? off("knowledge index not empty")
      : input.knowledgeDocs === undefined || input.knowledgeFiles === undefined
      ? skip("knowledge index not empty", "knowledge folder and index were not read here")
      : input.knowledgeFiles === 0
        ? skip("knowledge index not empty", "knowledge/ is empty, nothing to index")
        : input.knowledgeDocs > 0
          ? { name: "knowledge index not empty", outcome: "pass", detail: `${input.knowledgeDocs} indexed of ${input.knowledgeFiles} files` }
          : { name: "knowledge index not empty", outcome: "fail", detail: `${input.knowledgeFiles} files but nothing is indexed (run knowledge index ${p.slug})` },
  );

  const wf = loadWorkflows(project.folder);
  checks.push(
    wf.length === 0
      ? skip("workflows parse", "no workflows/ folder or no files in it")
      : workflowErrors(wf) > 0
        ? { name: "workflows parse", outcome: "fail", detail: `${workflowErrors(wf)} error(s) in ${wf.length} workflow(s); run \`hub workflows check ${p.slug}\`` }
        : { name: "workflows parse", outcome: "pass", detail: `${wf.length} workflow(s), ${wf.filter((w) => w.usage === "agent").length} the agent may pick` },
  );

  // P47: the follow-up sequence files of the project (the engine is core, the files are the project's own).
  const seqs = has("sequences") ? loadSequences(project.folder) : [];
  checks.push(
    !has("sequences")
      ? off("sequences parse")
      : seqs.length === 0
        ? skip("sequences parse", "no sequences/ folder or no files in it")
        : sequenceErrors(seqs) > 0
          ? { name: "sequences parse", outcome: "fail", detail: `${sequenceErrors(seqs)} error(s) in ${seqs.length} sequence(s); run \`hub sequences check ${p.slug}\`` }
          : { name: "sequences parse", outcome: "pass", detail: `${seqs.length} sequence(s), ${seqs.filter((x) => isUsable(x) && x.status === "Active").length} active` },
  );

  if (input.mcpMailAccounts === undefined) checks.push(skip("mail MCP limited to the project's accounts", "per-run MCP config was not read"));
  else {
    const mine = new Set(c.mail.accounts.map((a) => a.trim().toLowerCase()));
    const extra = input.mcpMailAccounts.filter((a) => !mine.has(a.trim().toLowerCase()));
    checks.push(
      extra.length
        ? { name: "mail MCP limited to the project's accounts", outcome: "fail", detail: `allow-list also admits: ${extra.join(", ")}` }
        : { name: "mail MCP limited to the project's accounts", outcome: "pass", detail: "allow-list matches mail.accounts" },
    );
  }
  return checks;
}

/** Decision 0011: `draft` always passes; `auto` needs classes of the kind, an active project, a sender and a mail module. */
function sendCheck(c: ProjectConfig, mail: boolean): Check {
  const name = "send settings";
  const s = c.send;
  const kind = kindOf(c.kind);
  if (s.mode === "draft") return { name, outcome: "pass", detail: "send.mode draft: a person sends with `hub send`" };
  const problems: string[] = [];
  if (!mail) problems.push(`kind ${c.kind} has no mail module`);
  if (s.classes.length === 0) problems.push("send.classes is empty");
  const unknown = s.classes.filter((cl) => !kind?.send.classes.includes(cl));
  if (unknown.length) problems.push(`not autosendable in kind ${c.kind}: ${unknown.join(", ")}`);
  if (c.status !== "active") problems.push(`status is ${c.status}, not active`);
  if (!c.mail.sender) problems.push("no mail.sender");
  return problems.length
    ? { name, outcome: "fail", detail: `send.mode auto: ${problems.join("; ")}` }
    : { name, outcome: "pass", detail: `send.mode auto: ${s.classes.join(", ")}; at most ${s.dailyCap} per 24 h; ${s.delayMinutes} min to cancel; to ${c.draft.recipients === "any" ? "anyone" : c.draft.recipients === "test" ? "the test allow-list" : "the listed addresses"}` };
}

export const doctorFailed = (checks: Check[]): boolean => checks.some((c) => c.outcome === "fail");

export function formatChecks(checks: Check[]): string {
  const width = Math.max(...checks.map((c) => c.name.length));
  return checks.map((c) => `${c.outcome.toUpperCase().padEnd(7)} ${c.name.padEnd(width)}  ${c.detail}`).join("\n");
}

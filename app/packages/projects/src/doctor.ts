// `doctor --project <slug>`: the checks of K5 that need no installer code. Everything that touches the outside world
// (Mail.app, Notion, the MCP config, the knowledge index) is injected, so the installer wires the real thing and tests
// pass fakes.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { entryBrandProblem, frontMatterBrands } from "./brands";
import { formatIssue, hasErrors } from "./md/issues";
import { kindOf } from "./kinds";
import type { ProjectConfig } from "./schema";
import { loadWorkflows, workflowErrors } from "./workflows";
import { isUsable, sequenceErrors } from "@hub/sequences/definition";
import { loadSequences } from "@hub/sequences/load";
import { duplicateClaims, duplicateDomains } from "./registry";
import type { LoadedProject } from "./store";
import { policyProblems } from "./send-policy";

/** `warn`: a gap that a `draft` project may still have (it becomes `fail` once the project is `active`). */
export type CheckOutcome = "pass" | "warn" | "fail" | "skipped";
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
  /**
   * P97 S4: the newest note the Hub recorded when Notion refused a lead write at a send (a lead's Status, its Client link, a new
   * Clients card), or null when none is recorded; undefined when the Hub's database was not asked. Notion's API does not report an
   * integration's capabilities, so a missing Insert content is known only from the first refused create.
   */
  leadWrites?: { note: string; at: string } | null;
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

  const domainClaims = duplicateDomains(all).filter((d) => d.projects.includes(p.slug));
  checks.push(
    domainClaims.length
      ? { name: "no domain claimed twice", outcome: "fail", detail: domainClaims.map((d) => `${d.address} also listed by ${d.projects.filter((s) => s !== p.slug).join(", ")}`).join("; ") }
      : { name: "no domain claimed twice", outcome: "pass", detail: `${c.mail.domains.length} domain(s)` },
  );
  checks.push(...brandChecks(project), ...knowledgeBrandChecks(project));

  if (c.status === "active") {
    checks.push(
      c.mail.addresses.length + c.mail.accounts.length === 0
        ? { name: "active project has an address", outcome: "fail", detail: "status is active but nothing routes to it" }
        : { name: "active project has an address", outcome: "pass", detail: "routable" },
    );
  }

  checks.push(policyCheck(project), sendCheck(c, has("mail")));

  if (!has("notion")) checks.push(off("notion databases readable"));
  else if (input.notionCheck === undefined) checks.push(skip("notion databases readable", "Notion was not asked"));
  else if (c.notion.databases.length === 0) checks.push({ name: "notion databases readable", outcome: "fail", detail: "no ## Notion databases" });
  else {
    const r = await input.notionCheck().catch((e: unknown) => ({ ok: false, skipped: false, detail: e instanceof Error ? e.message : String(e) }));
    checks.push({ name: "notion databases readable", outcome: r.skipped ? "skipped" : r.ok ? "pass" : "fail", detail: r.detail });
  }

  // P97 S4: the lead writes at the first send (decision 0044 point 4), judged by what Notion last refused, never by a test write.
  if (has("notion") && c.notion.databases.some((d) => d.slug === "leads") && input.leadWrites !== undefined) {
    const w = input.leadWrites;
    checks.push(
      c.notion.convertLeads === "off"
        ? { name: "notion lead writes", outcome: "skipped", detail: "notion.convert_leads is off: the Hub writes nothing on leads at a send" }
        : w
          ? { name: "notion lead writes", outcome: "warn", detail: `the last lead write at a send (${w.at.slice(0, 10)}) left a note: ${w.note}` }
          : { name: "notion lead writes", outcome: "pass", detail: "no refusal recorded (Notion reports no capabilities: a missing Insert content shows at the first Clients card the Hub creates)" },
    );
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

/**
 * P60: the `## Brands` table. A gap the owner has not answered yet (a domain in no row, a brand without a signature)
 * warns while the project is a `draft` and fails once it is `active`; a table that does not parse always fails.
 */
export function brandChecks(project: LoadedProject): Check[] {
  const p = project.parsed;
  const c = p.config;
  const gap: CheckOutcome = c.status === "draft" ? "warn" : "fail";
  const errors = p.issues.filter((i) => i.field === "brands" && i.severity === "error");
  if (errors.length) return [{ name: "brands table parses", outcome: "fail", detail: errors.map(formatIssue).join("; ") }];
  if (c.brands.length === 0) {
    const why = "no ## Brands table: one brand, drafts end with signoff alone";
    return [skip("brands table parses", why), skip("every project domain has a brand", why), skip("every brand has a signature", why)];
  }
  const listed = new Set(c.brands.flatMap((b) => b.receivesAt));
  const brandless = c.mail.domains.filter((d) => !listed.has(d));
  const unsigned = c.brands.filter((b) => b.signature.length === 0).map((b) => b.name);
  return [
    { name: "brands table parses", outcome: "pass", detail: `${c.brands.length} brand(s): ${c.brands.map((b) => b.name).join(", ")}` },
    brandless.length
      ? { name: "every project domain has a brand", outcome: gap, detail: `in no ## Brands row: ${brandless.join(", ")}` }
      : { name: "every project domain has a brand", outcome: "pass", detail: c.mail.domains.length ? `${c.mail.domains.length} domain(s), each in a row` : "no mail.domains" },
    unsigned.length
      ? { name: "every brand has a signature", outcome: gap, detail: `no Signature yet: ${unsigned.join(", ")} (their drafts carry [Owner: signature for ...], which hub send refuses)` }
      : { name: "every brand has a signature", outcome: "pass", detail: c.brands.map((b) => `${b.name}: ${b.signature.join(" / ")}`).join("; ") },
  ];
}

/** Every entry file under `<folder>/knowledge` but the taxonomy, as paths relative to the folder (the indexer's walk). */
function entryFiles(folder: string, dir = join(folder, "knowledge"), rel = "knowledge"): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...entryFiles(folder, p, `${rel}/${name}`));
    else if (name.endsWith(".md") && `${rel}/${name}` !== "knowledge/taxonomy.md") out.push(`${rel}/${name}`);
  }
  return out;
}

/** P60 B3: `knowledge.scope by-brand` needs two or more brands, and every entry must name known brands or `ANY` (`entryBrandProblem`, the indexer's own rule). */
export function knowledgeBrandChecks(project: LoadedProject): Check[] {
  const c = project.parsed.config;
  if (c.knowledge.scope !== "by-brand") return [skip("knowledge scope fits brands", "knowledge.scope shared: one knowledge base for every brand")];
  const fits: Check = c.brands.length >= 2
    ? { name: "knowledge scope fits brands", outcome: "pass", detail: `by-brand over ${c.brands.length} brands` }
    : { name: "knowledge scope fits brands", outcome: "fail", detail: `knowledge.scope by-brand needs two or more ## Brands rows (has ${c.brands.length})` };
  const files = entryFiles(project.folder);
  const bad = files.flatMap((f) => {
    const why = entryBrandProblem(frontMatterBrands(readFileSync(join(project.folder, f), "utf8")), c);
    return why ? [`${f}: ${why}`] : [];
  });
  return [
    fits,
    files.length === 0
      ? skip("knowledge entries name known brands", "knowledge/ has no entries")
      : bad.length
        ? { name: "knowledge entries name known brands", outcome: "fail", detail: `${bad.length} of ${files.length} not indexed: ${bad.slice(0, 3).join("; ")}${bad.length > 3 ? "; ..." : ""}` }
        : { name: "knowledge entries name known brands", outcome: "pass", detail: `${files.length} entries, each with known brands` },
  ];
}

/** P49 S11: the send policy is a server-owned file; a row of it left in project.md is ignored and fails here until migrated. */
function policyCheck(project: LoadedProject): Check {
  const name = "send policy";
  const rows = Object.keys(project.parsed.policyRows);
  const fix = `a person runs \`hub send policy migrate ${project.slug}\``;
  if (rows.length) return { name, outcome: "fail", detail: `${rows.join(", ")} still in project.md (ignored): ${fix}` };
  const st = project.policy;
  if (!st) return skip(name, "the policy folder was not given");
  if (st.error) return { name, outcome: "fail", detail: `${st.error}; drafts only and the test list apply until it is fixed (${fix})` };
  if (st.source === "default") return { name, outcome: "pass", detail: "no send-policy.json: drafts only, to the test list (`hub send policy set` changes it)" };
  const problems = policyProblems(st.policy, project.parsed.config.kind);
  return problems.length ? { name, outcome: "fail", detail: problems.join("; ") } : { name, outcome: "pass", detail: `send-policy.json, set by ${st.policy.by} at ${st.policy.updatedAt.slice(0, 10)}` };
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

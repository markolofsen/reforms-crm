// `hub mail-filters <slug> propose|check|export-xml|export-api`. Registered by the installer's hub CLI.
// Files only: this code never talks to Gmail or Mail.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultProjectsRoot, kindOf, projectStore } from "@hub/projects";
import type { Command } from "commander";
import { colorTable } from "./colors";
import { propose, type SenderSample } from "./analyze";
import { exportApi, exportXml, UnsafeRulesError } from "./export";
import { buildFilters } from "./filters";
import { classesOf, DEFAULT_CLASSES, emptyRulesFile, formatIssue, hasErrors, matchText, type Issue, type RulesFile } from "./model";
import { normalizeRules, parseRulesFile, writeRulesFile } from "./rules-file";
import { checkRules } from "./safety";

export interface MailFiltersOptions {
  projectsRoot?: string;
  out?: (line: string) => void;
  /** ISO date-time stamp for exports and rule dates; injected by tests. */
  now?: () => string;
}

export const RULES_FILE = "mail-filters.md";
/** Generated files live in `<project>/.generated/` (one git-ignore rule); `mail-filters.md` stays hand-written next to project.md. */
export const GENERATED_DIR = ".generated";
export const XML_FILE = "mail-filters.xml";
export const API_FILE = "mail-filters.api.json";

interface Loaded {
  folder: string;
  slug: string;
  ownAddresses: string[];
  file: RulesFile;
  issues: Issue[];
  exists: boolean;
}

function load(slug: string, o: MailFiltersOptions): Loaded {
  const project = projectStore({ projects: o.projectsRoot ?? defaultProjectsRoot() }).file(slug);
  const path = join(project.folder, RULES_FILE);
  const exists = existsSync(path);
  // the classes come from the project's kind (an unknown kind is reported by project doctor; here the generic set applies)
  const classes = kindOf(project.parsed.config.kind)?.mailClasses ?? DEFAULT_CLASSES;
  const parsed = exists ? parseRulesFile(readFileSync(path, "utf8"), classes) : { file: emptyRulesFile(classes), issues: [] };
  const own = project.parsed.config.mail;
  return { folder: project.folder, slug, ownAddresses: [...own.addresses, ...own.accounts.filter((a) => a.includes("@"))], file: parsed.file, issues: parsed.issues, exists };
}

export function runCheck(slug: string, o: MailFiltersOptions = {}): number {
  const out = o.out ?? console.log;
  const l = load(slug, o);
  if (!l.exists) {
    out(`no ${RULES_FILE} for ${slug}: nothing to check`);
    return 1;
  }
  const issues = [...l.issues, ...checkRules(l.file)];
  for (const i of issues) out(formatIssue(i));
  out(`${l.file.rules.length} rule(s), ${l.file.whitelist.length} whitelist entr${l.file.whitelist.length === 1 ? "y" : "ies"}, ${buildFilters(l.file).length} Gmail filter(s)`);
  out(hasErrors(issues) ? "check failed" : "check passed");
  return hasErrors(issues) ? 1 : 0;
}

function exportGuard(l: Loaded, out: (s: string) => void): boolean {
  const issues = [...l.issues, ...checkRules(l.file)].filter((i) => i.severity === "error");
  for (const i of issues) out(formatIssue(i));
  return issues.length === 0 && l.exists;
}

export function runExportXml(slug: string, o: MailFiltersOptions & { to?: string } = {}): number {
  const out = o.out ?? console.log;
  const l = load(slug, o);
  if (!exportGuard(l, out)) {
    out("export refused");
    return 1;
  }
  const target = o.to ?? join(l.folder, GENERATED_DIR, XML_FILE);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, exportXml(l.file, { slug, now: (o.now ?? (() => new Date().toISOString()))() }));
  out(`wrote ${target}: ${buildFilters(l.file).length} filter(s)`);
  return 0;
}

export function runExportApi(slug: string, o: MailFiltersOptions & { to?: string } = {}): number {
  const out = o.out ?? console.log;
  const l = load(slug, o);
  if (!exportGuard(l, out)) {
    out("export refused");
    return 1;
  }
  const target = o.to ?? join(l.folder, GENERATED_DIR, API_FILE);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(exportApi(l.file, { slug }), null, 2)}\n`);
  out(`wrote ${target} (request list only, nothing was sent)`);
  return 0;
}

/** `colors`: prints "label -> color" for this project (universal palette plus its overrides) and the apply checklist. Files only. */
export function runColors(slug: string, o: MailFiltersOptions = {}): number {
  const out = o.out ?? console.log;
  const l = load(slug, o);
  const bad = l.issues.filter((i) => i.code === "bad_color" || i.code === "bad_color_class");
  for (const i of bad) out(formatIssue(i));
  out("| label | class | color | background | text | source |");
  out("|---|---|---|---|---|---|");
  for (const r of colorTable(l.file)) out(`| ${r.label} | ${r.category ?? "-"} | ${r.color.name} | ${r.color.bg} | ${r.color.text} | ${r.source} |`);
  out("");
  out("Apply checklist (Gmail UI, each account of the project; Gmail filters and XML cannot set a label color):");
  out("1. Gmail > hover the label in the left list > three dots > Label color > pick the swatch (or Custom color with the hex pair).");
  out("2. Only hub/* labels. Leave the parent `hub` and every label that is not hub/* alone (Superhuman/AI, Marketing, Pitch and so on).");
  out("3. Nested hub/<class>/<sub> takes its class color. Confirm each swatch hex in the picker, then screenshot the label list.");
  out("4. A label not yet in Gmail (never matched) is skipped; do not create it just to color it.");
  return bad.length ? 1 : 0;
}

export interface ProposeArgs extends MailFiltersOptions {
  sample: string;
  /** Write the confident proposals (and the accepted uncertain ones) into the rules file. */
  apply?: boolean;
  /** Groups (domain or address) of uncertain proposals the owner confirmed. */
  accept?: string[];
}

export function runPropose(slug: string, a: ProposeArgs): number {
  const out = a.out ?? console.log;
  const l = load(slug, a);
  const samples = JSON.parse(readFileSync(a.sample, "utf8")) as SenderSample[];
  if (!Array.isArray(samples)) throw new Error(`${a.sample} must hold a JSON array of {from, subject, listId, hasUnsubscribe, bulk}`);
  const today = (a.now ?? (() => new Date().toISOString()))().slice(0, 10);
  const r = propose(samples, { classes: classesOf(l.file), whitelist: l.file.whitelist, existing: l.file, ownAddresses: l.ownAddresses, today });
  out("| match | category | action | confidence | messages | confirm | why |");
  out("|---|---|---|---|---|---|---|");
  for (const p of r.proposals) out(`| ${matchText(p.rule.match)} | ${p.rule.category} | ${p.rule.action} | ${p.confidence} | ${p.count} | ${p.needsConfirmation ? "ask" : "no"} | ${p.rule.why} |`);
  for (const u of r.unclassified) out(`unclassified ${u.group} (${u.count}): ${u.reason}; senders: ${u.senders.join(", ")}`);
  out(`protected (client whitelist): ${r.protectedSenders.reduce((n, p) => n + p.count, 0)} message(s); already covered: ${r.covered}; ignored: ${r.ignored}`);
  if (a.apply) {
    const accepted = new Set((a.accept ?? []).map((s) => s.toLowerCase()));
    const take = r.proposals.filter((p) => !p.needsConfirmation || accepted.has(p.rule.match.value));
    const merged = normalizeRules({ ...l.file, rules: [...l.file.rules, ...take.map((p) => p.rule)] });
    const problems = checkRules(merged).filter((i) => i.severity === "error");
    if (problems.length) {
      for (const i of problems) out(formatIssue(i));
      out("not written: the merged rules fail the safety check");
      return 1;
    }
    writeFileSync(join(l.folder, RULES_FILE), writeRulesFile(merged, slug));
    out(`wrote ${take.length} rule(s) to ${join(l.folder, RULES_FILE)}; ${r.proposals.length - take.length} left for the owner`);
  }
  return 0;
}

export function registerMailFiltersCommands(program: Command, o: MailFiltersOptions = {}): Command {
  return program
    .command("mail-filters")
    .description("Gmail filters for one project's mail: propose rules from a sender sample, check the rules file, export mailFilters.xml or an API request list. Files only.")
    .argument("<slug>", "project")
    .argument("<action>", "propose | check | colors | export-xml | export-api")
    .option("--sample <file>", "propose: JSON array of {from, subject, listId, hasUnsubscribe, bulk}")
    .option("--apply", "propose: write the confident proposals into mail-filters.md")
    .option("--accept <groups...>", "propose --apply: uncertain groups (domain or address) the owner confirmed")
    .option("--out <file>", "export: target file (default: next to project.md)")
    .action((slug: string, action: string, opt: { sample?: string; apply?: boolean; accept?: string[]; out?: string }) => {
      try {
        if (action === "colors") process.exitCode = runColors(slug, o);
        else if (action === "check") process.exitCode = runCheck(slug, o);
        else if (action === "export-xml") process.exitCode = runExportXml(slug, { ...o, ...(opt.out ? { to: opt.out } : {}) });
        else if (action === "export-api") process.exitCode = runExportApi(slug, { ...o, ...(opt.out ? { to: opt.out } : {}) });
        else if (action === "propose") {
          if (!opt.sample) throw new Error("propose needs --sample <file>");
          process.exitCode = runPropose(slug, { ...o, sample: opt.sample, ...(opt.apply ? { apply: true } : {}), ...(opt.accept ? { accept: opt.accept } : {}) });
        } else throw new Error(`unknown action "${action}" (propose, check, colors, export-xml, export-api)`);
      } catch (e) {
        (o.out ?? console.error)(`${e instanceof UnsafeRulesError ? "refused" : "error"}: ${(e as Error).message}`);
        process.exitCode = 1;
      }
    });
}

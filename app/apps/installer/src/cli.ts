#!/usr/bin/env tsx
import * as p from "@clack/prompts";
import { registerMailFiltersCommands } from "@hub/mail-filters/hub-commands";
import { registerProjectCommands, runProjectDoctor, runSync } from "@hub/projects/hub-commands";
import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { CORE_ROOT, HubHomeMissingError } from "@hub/config/paths";
import { makeCtx, readJson, type Ctx } from "./context.ts";
import { auditRun, evidenceTable } from "./audit-run.ts";
import { batchCheck, batchLines } from "./batch-check.ts";
import { listProjects, runAgent } from "./agent.ts";
import { installLink, pathHint, planLink, removeLink } from "./link.ts";
import { coreUpdate } from "./core-update.ts";
import { initInstance, InitError } from "./init.ts";
import { findInstances, instanceStatus, statusTable } from "./status.ts";
import { execa } from "execa";
import { runMenu } from "./menu.ts";
import { runTests, runUp } from "./serve.ts";
import { projectRows, projectTable } from "./project-table.ts";
import { recordClient } from "./record-client.ts";
import { recordDraft } from "./record-draft.ts";
import { runSendCommand } from "./send/command.ts";
import { runGuard, runGuardPost } from "./safety.ts";
import { c, UsageError } from "./term.ts";
import { mcpCall } from "./mcp-probe.ts";
import { notionCheck } from "./notion-check.ts";
import { renderClientSetup } from "./docs.ts";
import { doctor, exitCode, guideText, install, printGuides, summary, table } from "./runner.ts";
import { redact, storeSecret, type SecretName } from "./secrets.ts";
import { makeValidators } from "./setup/clients.ts";
import { runSetup } from "./setup/wizard.ts";
import { clackUi, quietUi } from "./setup/ui.ts";
import { selectSteps, STEPS } from "./steps/index.ts";
import type { Step } from "./types.ts";
import { uninstall } from "./uninstall.ts";

const SHOWN = new Set(["agent", "up", "doctor", "setup"]);

const program = new Command("hub")
  .description("Hub Workflow: Claude Code sessions per project, a local admin to review drafts, checks and setup. `hub` with no arguments opens the menu.")
  .configureHelp({
    styleTitle: (s) => c.bold(s),
    styleCommandText: (s) => c.cyan(s),
    styleSubcommandText: (s) => c.cyan(s),
    styleOptionText: (s) => c.green(s),
    styleArgumentText: (s) => c.yellow(s),
    // Minimal command set (P16): only these are listed; every other command still parses and has its own --help.
    visibleCommands: (cmd) => (cmd.parent ? [...cmd.commands] : cmd.commands.filter((x) => SHOWN.has(x.name()))),
  })
  .showHelpAfterError(c.dim("(run with --help for usage)"))
  .addHelpText("after", `
${c.bold("Examples")}
  hub                         menu
  hub agent <project>         fresh Claude Code session bound to one project
  hub agent                   continue the last session here
  hub up                      the admin: review the drafts the agent made, opens the browser (hub up --demo: invented data)
  hub doctor [project]        read-only health check (of one project when given)
  hub setup                   idempotent, tokenless install of tools, folders, skills

Other commands are hidden to keep this list short: projects, filters, link, install, guide, docs, test, token,
audit-run, batch-check, send, uninstall. Each has its own \`hub <name> --help\`.`);
// Every command that needs an instance builds its context here: without HUB_HOME that is a HubHomeMissingError (exit 2, one line).
// Commands that need none (`--help`, `docs`, `test`, `link`, `guide`) never call it.
const ctxOf = (extra: Partial<Ctx> = {}): Ctx => makeCtx(extra);

const pick = (ids?: string[], automation = false): Step[] => {
  if (!ids?.length) return selectSteps(automation);
  const unknown = ids.filter((i) => !STEPS.some((s) => s.id === i || s.group.toLowerCase() === i.toLowerCase()));
  if (unknown.length) throw new Error(`unknown step or group: ${unknown.join(", ")}`);
  return STEPS.filter((s) => ids.includes(s.id) || ids.some((i) => i.toLowerCase() === s.group.toLowerCase()));
};

// P7: `hub project sync|show|doctor`; account names come from the mail-mcp daemon (read-only).
async function mailAccounts(ctx: Ctx): Promise<string[]> {
  const r = await mcpCall(ctx, ctx.mailUrl, "list_accounts", { enabled: true });
  if (!r.ok) return [];
  try {
    const j = JSON.parse(r.text);
    const list: unknown[] = Array.isArray(j) ? j : Array.isArray(j?.accounts) ? j.accounts : [];
    return list.map((a) => (typeof a === "string" ? a : String((a as { name?: unknown })?.name ?? ""))).filter(Boolean);
  } catch {
    const acc = readJson(ctx.paths.configFile)?.account;
    return acc && r.text.includes(acc) ? [acc] : [];
  }
}
// Projects folder: `<HUB_HOME>/projects` (or HUB_PROJECTS). The context is built lazily, when a command runs.
// Manual-first: without a Notion token file (the optional automation token) the Notion read is skipped, not failed;
// the session reads Notion through its own connector. A project with its own `notion.token_file` is still checked.
const projectOptions = () => ({
  mailAccounts: () => mailAccounts(ctxOf()),
  notionCheck: async (p: Parameters<typeof notionCheck>[1]) => {
    const ctx = ctxOf();
    const { tokenFile } = p.parsed.config.notion;
    if (tokenFile === "notion-token" && !existsSync(path.join(ctx.configDir, tokenFile))) {
      return { ok: true, detail: "skipped: no Notion token file (manual sessions use the Notion connector; `hub setup --automation` adds one)" };
    }
    return notionCheck(ctx, p);
  },
});
const projectsDir = () => ctxOf().paths.projects;
// Folder holding state/evidence/...: the hub root; HUB_LEDGER_ROOT overrides it, so tests never write the live ledger.
const ledgerRoot = () => process.env.HUB_LEDGER_ROOT ?? ctxOf().paths.home;
const done = (code: number) => { process.exitCode = code; };

// P19: the registry (projects, kind, archived, addresses) is derived from the files, so every `hub agent` and `hub up` rebuilds it first.
// A broken project.md must not stop a session: the sync is all-or-nothing, the old index stays, and the problem is printed.
program.hook("preAction", async (_cmd, action) => {
  const name = action.name();
  if (name !== "agent" && !(name === "up" && !action.opts<{ demo?: boolean }>().demo)) return;
  ctxOf(); // no HUB_HOME: stop here with the one-line error, not a "sync skipped" warning
  try {
    await runSync({ projectsRoot: projectsDir(), out: (l) => { if (!/^synced /.test(l)) console.error(c.yellow(`project sync: ${l}`)); } });
  } catch (e) {
    console.error(c.yellow(`project sync skipped: ${e instanceof Error ? e.message : String(e)}`));
  }
});

program.command("agent").description("Start a Claude Code session in this repo. No argument: continue the last session. <project>: a FRESH session bound to that project.")
  .argument("[target]", "a project slug, or: continue (default) | new | pick")
  .argument("[claude-args...]", "extra flags for claude, after `--` (e.g. -- --model opus)")
  .allowUnknownOption()
  .addHelpText("after", `
${c.bold("Modes")}
  hub agent                   continue the last session (a fresh one if none exists)
  hub agent <project>         fresh session, HUB_PROJECT set, prompt pins it to that project
  hub agent new               fresh session, no project (the phrase names it)
  hub agent pick              choose a session from the list
  hub agent <x> -- --model opus   anything after -- goes to claude
Claude runs with --dangerously-skip-permissions --chrome, plus per-project deny rules, a strict MCP config and the guard hook (state/projects/<slug>/). With no argument the last binding is kept. Extra folders it may read: HUB_EXTRA_DIRS (colon-separated) or extra_dirs in config/config.json; none by default.`)
  .action(async (target: string | undefined, rest: string[]) => {
    const ctx = ctxOf();
    done(await runAgent({ root: ctx.paths.home, home: ctx.home, projectsDir: projectsDir(), paths: ctx.paths }, [...(target ? [target] : []), ...rest]));
  });

program.command("up").description("Local admin (production build) + API on the LIVE database, 127.0.0.1 only; opens the browser. --demo: invented data on a separate demo database.")
  .option("--no-open", "do not open the browser")
  .option("--demo", "demo mode: a throw-away instance folder in the OS temp dir, seeded with invented clients (needs no HUB_HOME); the live data is not touched")
  .action(async (o: { open: boolean; demo?: boolean }) => {
    if (!o.demo) ctxOf(); // the live admin needs an instance
    done(await runUp(CORE_ROOT, { open: o.open, demo: o.demo }));
  });

program.command("test").description("Typecheck, then tests, for the whole monorepo.")
  .action(async () => done(await runTests(CORE_ROOT)));

program.command("projects").description("List the projects a session can be bound to (the instance's projects folder; folders starting with _ are templates).")
  .option("--json", "machine-readable output")
  .action((o: { json?: boolean }) => {
    const list = listProjects(projectsDir());
    if (o.json) return console.log(JSON.stringify(list));
    if (!list.length) return console.log(c.yellow("no projects yet: `hub agent new`, then say \"настрой проект <имя>\""));
    for (const s of list) console.log(`${c.green("●")} ${c.bold(s)}  ${c.dim(`hub agent ${s}`)}`);
  });

program.command("init").description("Create a new instance in an empty folder: git, the core as a submodule at a pin, the instance files, skill links, config defaults, doctor, one commit. Needs no HUB_HOME; never pushes.")
  .argument("<dir>", "the new instance folder (must not exist or be empty)")
  .option("--core-url <url>", "the core repository to add as core/ (default: the origin of the core in use)")
  .option("--pin <tag|main>", "a vX.Y.Z tag, or main to follow the tip (default: the newest tag, else main)")
  .option("--name <name>", "instance name for the README (default: the folder name)")
  .option("--dry-run", "list what would be created, write nothing")
  .action(async (dir: string, o: { coreUrl?: string; pin?: string; name?: string; dryRun?: boolean }) => {
    const run = async (cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) => {
      const r = await execa(cmd, args, { reject: false, cwd: opts.cwd, env: { ...process.env, ...(opts.env ?? {}) }, timeout: 600_000 });
      return { code: r.exitCode ?? 1, stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? "") };
    };
    try {
      const r = await initInstance({ dir, ...(o.coreUrl ? { coreUrl: o.coreUrl } : {}), ...(o.pin ? { pin: o.pin } : {}), ...(o.name ? { name: o.name } : {}), ...(o.dryRun ? { dryRun: true } : {}) }, { run, log: (m) => console.log(m) });
      if (!o.dryRun) {
        console.log(c.green(`created ${r.dir} (core ${r.follows ? "follows main" : r.pin})`));
        console.log(`next: cd ${r.dir} && ./run.sh doctor; then ./run.sh agent <project> and say «настрой проект <project>». Make the repository private before you push it.`);
      }
      done(0);
    } catch (e) {
      if (e instanceof InitError) throw new UsageError(e.message);
      throw e;
    }
  });

program.command("status").description("One table over the instances next to this core (or the folders given with --root): core version and pin, projects, drafts waiting, admin port. Read only; needs no HUB_HOME.")
  .option("--root <dir...>", "folders that are an instance or hold instances (default: the folder next to the core in use)")
  .option("--json", "machine-readable output")
  .action(async (o: { root?: string[]; json?: boolean }) => {
    const homes = findInstances(o.root ?? []);
    const rows = await Promise.all(homes.map((h) => instanceStatus(h)));
    if (o.json) return console.log(JSON.stringify(rows, null, 2));
    if (!rows.length) return console.log(c.yellow("no instances found next to this core: pass --root <dir>, or make one with `hub init <dir>`"));
    console.log(statusTable(rows));
  });

program.command("core").description("Move an instance to another core version. `hub core update` lists the tags; `hub core update <tag> --apply` checks it out, rewrites core.version and runs the instance check; a failed move is put back.")
  .command("update").argument("[tag]", "a vX.Y.Z tag of the core").option("--apply", "do it (default: show the plan)").option("--branch <name>", "follow the tip of origin/<name> instead of a tag (a test instance; the pin stays a commit)")
  .action(async (tag: string | undefined, o: { apply?: boolean; branch?: string }) => {
    const r = await coreUpdate(ctxOf(), tag, !!o.apply, o.branch);
    for (const l of r.lines) console.log(l);
    done(r.ok ? 0 : 1);
  });

program.command("link").description("Put `hub` on PATH: a symlink ~/.local/bin/hub, so it works from any folder.")
  .option("--remove", "remove the link")
  .action((o: { remove?: boolean }) => {
    const plan = planLink(CORE_ROOT, homedir(), process.env.PATH ?? "/usr/bin:/bin");
    if (o.remove) return console.log(removeLink(plan));
    console.log(c.green(installLink(plan).message));
    if (!plan.onPath) console.log(c.yellow(pathHint(plan)));
  });

program.command("record-draft").description("A session reports one UNSENT draft it left in Mail, so it shows in the admin. JSON on stdin (email, subject, mailRef, ...); prints one JSON line, exit 0 only when it says ok.")
  .requiredOption("--project <slug>", "the project the session is bound to")
  .action(async (o: { project: string }) => {
    const r = await recordDraft({ project: o.project, payload: readFileSync(0, "utf8"), projectsDir: projectsDir(), configFile: ctxOf().paths.configFile, ledgerRoot: ledgerRoot() });
    console.log(r.line);
    done(r.code);
  });

program.command("record-client").description("A session reports a client it handled without a draft (skipped, escalated, injection_suspected), so the admin inbox shows who was seen. JSON on stdin (email, action, notion, ...); no mail text; prints one JSON line, exit 0 only when it says ok.")
  .requiredOption("--project <slug>", "the project the session is bound to")
  .action(async (o: { project: string }) => {
    const r = await recordClient({ project: o.project, payload: readFileSync(0, "utf8") });
    console.log(r.line);
    done(r.code);
  });

program.command("send").argument("[draftId]", "the draft to send").description("Send an accepted draft from Mail (dry run unless --apply); --due runs the autosend queue (off unless a project says send.mode: auto); --cancel/--stop/--resume/--status. Only a person or this command sends: the agent has no send tool.")
  .option("--apply", "really send (default: dry run, nothing leaves)")
  .option("--due", "autosend runner: queue eligible drafts of send.classes, send those whose cancel window is over")
  .option("--project <slug>", "limit --due, --stop, --resume, --status to one project")
  .option("--cancel <sendId>", "cancel a queued send inside its window")
  .option("--stop", "Stop all: cancel queued sends and refuse new ones (one project with --project)")
  .option("--resume", "lift Stop all")
  .option("--status", "show Stop all and the queued sends (the last sends with --project)")
  .action(async (draftId: string | undefined, o: { apply?: boolean; due?: boolean; project?: string; cancel?: string; stop?: boolean; resume?: boolean; status?: boolean }) => {
    const num = (v: string | undefined) => (v === undefined ? undefined : /^\d+$/.test(v) ? Number(v) : NaN);
    const id = num(draftId);
    const cancel = num(o.cancel);
    if (Number.isNaN(id) || Number.isNaN(cancel)) { console.log(JSON.stringify({ ok: false, error: "draftId and --cancel take a number" })); return done(2); }
    const { cancel: _c, ...rest } = o;
    done(await runSendCommand({ ...rest, ...(id !== undefined ? { draftId: id } : {}), ...(cancel !== undefined ? { cancel } : {}) }, { projectsDir: projectsDir(), configFile: ctxOf().paths.configFile }));
  });

registerProjectCommands(program, projectOptions());
registerMailFiltersCommands(program).alias("filters");

program.command("install").description("Run the steps a manual session needs: check, apply only when it fails, print what is left. --automation adds the optional background automation.")
  .option("--dry-run", "show what would change, change nothing")
  .option("--only <id...>", "step ids or group names (any step, optional ones included)")
  .option("--automation", "also the optional extras: Notion token, mail login, Telegram poller (off by default)")
  .action(async (o: { dryRun?: boolean; only?: string[]; automation?: boolean }) => {
    const ctx = ctxOf({ dryRun: !!o.dryRun });
    p.intro(`Hub Workflow install${ctx.dryRun ? " (dry run)" : ""}`);
    const reports = await install(ctx, pick(o.only, o.automation));
    console.log(table(reports));
    printGuides(reports);
    p.outro(summary(reports));
    process.exitCode = exitCode(reports);
  });

program.command("doctor").description("Run only the checks a manual session needs; print a pass/fail table. Changes nothing. Automation steps are skipped unless --automation.")
  .argument("[project]", "run the project checks for one project instead")
  .option("--json", "machine-readable output")
  .option("--automation", "also check the optional extras: Notion token, mail login, Telegram poller (off by default)")
  .option("--project <slug>", "same as the [project] argument")
  .action(async (projectArg: string | undefined, o: { json?: boolean; project?: string; automation?: boolean }) => {
    const ctx = ctxOf();
    const project = projectArg ?? o.project;
    if (project) { process.exitCode = await runProjectDoctor(project, projectOptions()); return; }
    const reports = await doctor(ctx, selectSteps(!!o.automation));
    if (o.json) console.log(JSON.stringify(reports.map((r) => ({ id: r.step.id, outcome: r.outcome, detail: r.detail })), null, 2));
    else {
      console.log(table(reports)); console.log(`\n${summary(reports)}`);
      const rows = await projectRows(projectsDir(), projectOptions());
      console.log(`\n${c.bold("Projects")} ${c.dim("(read only; a project's status is changed in its project.md)")}\n${projectTable(rows)}`);
    }
    process.exitCode = reports.some((r) => r.outcome === "failed") ? 1 : 0;
  });

program.command("setup").description("Minimal, tokenless setup for manual sessions (tools, folders, config, skills, project registry, doctor). Safe to rerun. --automation adds the optional Notion token, mail login and Telegram token.")
  .option("--automation", "OFF by default: Notion/Telegram tokens, read-only mail login")
  .option("--non-interactive", "with --automation: no prompts: read HUB_NOTION_TOKEN, HUB_TELEGRAM_TOKEN (each also as <NAME>_FILE) and HUB_MAIL_{ACCOUNT,HOST,USER,PASS[,PORT]}; fail with a list")
  .option("--dry-run", "validate and show what would change, write nothing")
  .action(async (o: { automation?: boolean; nonInteractive?: boolean; dryRun?: boolean }) => {
    const automation = !!o.automation;
    const nonInteractive = !!o.nonInteractive || (!automation && !process.stdin.isTTY); // the default run asks nothing; a script never hangs on the automation prompts
    if (automation && !nonInteractive && !process.stdin.isTTY) throw new Error("no terminal: use `pnpm hub setup --automation --non-interactive`");
    const ctx = ctxOf({ dryRun: !!o.dryRun });
    const out = await runSetup(ctx, { ui: nonInteractive ? quietUi : clackUi, validators: makeValidators(ctx), env: process.env, steps: selectSteps(automation) }, { nonInteractive, automation });
    process.exitCode = out.exitCode;
    // `hub` on PATH from any folder (skipped in a dry run)
    const plan = planLink(ctx.paths.core, ctx.home, ctx.pathEnv);
    if (ctx.dryRun) console.log(c.dim(`would link ${plan.linkPath} -> ${plan.target}`));
    else {
      try { console.log(c.green(installLink(plan).message)); if (!plan.onPath) console.log(c.yellow(pathHint(plan))); }
      catch (e) { console.error(c.yellow(`could not put hub on PATH: ${(e as Error).message}`)); }
    }
  });

program.command("audit-run").description("Audit of one finished session: did any tool call leave the project (foreign mail account, foreign knowledge project, another project's folder, a send-capable tool)? And a table of the evidence behind every reply (messages read, profile, facts, anchors, similarity); exit 1 on a breach or a red row. Read only.")
  .argument("<log>", "a Claude Code session transcript (.jsonl), a `claude -p --output-format stream-json` log, or a session folder (its subagents/*.jsonl are read too)")
  .requiredOption("--project <slug>", "the project the session was bound to")
  .action((log: string, o: { project: string }) => {
    const r = auditRun(path.resolve(log), o.project);
    if (!r.violations.length) console.log(`clean: ${r.calls} tool call(s), none left project ${r.project}`);
    else {
      console.log(`BREACH: ${r.violations.length} of ${r.calls} tool call(s) left project ${r.project}`);
      for (const v of r.violations) console.log(`- ${v}`);
      process.exitCode = 1;
    }
    if (r.evidence.length) {
      console.log(`\nevidence behind ${r.evidence.length} repl${r.evidence.length === 1 ? "y" : "ies"}:`);
      for (const l of evidenceTable(r.evidence)) console.log(l);
      if (r.evidence.some((x) => x.verdict === "red")) { console.log("RED: at least one reply was written without the thread or profile read, or copies another."); process.exitCode = 1; }
    }
  });

program.command("batch-check").description("One batch of drafts as a set: evidence per client, the closest pairs, counts; exit 1 on a red row. Reads state/evidence (works with the server off).")
  .requiredOption("--project <slug>", "the project")
  .requiredOption("--batch <key>", "the batchKey every record-draft of the run passed")
  .option("--json", "machine-readable output")
  .action((o: { project: string; batch: string; json?: boolean }) => {
    const r = batchCheck(ledgerRoot(), o.project, o.batch);
    if (!r.rows.length) { console.log(o.json ? JSON.stringify({ ok: false, error: `no drafts recorded with batchKey ${o.batch} in ${o.project}` }) : `no drafts recorded with batchKey ${o.batch} in ${o.project}`); return done(2); }
    if (o.json) console.log(JSON.stringify(r)); else for (const l of batchLines(r)) console.log(l);
    done(r.red ? 1 : 0);
  });

program.command("guard").description("PreToolUse hook of `hub agent`: reads one tool call as JSON on stdin; exit 0 allows, exit 2 blocks. Default warn mode (logs to state/guard.log); HUB_GUARD=block refuses a call that leaves the project.")
  .option("--post", "PostToolUse hook: append the call to the evidence ledger (state/evidence/<slug>/<session>.jsonl); never blocks")
  .action((o: { post?: boolean }) => {
    if (o.post) { runGuardPost(readFileSync(0, "utf8"), { root: ledgerRoot() }); return; }
    const r = runGuard(readFileSync(0, "utf8"), { root: ctxOf().paths.home, projectsDir: projectsDir(), paths: ctxOf().paths });
    if (r.stderr) console.error(r.stderr);
    done(r.code);
  });

program.command("uninstall").description("Remove the skill links `hub setup` made in ~/.claude/skills. Keeps config, state and secrets.")
  .option("--dry-run")
  .action(async (o: { dryRun?: boolean }) => {
    for (const l of await uninstall(ctxOf({ dryRun: !!o.dryRun }))) console.log(l);
  });

program.command("guide").description("Print the numbered manual steps (those a manual session needs, or one by id; --automation adds the optional ones).")
  .argument("[id]")
  .option("--automation", "include the optional steps")
  .action((id: string | undefined, o: { automation?: boolean }) => {
    const steps = (id ? STEPS : selectSteps(!!o.automation)).filter((s) => s.manual && (!id || s.id === id));
    if (!steps.length) throw new Error(id ? `no manual step ${id}` : "no manual steps");
    steps.forEach((s, i) => console.log(`${i ? "\n" : ""}[${s.id}] ${guideText(s)}`));
  });

program.command("docs").description("Generate @docs/core/client-setup.md from the step list.")
  .option("--check", "exit 1 if the file is out of date")
  .action((o: { check?: boolean }) => {
    const f = path.join(CORE_ROOT, "@docs", "core", "client-setup.md");
    const text = renderClientSetup(STEPS);
    if (o.check) {
      let cur = ""; try { cur = readFileSync(f, "utf8"); } catch { /* missing */ }
      if (cur !== text) { console.error("@docs/core/client-setup.md is out of date: run `pnpm hub docs`"); process.exitCode = 1; } else console.log("client-setup.md is current");
      return;
    }
    writeFileSync(f, text);
    console.log(`wrote ${f}`);
  });

program.command("token").description("Optional: store the Notion integration token in state/secrets/ (git-ignored, mode 600). Value comes from a hidden prompt or stdin.")
  .argument("<name>", "notion")
  .action(async (name: string) => {
    if (name !== "notion") throw new Error("name must be notion");
    const ctx = ctxOf();
    const key: SecretName = `${name}-token`;
    let value: string;
    if (process.stdin.isTTY) {
      const v = await p.password({ message: `Paste the ${name} token (hidden)` });
      if (p.isCancel(v)) return;
      value = v;
    } else value = readFileSync(0, "utf8");
    if (!value.trim()) throw new Error("empty token, nothing stored");
    console.log(`stored ${storeSecret(ctx, key, value)} (mode 600)`);
  });

async function main(): Promise<void> {
  let argv = process.argv.slice(2);
  if (argv.length === 0) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) { program.outputHelp(); return; }
    const chosen = await runMenu(listProjects(projectsDir()));
    if (!chosen) return;
    argv = chosen;
  }
  await program.parseAsync(argv, { from: "user" });
}

main().catch((e) => {
  const missing = e instanceof HubHomeMissingError;
  let msg = e instanceof Error ? e.message : String(e);
  if (!missing) { try { msg = redact(ctxOf(), msg); } catch { /* no instance to read secrets from: nothing to redact */ } }
  console.error(`${c.red("error:")} ${msg}`);
  process.exit(missing || e instanceof UsageError ? 2 : 1);
});

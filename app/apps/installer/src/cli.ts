#!/usr/bin/env tsx
import * as p from "@clack/prompts";
import { registerMailFiltersCommands } from "@hub/mail-filters/hub-commands";
import { registerDevCommands, registerProjectCommands, runProjectDoctor, runSync } from "@hub/projects/hub-commands";
import { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { renderNotionFields } from "./notion-docs.ts";
import { CORE_ROOT, HubHomeMissingError } from "@hub/config/paths";
import { makeCtx, readJson, type Ctx } from "./context.ts";
import { auditRun, evidenceTable } from "./audit-run.ts";
import { batchCheck, batchLines } from "./batch-check.ts";
import { listProjects, runAgent } from "./agent.ts";
import { installLink, pathHint, planLink, removeLink } from "./link.ts";
import { backup, verify } from "./backup.ts";
import { coreUpdate } from "./core-update.ts";
import { coreDev, coreInstall } from "./core-link.ts";
import { workspaceCheck, workspaceInit } from "./workspace.ts";
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
import { renderChecklist } from "./docs.ts";
import { doctor, exitCode, guideText, idWidth, install, printGuides, slowest, summary, table, tableHeader, tableRow } from "./runner.ts";
import { redact } from "@hub/connections";
import { connectionsReport, connectionsTable, storeNamedToken, TOKEN_NAMES } from "./connections-command.ts";
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
audit-run, batch-check, send, connections, backup, uninstall. Each has its own \`hub <name> --help\`.`);
// Every command that needs an instance builds its context here: without HUB_HOME that is a HubHomeMissingError (exit 2, one line).
// Commands that need none (`--help`, `docs`, `test`, `link`, `guide`) never call it.
const ctxOf = (extra: Partial<Ctx> = {}): Ctx => makeCtx(extra);

const pick = (ids?: string[], automation = false, audit = false): Step[] => {
  if (!ids?.length) return selectSteps(automation, audit);
  const unknown = ids.filter((i) => !STEPS.some((s) => s.id === i || s.group.toLowerCase() === i.toLowerCase()));
  if (unknown.length) throw new Error(`unknown step or group: ${unknown.join(", ")}`);
  return STEPS.filter((s) => ids.includes(s.id) || ids.some((i) => i.toLowerCase() === s.group.toLowerCase()));
};

// P7: `hub project sync|show|doctor`; account names come from the mail-mcp daemon (read-only).
// `undefined`: Mail could not be asked (Mail.app closed, mail-mcp down): the check is skipped. An empty list means Mail answered and has none.
async function mailAccounts(ctx: Ctx): Promise<string[] | undefined> {
  const r = await mcpCall(ctx, ctx.mailUrl, "list_accounts", { enabled: true });
  if (!r.ok) return undefined;
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
      return { ok: true, skipped: true, detail: "no Notion token file: not read (manual sessions use the Notion connector; `hub setup --automation` adds one)" };
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

const coreCmd = program.command("core").description("The core of an instance. `hub core update` lists the tags; `hub core update <tag> --apply` moves the pin; `hub core install` makes core/ the pinned submodule (the default); `hub core dev <path>` replaces it with a link to a local core checkout.");
coreCmd.command("install").description("core/ as the git submodule at the recorded commit (the default state). Removes a dev link made by `hub core dev` and checks the instance.")
  .action(async () => {
    const r = await coreInstall(ctxOf());
    for (const l of r.lines) console.log(l);
    done(r.ok ? 0 : 1);
  });
coreCmd.command("dev").description("Local core development: remove the core/ submodule checkout and link core/ to <path>, a core checkout you edit. git ignores core/ meanwhile. Dry run unless --apply; undo with `hub core install`.")
  .argument("<path>", "the core checkout to develop in").option("--apply", "do it (default: show the plan)")
  .action(async (p: string, o: { apply?: boolean }) => {
    const r = await coreDev(ctxOf(), p, !!o.apply);
    for (const l of r.lines) console.log(l);
    done(r.ok ? 0 : 1);
  });
coreCmd
  .command("update").argument("[tag]", "a vX.Y.Z tag of the core").option("--apply", "do it (default: show the plan)").option("--branch <name>", "follow the tip of origin/<name> instead of a tag (a test instance; the pin stays a commit)")
  .action(async (tag: string | undefined, o: { apply?: boolean; branch?: string }) => {
    const r = await coreUpdate(ctxOf(), tag, !!o.apply, o.branch);
    for (const l of r.lines) console.log(l);
    done(r.ok ? 0 : 1);
  });

const wsCmd = program.command("workspace").description("An instance with its own apps/ and packages/ shares ONE pnpm/turbo workspace with the core (decision 0018). The root files are generated.");
wsCmd.command("init").description("Generate package.json, pnpm-workspace.yaml and turbo.json at the instance root from core/app. Dry run unless --apply.")
  .option("--apply", "write the files (default: show the plan)")
  .action((o: { apply?: boolean }) => {
    const r = workspaceInit(ctxOf(), !!o.apply);
    for (const l of r.lines) console.log(l);
    done(r.ok ? 0 : 1);
  });
wsCmd.command("check").description("The generated root files match the core in use (run after `hub core update`).")
  .action(() => {
    const r = workspaceCheck(ctxOf());
    for (const l of r.lines) console.log(l);
    done(r.ok ? 0 : 1);
  });

program.command("link").description("Optional shortcut: put `hub` on PATH (a symlink ~/.local/bin/hub), the one thing this tool ever writes in your home. An instance runs fine without it: use ./run.sh.")
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
registerDevCommands(program, projectOptions());
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

program.command("doctor").description("Run the checks a manual session needs plus the audit checks (backups); each row prints as its step finishes, with its time. Changes nothing. --only runs named steps or groups; --fast leaves the audit checks out. Automation steps are skipped unless --automation.")
  .argument("[project]", "run the project checks for one project instead")
  .option("--json", "machine-readable output (printed at the end, with each step's milliseconds)")
  .option("--automation", "also check the optional extras: Notion token, mail login, Telegram poller (off by default)")
  .option("--only <id...>", "step ids or group names (any step, optional and audit ones included), for example `--only backup.snapshot` or `--only Backup`")
  .option("--fast", "leave out the audit steps (the backup.* checks: they reach the network and open the database)")
  .option("--project <slug>", "same as the [project] argument")
  .action(async (projectArg: string | undefined, o: { json?: boolean; project?: string; automation?: boolean; only?: string[]; fast?: boolean }) => {
    const ctx = ctxOf();
    const project = projectArg ?? o.project;
    if (project) { process.exitCode = await runProjectDoctor(project, projectOptions()); return; }
    if (o.only?.length && o.fast) throw new UsageError("--only and --fast are separate: --only already names the steps");
    const steps = pick(o.only, !!o.automation, !o.fast);
    let reports;
    if (o.json) reports = await doctor(ctx, steps);
    else {
      const w = idWidth(steps);
      console.log(tableHeader(w, true));
      reports = await doctor(ctx, steps, (r) => console.log(tableRow(r, w, true)));
    }
    if (o.json) console.log(JSON.stringify(reports.map((r) => ({ id: r.step.id, outcome: r.outcome, ms: r.ms, detail: r.detail })), null, 2));
    else {
      console.log(`\n${summary(reports)}`);
      const slow = slowest(reports); if (slow) console.log(slow);
      if (!o.only?.length) {
        const rows = await projectRows(projectsDir(), projectOptions());
        console.log(`\n${c.bold("Projects")} ${c.dim("(read only; a project's status is changed in its project.md)")}\n${projectTable(rows)}`);
      }
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
    // Nothing is written outside the instance. The `hub` shortcut on PATH is the owner's choice: `hub link`.
    console.log(c.dim("Run the instance with ./run.sh. Optional: `hub link` puts a `hub` shortcut at ~/.local/bin/hub (the only thing this tool writes in your home)."));
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
    if (o.post) { const r = runGuardPost(readFileSync(0, "utf8"), { root: ledgerRoot() }); if (r.stdout) process.stdout.write(r.stdout + "\n"); return; }
    const r = runGuard(readFileSync(0, "utf8"), { root: ctxOf().paths.home, projectsDir: projectsDir(), paths: ctxOf().paths });
    if (r.stderr) console.error(r.stderr);
    done(r.code);
  });

program.command("uninstall").description("Remove this instance's skill links (<instance>/.claude/skills) and report old links in ~/.claude/skills with the command that removes them. Keeps config, state and secrets.")
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

program.command("docs").description("Generate @docs/setup/checklist.md and @docs/notion/fields.md from their sources.")
  .option("--check", "exit 1 if a file is out of date")
  .action((o: { check?: boolean }) => {
    const targets = [
      { f: path.join(CORE_ROOT, "@docs", "setup", "checklist.md"), text: renderChecklist(STEPS), rel: "@docs/setup/checklist.md" },
      { f: path.join(CORE_ROOT, "@docs", "notion", "fields.md"), text: renderNotionFields(CORE_ROOT), rel: "@docs/notion/fields.md" },
    ];
    for (const t of targets) {
      if (o.check) {
        let cur = ""; try { cur = readFileSync(t.f, "utf8"); } catch { /* missing */ }
        if (cur !== t.text) { console.error(`${t.rel} is out of date: run \`pnpm hub docs\``); process.exitCode = 1; } else console.log(`${t.rel} is current`);
      } else { mkdirSync(path.dirname(t.f), { recursive: true }); writeFileSync(t.f, t.text); console.log(`wrote ${t.f}`); }
    }
  });

program.command("backup").description("A dated snapshot outside the instance: a verified copy of data/app.db, a copy of the newest existing Notion dump per project (--notion-dump runs a live one first), config/config.json and a manifest with sha256 per file. Secrets are never read or copied. Dry run unless --apply; --verify [snapshot] re-checks one (default: the newest). Keeps the newest 14.")
  .option("--apply", "write the snapshot (default: show what would happen)")
  .option("--notion-dump", "run a live notion-dump of each project into the snapshot first (minutes to hours; default: copy the newest dump that exists)")
  .option("--verify [snapshot]", "re-check a snapshot (a folder name or path; default the newest): hashes and integrity_check of the copied database; nothing is restored")
  .action(async (o: { apply?: boolean; notionDump?: boolean; verify?: string | boolean }) => {
    const ctx = ctxOf();
    if (o.verify !== undefined && o.apply) throw new UsageError("--verify and --apply are separate runs");
    const r = o.verify !== undefined ? verify(ctx, typeof o.verify === "string" ? o.verify : undefined) : await backup(ctx, { apply: !!o.apply, notionDump: !!o.notionDump });
    for (const l of r.lines) console.log(l);
    done(r.ok ? 0 : 1);
  });

program.command("token").description("Optional: store the Notion integration token or the Telegram bot token in state/secrets/ (git-ignored, mode 600). Value comes from a hidden prompt or stdin.")
  .argument("<name>", TOKEN_NAMES.join(" or "))
  .action(async (name: string) => {
    const known = TOKEN_NAMES.find((n) => n === name);
    if (!known) throw new UsageError(`name must be ${TOKEN_NAMES.join(" or ")}`);
    const ctx = ctxOf();
    let value: string;
    if (process.stdin.isTTY) {
      const v = await p.password({ message: `Paste the ${known} token (hidden)` });
      if (p.isCancel(v)) return;
      value = v;
    } else value = readFileSync(0, "utf8");
    console.log(`stored ${storeNamedToken(ctx, known, value)} (mode 600)`);
    if (known === "telegram") console.log("a new bot token applies on the next server start");
  });

program.command("connections").description("List the instance's connections (mail logins, Notion token, Telegram bot) as the admin's Connections page shows them. Reads files only; prints no secret.")
  .option("--test", "also test each stored login with the provider (network; read-only)")
  .action(async (o: { test?: boolean }) => {
    const ctx = ctxOf();
    const rep = await connectionsReport(ctx, { test: !!o.test, deps: { fetch: ctx.fetch } });
    console.log(connectionsTable(rep));
    done(rep.exitCode);
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
  if (!missing) { try { msg = redact(ctxOf().configDir, msg); } catch { /* no instance to read secrets from: nothing to redact */ } }
  console.error(`${c.red("error:")} ${msg}`);
  process.exit(missing || e instanceof UsageError ? 2 : 1);
});

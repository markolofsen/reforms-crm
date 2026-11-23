import * as p from "@clack/prompts";
import { runProjectDoctor } from "@hub/projects/commands";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { renderNotionFields } from "../notion-docs";
import { CORE_ROOT } from "@hub/config/paths";
import { installLink, pathHint, planLink, removeLink } from "../link";
import { backup } from "./backup/snapshot";
import { verify } from "./backup/verify";
import { coreUpdate } from "../core-update";
import { coreDev, coreInstall } from "../core-link";
import { workspaceCheck, workspaceInit } from "../workspace";
import { ghCreateLine, gitToplevel, initInstance, InitError, instanceDir, kindFromAnswer, kindQuestion } from "../init";
import { findInstances, instanceStatus, statusTable } from "../status";
import { execa } from "execa";
import { projectRows, projectTable } from "../project-table";
import { c, UsageError } from "../term";
import { renderChecklist } from "../docs";
import { doctor, exitCode, expandSteps, guideText, idWidth, install, printGuides, slowest, summary, table, tableHeader, tableRow } from "../runner";
import { makeValidators } from "../setup/clients";
import { runSetup } from "../setup/wizard";
import { clackUi, quietUi } from "../setup/ui";
import { selectSteps, STEPS } from "../steps/index";
import { uninstall } from "../uninstall";
import { ctxOf, pick, projectOptions, projectsDir, done } from "./shared";
import type { Command } from "commander";

/** P126 C1: the instance commands: new-instance, status, core, workspace, link, install, doctor, setup, uninstall, guide, docs, backup. */
export function register(program: Command): void {
  const execRun = async (cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) => {
    const r = await execa(cmd, args, { reject: false, cwd: opts.cwd, env: { ...process.env, ...(opts.env ?? {}) }, timeout: 600_000 });
    return { code: r.exitCode ?? 1, stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? "") };
  };

  program.command("new-instance").description("Create a new PRIVATE instance (P35, P89): git, the core as a submodule at the newest tag, the instance files, optionally a first project of a kind, skill links, config defaults, doctor, one commit. A bare <name> makes ./hub-<name>. Needs no HUB_HOME; never creates a remote and never pushes: it prints the one `gh repo create --private` line.")
    .argument("<name>", "the instance name: folder hub-<name> here, or next to the git checkout you are in (never inside it); or a path to a new empty folder")
    .option("--kind <kind>", "also create the first project of this kind (`hub project kinds`); on a terminal, without it, one question asks")
    .option("--project <slug>", "with --kind: the project's slug (default: the name without hub-)")
    .option("--core-url <url>", "the core repository to add as core/ (default: the origin of the core in use)")
    .option("--pin <tag|main>", "a vX.Y.Z tag, or main to follow the tip (default: the newest tag, else main)")
    .option("--no-install", "do not install dependencies or run the doctor (./run.sh setup in the instance does it later)")
    .option("--dry-run", "list what would be created, write nothing")
    .action(async (name: string, o: { kind?: string; project?: string; coreUrl?: string; pin?: string; install: boolean; dryRun?: boolean }) => {
      const top = gitToplevel(process.cwd());
      const dir = instanceDir(name, process.cwd(), top);
      if (top && !name.includes("/") && !name.startsWith(".")) console.log(c.dim(`inside the checkout ${top}: the new instance goes next to it, ${dir}`));
      // P91: the kind is chosen at install. A terminal is asked once; a script (no TTY) keeps no project unless --kind says one.
      if (!o.kind && process.stdin.isTTY && process.stdout.isTTY) {
        console.log(kindQuestion());
        const v = await p.text({ message: "Kind", placeholder: "Enter: no project yet", validate: (x) => { const r = kindFromAnswer(x ?? ""); return "error" in r ? r.error : undefined; } });
        if (p.isCancel(v)) { p.cancel("nothing created"); return done(1); }
        const r = kindFromAnswer(v ?? "");
        if ("kind" in r && r.kind) o.kind = r.kind;
      }
      try {
        const r = await initInstance({ dir, name: path.basename(dir), install: o.install, ...(o.kind ? { kind: o.kind } : {}), ...(o.project ? { project: o.project } : {}), ...(o.coreUrl ? { coreUrl: o.coreUrl } : {}), ...(o.pin ? { pin: o.pin } : {}), ...(o.dryRun ? { dryRun: true } : {}) }, { run: execRun, log: (m) => console.log(m) });
        if (!o.dryRun) {
          console.log(c.green(`created ${r.dir} (core ${r.follows ? "follows main" : r.pin})`));
          console.log(`\nNext:\n  cd ${JSON.stringify(r.dir)} && ./run.sh setup${r.project ? `\n  ./run.sh agent ${r.project}   then say «настрой проект ${r.project}»` : `\n  ./run.sh agent new   then say «настрой проект <name>»`}`);
          console.log(`\nMake its GitHub repository PRIVATE and push it (run it yourself; the Hub never creates a remote):\n  ${ghCreateLine(r.url, r.dir)}`);
          console.log(c.dim("Teammates then join with: git clone --recurse-submodules <repo> && ./run.sh setup (core/@docs/setup/team.md)."));
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
      if (!rows.length) return console.log(c.yellow("no instances found next to this core: pass --root <dir>, or make one with `hub new-instance <name>`"));
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

  program.command("install").description("Run the steps a manual session needs: check, apply only when it fails, print what is left. --automation adds the optional background automation.")
    .option("--dry-run", "show what would change, change nothing")
    .option("--only <id...>", "step ids or group names (any step, optional ones included)")
    .option("--automation", "also the optional extras: Notion token, Telegram poller (off by default)")
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
    .option("--automation", "also check the optional extras: Notion token, Telegram poller (off by default)")
    .option("--only <id...>", "step ids or group names (any step, optional and audit ones included), for example `--only backup.snapshot` or `--only Backup`")
    .option("--fast", "leave out the audit steps (the backup.* checks: they reach the network and open the database)")
    .option("--canary", "the Leads rows also send each form's signed canary (stored as a test row, nothing outbound); only to a handler that advertises it")
    .option("--project <slug>", "same as the [project] argument")
    .action(async (projectArg: string | undefined, o: { json?: boolean; project?: string; automation?: boolean; only?: string[]; fast?: boolean; canary?: boolean }) => {
      const ctx = ctxOf({ canary: !!o.canary });
      const project = projectArg ?? o.project;
      if (project) { process.exitCode = await runProjectDoctor(project, projectOptions()); return; }
      if (o.only?.length && o.fast) throw new UsageError("--only and --fast are separate: --only already names the steps");
      const steps = await expandSteps(ctx, pick(o.only, !!o.automation, !o.fast));
      let reports;
      const t0 = Date.now();
      if (o.json) reports = await doctor(ctx, steps);
      else {
        const w = idWidth(steps);
        console.log(tableHeader(w, true));
        reports = await doctor(ctx, steps, (r) => console.log(tableRow(r, w, true)));
      }
      if (o.json) console.log(JSON.stringify(reports.map((r) => ({ id: r.step.id, outcome: r.outcome, ms: r.ms, detail: r.detail })), null, 2));
      else {
        console.log(`\n${summary(reports)}`);
        const slow = slowest(reports, 3, Date.now() - t0); if (slow) console.log(slow);
        if (!o.only?.length) {
          const rows = await projectRows(projectsDir(), { ...projectOptions(), policyDir: ctxOf().paths.stateProjects });
          console.log(`\n${c.bold("Projects")} ${c.dim("(read only; a project's status is changed in its project.md)")}\n${projectTable(rows)}`);
        }
      }
      process.exitCode = reports.some((r) => r.outcome === "failed") ? 1 : 0;
    });

  program.command("setup").description("The smart install (P89): says whether this is a new instance, a teammate joining, or an existing install; then tools, folders, config, skills, project registry and doctor (tokenless, safe to rerun); ends with what is personal and missing on this Mac, each with its fix. --automation adds the optional Notion and Telegram tokens.")
    .option("--automation", "OFF by default: Notion/Telegram tokens")
    .option("--non-interactive", "with --automation: no prompts: read HUB_NOTION_TOKEN, HUB_TELEGRAM_TOKEN (each also as <NAME>_FILE); fail with a list")
    .option("--dry-run", "validate and show what would change, write nothing")
    .option("--person <name>", "your name as your team sees it in Notion (Last sent by); stored in state/person.json on this Mac only (P89). A terminal asks once when it is not set")
    .action(async (o: { automation?: boolean; nonInteractive?: boolean; dryRun?: boolean; person?: string }) => {
      const automation = !!o.automation;
      const nonInteractive = !!o.nonInteractive || (!automation && !process.stdin.isTTY); // the default run asks nothing; a script never hangs on the automation prompts
      if (automation && !nonInteractive && !process.stdin.isTTY) throw new Error("no terminal: use `pnpm hub setup --automation --non-interactive`");
      const ctx = ctxOf({ dryRun: !!o.dryRun });
      const out = await runSetup(ctx, { ui: nonInteractive ? quietUi : clackUi, validators: makeValidators(ctx), env: process.env, steps: selectSteps(automation), mailAccounts: () => mailAccounts(ctx), askPerson: true }, { nonInteractive, automation, ...(o.person ? { person: o.person } : {}) });
      process.exitCode = out.exitCode;
      // Nothing is written outside the instance. The `hub` shortcut on PATH is the owner's choice: `hub link`.
      console.log(c.dim("Run the instance with ./run.sh. Optional: `hub link` puts a `hub` shortcut at ~/.local/bin/hub (the only thing this tool writes in your home)."));
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
}

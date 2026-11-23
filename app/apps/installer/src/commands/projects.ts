// P126 C1: `hub project …` and `hub dev …`, registered by the installer; the work is @hub/projects/commands (no commander there).
import type { Command } from "commander";
import { runAddresses, runDevIndex, runDevInit, runKinds, runProjectDoctor, runProjectSetup, runRename, runShow, runSync, runWorkflowsCheck, runWorkflowsList, type Ask, type ProjectCommandOptions, type SetupFlags } from "@hub/projects/commands";
import type { Interface as ReadlineInterface } from "node:readline/promises";

/** Adds `dev index` and `dev init`: the development kanban of each project (`projects/<slug>/@dev/`) and of the Hub (`--path`). */
export function registerDevCommands(program: Command, o: ProjectCommandOptions = {}): Command {
  const dev = program.command("dev").description("Development kanban: projects/<slug>/@dev/ (a project's own plans; the Hub's own @dev uses `index --path`).");
  dev
    .command("index")
    .description("Regenerate the track table in a project's @dev/README.md from its directories and plans (no argument: every project that has one). --check writes nothing and exits 1 on drift: a stale table, a plan without PLAN.md, a plan Status that contradicts its directory.")
    .argument("[project]")
    .option("--path <dir>", "a @dev folder anywhere (the Hub's own kanban); needs no instance")
    .option("--check", "check only")
    .action((slug: string | undefined, opts: { path?: string; check?: boolean }) => {
      process.exitCode = runDevIndex(slug, opts.path, !!opts.check, o);
    });
  dev
    .command("init")
    .description("Create projects/<slug>/@dev/ (active, planned, blocked, completed, decisions, research, _archive, CLAUDE.md, README.md) from the core template. Dry run unless --apply; never overwrites a file.")
    .argument("<project>")
    .option("--apply", "write the files (default: show them)")
    .action((slug: string, opts: { apply?: boolean }) => {
      process.exitCode = runDevInit(slug, !!opts.apply, o);
    });
  return dev;
}

/** Adds `project sync`, `project show <slug>`, `project kinds`, `project rename` and `project doctor <slug>` to a commander program. */
export function registerProjectCommands(program: Command, o: ProjectCommandOptions = {}): Command {
  const project = program.command("project").description("Projects: the registry built from <instance>/projects/*/project.md.");
  project
    .command("sync")
    .description("Validate every project.md and rebuild the registry (projects, addresses). All or nothing.")
    .action(async () => {
      process.exitCode = await runSync(o);
    });
  project
    .command("show")
    .description("Print one project's resolved settings and any problems found in its project.md.")
    .argument("<slug>")
    .option("--json", "the resolved project as skills read it (same as .generated/PROJECT.json)")
    .action((slug: string, opts: { json?: boolean }) => {
      process.exitCode = runShow(slug, o, !!opts.json);
    });
  project
    .command("kinds")
    .description("List the project kinds (modules, required fields); with <kind>, print that kind as JSON, taxonomy included.")
    .argument("[kind]")
    .action((kind: string | undefined) => {
      process.exitCode = runKinds(kind, o);
    });
  project
    .command("rename")
    .description("Rename a project slug everywhere (folder, project.md, every project column, registry, state files, binding). Dry run unless --apply; the database file is copied first.")
    .argument("<old>")
    .argument("<new>")
    .option("--apply", "do it (default: show what would change)")
    .action(async (from: string, to: string, opts: { apply?: boolean }) => {
      process.exitCode = await runRename(from, to, !!opts.apply, o);
    });
  project
    .command("setup")
    .description("Answer the open questions of a project: tone, signoff, languages. Flags write directly; without flags a terminal asks for what is still empty (Enter skips).")
    .argument("<slug>")
    .option("--tone <text>", "how replies sound, one line")
    .option("--signoff <text>", "sign-off line of every draft (the same for all brands); with a ## Brands table the brand's Signature follows it")
    .option("--brand <brand=receives>", "add or update a ## Brands row: <Brand>=<addresses and domains, comma separated>; repeatable", (v: string, a: string[] = []) => [...a, v])
    .option("--brand-signature <brand=text>", "the Signature of a brand row, lines separated by <br>: Carapis=\"Carapis team<br>carapis.com\"; repeatable", (v: string, a: string[] = []) => [...a, v])
    .option("--brand-display-name <brand=name>", "the visible From name of a brand row; the technical sender address is unchanged; repeatable", (v: string, a: string[] = []) => [...a, v])
    .option("--languages <tags>", "BCP-47 tags, comma separated")
    .action(async (slug: string, opts: SetupFlags) => {
      let rl: ReadlineInterface | undefined;
      let ask: Ask | undefined;
      if (process.stdin.isTTY && process.stdout.isTTY) {
        const { createInterface } = await import("node:readline/promises");
        rl = createInterface({ input: process.stdin, output: process.stdout });
        ask = (q, hint) => rl!.question(hint ? `${q} [${hint}] ` : `${q} `).then((a) => (a.trim() === "" && hint ? "" : a));
      }
      try {
        process.exitCode = await runProjectSetup(slug, opts, o, ask);
      } finally {
        rl?.close();
      }
    });
  project
    .command("addresses")
    .description("Compare the addresses a project lists with the forwarding rules of an exported routing snapshot (JSON: zone -> { rules }; `-` reads stdin). Dry run unless --apply, which appends the missing ones to mail.aliases.")
    .argument("<slug>")
    .requiredOption("--routes <file>", "routing snapshot file")
    .option("--apply", "write the missing addresses (default: show them)")
    .action((slug: string, opts: { routes: string; apply?: boolean }) => {
      process.exitCode = runAddresses(slug, opts.routes, !!opts.apply, o);
    });
  project
    .command("doctor")
    .description("Run the project checks (same as `doctor --project <slug>`).")
    .argument("<slug>")
    .action(async (slug: string) => {
      process.exitCode = await runProjectDoctor(slug, o);
    });
  const workflows = program.command("workflows").description("Workflows: the playbooks in <project>/workflows/*.md. An agent picks only Active ones whose run mode allows it.");
  workflows
    .command("list")
    .description("List a project's workflows and how an agent may use each. --json prints the index an agent reads (name, description, file; only the ones it may pick).")
    .argument("<slug>")
    .option("--json", "the agent index as JSON")
    .action((slug: string, opts: { json?: boolean }) => {
      process.exitCode = runWorkflowsList(slug, !!opts.json, o);
    });
  workflows
    .command("check")
    .description("Check every workflow file of a project: front matter, status, run mode, required sections. Exit 1 on an error.")
    .argument("<slug>")
    .action((slug: string) => {
      process.exitCode = runWorkflowsCheck(slug, o);
    });
  return project;
}

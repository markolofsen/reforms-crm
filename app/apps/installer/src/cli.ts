#!/usr/bin/env tsx
import { HubError } from "@hub/config/errors";
import { registerKnowledgeCommands } from "./commands/knowledge";
import { registerMailFiltersCommands } from "./commands/mail-filters";
import { registerMessengersCommands } from "./commands/messengers";
import { runSync } from "@hub/projects/commands";
import { registerDevCommands, registerProjectCommands } from "./commands/projects";
import { Command } from "commander";
import { HubHomeMissingError, instanceFeatures } from "@hub/config/paths";
import { listProjects } from "./agent";
import { runMenu } from "./menu";
import { detectClis } from "@hub/agent/detect";
import { c, UsageError } from "./term";
import { redact } from "@hub/connections";
import { ctxOf, projectOptions, projectsDir } from "./commands/shared";
import { registerSequencesCommands } from "./commands/sequences";
import { register as registerSession } from "./commands/session";
import { register as registerServer } from "./commands/server";
import { register as registerInstance } from "./commands/instance";
import { register as registerDrafts } from "./commands/drafts";
import { register as registerConnections } from "./commands/connections";
import { register as registerLogs } from "./commands/logs";
import { register as registerWatch } from "./commands/watch";

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
  hub stop | restart          the server the LaunchAgent started at login (hub autostart [status|on|off])
  hub doctor [project]        read-only health check (of one project when given)
  hub setup                   idempotent, tokenless install of tools, folders, skills

Other commands are hidden to keep this list short: projects, filters, link, install, guide, docs, test, token,
audit-run, log, open, send, drafts, client, sequences, connections, connectors, backup, uninstall, stop, restart, autostart, new-instance. Each has its own \`hub <name> --help\`.`);

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

registerProjectCommands(program, projectOptions());
registerDevCommands(program, projectOptions());
registerSequencesCommands(program, () => ({ projectsDir: projectsDir() }));
registerMailFiltersCommands(program).alias("filters");
registerKnowledgeCommands(program);
registerMessengersCommands(program);
registerSession(program);
registerServer(program);
registerInstance(program);
registerDrafts(program);
registerConnections(program);
registerLogs(program);
registerWatch(program);

async function main(): Promise<void> {
  let argv = process.argv.slice(2);
  if (argv.length === 0) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) { program.outputHelp(); return; }
    // P57: the CLIs are detected in the owner's login shell while he picks the action and project.
    const chosen = await runMenu(listProjects(projectsDir()), instanceFeatures(ctxOf().paths).agent.default, detectClis().catch(() => null));
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
  // P126 E1: a refusal the Hub states (any HubError) exits 2, like a usage error; anything else is a failure (1).
  process.exit(missing || e instanceof UsageError || e instanceof HubError ? 2 : 1);
});

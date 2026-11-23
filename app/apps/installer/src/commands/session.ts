import { readFileSync } from "node:fs";
import { listProjects, runAgent } from "../agent";
import { runGuard, runGuardPost } from "../safety";
import { c } from "../term";
import { focusLine } from "@hub/agent/focus";
import { currentFocus, runFocusHook } from "../focus-command";
import { runOpenCommand } from "../open-command";
import { ctxOf, projectsDir, ledgerRoot, done } from "./shared";
import type { Command } from "commander";

/** P126 C1: the session commands: agent, projects, guard, focus, open, mcp. */
export function register(program: Command): void {
  program.command("agent").description("Start an agent session (Claude Code or Codex) in this instance. No argument: continue the last session. <project>: a FRESH session bound to that project.")
    .argument("[target]", "a project slug, or: continue (default) | new | pick")
    .argument("[cli-args...]", "--cli claude|codex|shell (default: agent.default), --prepare (write the session files only), --resume <id> (one logged session of that project); extra flags for the CLI after `--`")
    .allowUnknownOption()
    .addHelpText("after", `
  ${c.bold("Modes")}
    hub agent                   continue the bound project's last logged session (a fresh one if none exists)
    hub agent <project>         fresh session, HUB_PROJECT set, prompt pins it to that project
    hub agent new               fresh session, no project (the phrase names it)
    hub agent pick              choose a session from the list
    hub agent <x> --cli codex   the same with Codex (default: agent.default in config/config.json, else claude)
    hub agent <x> --cli shell   your own shell in the instance root, HUB_PROJECT set (not sandboxed)
    hub agent <x> --prepare     write the session files, start nothing
    hub agent <x> --resume <id> resume that session of <x> (a full session id), with today's settings; fresh if it cannot
    hub agent <x> -- --model opus   anything after -- goes to the CLI
  Two modes (config/config.json agent.unattended): normal, the CLI asks before commands and edits; unattended (true), no prompts with the
  OS sandbox on (no network or Apple Events from commands; the send policy, config and core read-only). Always: per-project deny rules, the
  hub's MCP servers only, send tools off, the guard hook (Claude). Codex never runs with its bypass flag. Extra folders Claude may read:
  HUB_EXTRA_DIRS (colon-separated) or extra_dirs in config/config.json; none by default.`)
    .action(async (target: string | undefined, rest: string[]) => {
      const ctx = ctxOf();
      done(await runAgent({ root: ctx.paths.home, home: ctx.home, projectsDir: projectsDir(), paths: ctx.paths }, [...(target ? [target] : []), ...rest]));
    });

  program.command("projects").description("List the projects a session can be bound to (the instance's projects folder; folders starting with _ are templates).")
    .option("--json", "machine-readable output")
    .action((o: { json?: boolean }) => {
      const list = listProjects(projectsDir());
      if (o.json) return console.log(JSON.stringify(list));
      if (!list.length) return console.log(c.yellow("no projects yet: `hub agent new`, then say \"настрой проект <имя>\""));
      for (const s of list) console.log(`${c.green("●")} ${c.bold(s)}  ${c.dim(`hub agent ${s}`)}`);
    });

  program.command("guard").description("PreToolUse hook of `hub agent`: reads one tool call as JSON on stdin; exit 0 allows, exit 2 blocks. Default warn mode (logs to state/guard.log); HUB_GUARD=block refuses a call that leaves the project.")
    .option("--post", "PostToolUse hook: append the call to the evidence ledger (state/evidence/<slug>/<session>.jsonl); never blocks")
    .action((o: { post?: boolean }) => {
      if (o.post) { const r = runGuardPost(readFileSync(0, "utf8"), { root: ledgerRoot() }); if (r.stdout) process.stdout.write(r.stdout + "\n"); return; }
      const r = runGuard(readFileSync(0, "utf8"), { root: ctxOf().paths.home, projectsDir: projectsDir(), paths: ctxOf().paths });
      if (r.stderr) console.error(r.stderr);
      done(r.code);
    });

  program.command("focus").description("What the admin shows (P51 shared focus, P72 refs), as the session bound to HUB_PROJECT sees it: the route and its title, the open record, the pointed row, the selection and the rows on screen, each with its title and the tool that reads it. --hook is the prompt hook of `hub agent` (one line while fresh, else nothing; never blocks). Read only.")
    .option("--json", "print the focus as JSON")
    .option("--hook", "UserPromptSubmit hook output (started by bin/hub.mjs without the CLI); also logs the prompt (P54)")
    .option("--cli <cli>", "with --hook: the CLI that runs it, claude or codex (the session log names it)")
    .action(async (o: { json?: boolean; hook?: boolean; cli?: string }) => {
      if (o.hook) { await runFocusHook(process.env, ["--cli", o.cli ?? "claude"]); return; }
      const f = await currentFocus();
      console.log(o.json ? JSON.stringify(f) : (focusLine(f) ?? `focus: ${f.state}${f.project ? ` (${f.project})` : " (no HUB_PROJECT)"}`));
    });

  program.command("open").description("Open a project's folder or file in Finder or its own app (P61), from a key the hub resolves inside the project: the same actions as the admin's Open buttons. No action: list them. The owner's command only: a session is denied it. macOS only (exit 2 elsewhere).")
    .argument("[action]", "finder.open | finder.reveal | file.open | mail.openMessage | ... (no action lists them)")
    .option("--project <slug>", "the project (default HUB_PROJECT)")
    .option("--key <key>", "project | project.md | knowledge | knowledge:<entry> | workflows | log:<YYYY-MM-DD>")
    .option("--tab <id>", "agent.openInDesktop: the dock tab (not offered)")
    .option("--args <json>", "an href action's arguments as JSON")
    .option("--draft <id>", "mail.openDraft | mail.openMessage: of this hub draft (the Mail draft itself, or the client's mail)")
    .action(async (action: string | undefined, o: { project?: string; key?: string; tab?: string; args?: string; draft?: string }) => {
      const [{ hubPaths }, { createRepos, openDbReadOnly }, lo] = await Promise.all([import("@hub/config/paths"), import("@hub/db"), import("@hub/projects/local-open")]);
      let close = () => {};
      const resolver = () => {
        ctxOf();
        const paths = hubPaths();
        const handle = openDbReadOnly(paths.db);
        close = () => handle.close();
        return lo.localOpenDeps(createRepos(handle.db), paths);
      };
      try {
        // P58 R1: `--draft <id>`: the row (read-only) for the client's mail, one strict Mail read for the draft itself.
        const draftIds = async (project: string | undefined, id: number) => {
          ctxOf();
          const paths = hubPaths();
          const h = openDbReadOnly(paths.db);
          try {
            const repos = createRepos(h.db);
            const row = await repos.drafts.get(id);
            if (!row || (project && row.project !== project)) return { mailRef: null, draft: null, why: `no draft ${id}${project ? ` in project ${project}` : ""}` };
            const [{ findMail, mailAppDraftsCleaner }, { projectStore }] = await Promise.all([import("@hub/send"), import("@hub/projects")]);
            const accounts = projectStore({ projects: paths.projects }).config(row.project).mail.accounts;
            const f = await findMail({ mailer: mailAppDraftsCleaner() }, row, "strict", { accounts, versions: await repos.mailVersions.ofDraft(row.id) });
            return { mailRef: row.mailRef, draft: f.mail?.messageId ?? null, why: f.mail ? null : (f.reason ?? null) };
          } finally {
            h.close();
          }
        };
        done(await runOpenCommand(action, { ...o, project: o.project ?? process.env.HUB_PROJECT }, { out: console.log, resolver, run: lo.execFileOpen, available: lo.localOpenAvailable(), draftIds }));
      } finally {
        close();
      }
    });

  program.command("mcp").description("The hub's MCP server on stdio (P51): focus, highlight (P72, a 30 s ring on his screen), project_show, mail_list, client_show, draft_show, message_show, the knowledge tools, draft_write and client_record (P129), and the messenger tools for HUB_PROJECT; no Mail send. Registered by `hub agent` for Claude Code and Codex; started by bin/hub.mjs without the CLI.")
    .action(async () => { await (await import("@hub/agent/mcp-stdio")).serveHubMcp(); });
}

import { c } from "../term";
import { LOG_VIEWS, runLogCommand } from "../log-command";
import { runLogHook } from "../log-hook";
import { runLogsCommand } from "../logs-command";
import { OPS_LEVELS, OPS_SOURCES } from "@hub/log/ops";
import { ctxOf, done } from "./shared";
import type { Command } from "commander";

/** P126 C1: the log commands: log (the agent session log) and logs (the ops log). */
export function register(program: Command): void {
  program.command("log").description("The agent session log (P54): what the owner asked, what Claude Code or Codex answered, which tools it called, where it asked instead of acting. Views: events (default), tail, sessions, summary. Default: HUB_PROJECT (else every project), the last 7 days. Read only. What failed in the server and the packages is `hub logs` (the ops log).")
    .argument("[view]", LOG_VIEWS.join(" | "), "events")
    .option("--project <slug>", "one project (default HUB_PROJECT, else all)")
    .option("--session <id>", "one session (a prefix is enough)")
    .option("--kind <kinds>", "comma-separated kinds")
    .option("--cli <cli>", "claude or codex")
    .option("--since <when>", "30m, 6h, 7d or a date (default 7d)")
    .option("--until <when>", "the same form")
    .option("--limit <n>", "events: last n (200; tail 20); summary: n sessions (10)")
    .option("--json", "one JSON object per line (summary and sessions: one array)")
    .option("--hook", "the session hook of `hub agent` (started by bin/hub.mjs without the CLI; never blocks)")
    .addHelpText("after", `\n${c.bold("Kinds")}\n${Object.entries(LOG_KIND_LABELS).map(([k, v]) => `  ${k.padEnd(12)}${v}`).join("\n")}\n\nFiles: state/log/<project>/<day>.jsonl (redacted; mail bodies hashed). Details: @docs/core/25-agent-log.md`)
    .action(async (view: string, o: Parameters<typeof runLogCommand>[1] & { hook?: boolean }) => {
      if (o.hook) { runLogHook(["--cli", o.cli ?? "claude"]); return; }
      ctxOf();
      done(await runLogCommand(view, o));
    });

  program.command("logs").description("The ops log (P86): what failed or happened in the server and every package (a messenger's disconnect, a Mail or Notion error, a refused or failed send, a migration, an unhandled error), one redacted line each. Not `hub log`, which is the agent session log. Default: every level and source, the last day. Read only.")
    .option("--level <level>", `the lowest level shown: ${OPS_LEVELS.join(", ")}`)
    .option("--source <sources>", `comma-separated: ${OPS_SOURCES.join(", ")}`)
    .option("--since <when>", "30m, 1h, 7d or a date (default 1d; the log keeps 7 days)")
    .option("--limit <n>", "the newest n lines (200)")
    .option("--json", "one JSON object per line, as the file keeps it")
    .option("--follow", "then print new lines until Ctrl-C")
    .addHelpText("after", "\nFiles: state/log/ops-<day>.jsonl (UTC days, 7 kept, 20 MB a day). Details: @docs/core/28-ops-log.md")
    .action(async (o: Parameters<typeof runLogsCommand>[0]) => {
      ctxOf();
      done(await runLogsCommand(o));
    });
}

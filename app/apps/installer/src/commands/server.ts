import { CORE_ROOT } from "@hub/config/paths";
import { runTests, runUp } from "../serve";
import { healthy, portBusy } from "../net";
import { autostartCommand, restartCommand, stopCommand } from "../autostart-command";
import { ctxOf, done } from "./shared";
import type { Command } from "commander";

/** P126 C1: the server commands: up, stop, restart, autostart, test. */
export function register(program: Command): void {
  program.command("up").description("Local admin (production build) + API on the LIVE database, 127.0.0.1 only; opens the browser. --demo: invented data on a separate demo database. When the instance's LaunchAgent (P67) runs the server, it opens that one instead of starting a second.")
    .option("--no-open", "do not open the browser")
    .option("--demo", "demo mode: a throw-away instance folder in the OS temp dir, seeded with invented clients (needs no HUB_HOME); the live data is not touched")
    .option("--foreground", "run the server in this terminal (Ctrl-C stops it) whatever the LaunchAgent holds")
    .option("--service", "what the LaunchAgent runs (HUB_AUTOSTART=1): no browser, exit 0 when switched off, when a hand-run holds the ports or after 5 failed starts in 15 minutes")
    .action(async (o: { open: boolean; demo?: boolean; foreground?: boolean; service?: boolean }) => {
      const service = !!o.service || process.env.HUB_AUTOSTART === "1";
      const ctx = o.demo ? undefined : ctxOf(); // the live admin needs an instance
      done(await runUp(CORE_ROOT, { open: o.open && !service, demo: o.demo, foreground: o.foreground, service, ...(ctx ? { ctx } : {}) }));
    });

  // P67 (decision 0033): the LaunchAgent that starts the server at login. macOS only.
  const commandDeps = () => ({ healthy, portBusy });
  program.command("stop").description("Stop the server the LaunchAgent started (launchctl kill SIGTERM; not respawned). A server started by hand stops with Ctrl-C in its terminal.")
    .action(async () => done(await stopCommand(ctxOf(), commandDeps())));
  program.command("restart").description("Restart the server through its LaunchAgent (launchctl kickstart -k) and wait until it answers; also clears the start guard after a fix.")
    .action(async () => done(await restartCommand(ctxOf(), commandDeps())));
  program.command("autostart").argument("[action]", "status (default) | on | off").description("Whether this Mac starts the Hub at login (P67). off: launchctl disable plus state/autostart/off, a running server keeps running; on: launchctl enable, and load the agent when it is not loaded. Setting it up is the installer's: ./run.sh install --only autostart.agent.")
    .action(async (action: string | undefined) => done(await autostartCommand(ctxOf(), action, commandDeps())));

  program.command("test").description("Typecheck, then tests, for the whole monorepo.")
    .action(async () => done(await runTests(CORE_ROOT)));
}

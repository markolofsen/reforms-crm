import type { Repos } from "@hub/db";
import type { HubPaths } from "@hub/config/paths";
import type { RuntimeModes } from "@hub/config/modes";
import type { ProjectStore } from "@hub/projects/store";
import { localOpenAvailable, localOpenDeps, openerFor } from "@hub/projects/local-open";
import { opsStoreOf } from "@hub/log/ops";
import { ops } from "@hub/log/ops";
import type { Runtime } from "../composition/runtime";
import type { MessengersStatus } from "../messengers/bot";
import { appleMailAccounts, createConnections, fakeMailAccounts, fakeProbeDeps } from "./connections";
import { createAutostart, launchctlFor } from "./autostart";
import { createCoreUpdates, execRun, offlineRun } from "./core-updates";
import { startAppsProbe } from "./apps-probe";

/**
 * The instance domain at start (P126 S1): Connections, "Start the Hub after a restart" (P67), the core update check (P68), the
 * local Open actions (P61) with the apps probe (P131 O2), and the ops log. A fake switch keeps each from reaching the Mac.
 */
export function start(o: { repos: Repos; paths: HubPaths; modes: RuntimeModes; projects: ProjectStore; fakeMail: boolean; bot: () => MessengersStatus }): { handles: Runtime["instance"]; stop(): void } {
  const log = ops("server");
  const { repos, paths, modes, projects } = o;
  // Connections: the real probes and Apple Mail's account list, or stubs with HUB_CONNECTIONS_PROBE=fake. Either fake (a demo or
  // e2e run) keeps the server from asking the owner's Mail which accounts it has.
  const probeFake = modes.probe === "fake";
  if (probeFake) log.info("CONNECTION TESTS ARE FAKE (HUB_CONNECTIONS_PROBE=fake): nothing is sent to Notion or Telegram, Mail is not asked");
  const listed = async () => (await repos.projects.registry()).projects.flatMap((p) => projects.find(p.slug)?.mail.accounts ?? []);
  const mailAccounts = probeFake || o.fakeMail ? fakeMailAccounts(listed) : appleMailAccounts();
  const connections = createConnections({ repos, store: projects, messengers: o.bot, mailAccounts, ...(probeFake ? { deps: fakeProbeDeps() } : {}) });
  // P67: HUB_LAUNCHCTL=fake records each launchctl argv and reaches no launchd.
  const launchctl = launchctlFor(modes.launchctl, process.env, paths);
  const startedBy = process.env.HUB_AUTOSTART === "1" ? ("launchd" as const) : ("hand" as const);
  const autostart = createAutostart({ paths, run: launchctl.run, agentsDir: launchctl.agentsDir, uid: process.getuid?.() ?? 501, startedBy, supported: launchctl.kind === "fake" || process.platform === "darwin", ...(launchctl.kind === "fake" ? { bootAt: async () => undefined, mailMcp: async () => true } : {}) });
  log.info(launchctl.kind === "fake" ? "LAUNCHCTL IS FAKE (HUB_LAUNCHCTL=fake): launchd is not asked, each argv goes to state/autostart/launchctl.jsonl" : `autostart: this server was started ${startedBy === "launchd" ? "by launchd at login" : "by hand"}`);
  // P68: under the fake Mailer (e2e, demos) no timer runs and "Check now" reaches no origin.
  const core = createCoreUpdates({ paths, run: o.fakeMail ? offlineRun() : execRun, auto: !o.fakeMail });
  core.start();
  log.info(o.fakeMail ? "core update check: off (HUB_MAILER=fake): Check now answers offline" : "core update check: 2 min after start, then every 6 h (the origin's tags)");
  // P61: HUB_OPENER=fake records each argv in state/opener.jsonl and opens nothing. P131 O2: the apps probe opens nothing.
  const opener = openerFor(modes.opener, paths);
  const appsProbe = startAppsProbe(opener.probe);
  const local = { deps: localOpenDeps(repos, paths), run: opener.run, available: localOpenAvailable(opener.kind), apps: appsProbe };
  log.info(opener.kind === "fake" ? "OPEN IS FAKE (HUB_OPENER=fake): nothing opens, each argv goes to state/opener.jsonl" : `open: ${local.available ? "on (/usr/bin/open, the admin page only)" : "off (not macOS): the Open buttons are hidden"}`);
  return {
    handles: { connections, local, autostart, core, opsLog: opsStoreOf(paths) },
    stop: () => {
      appsProbe.stop();
      core.stop();
    },
  };
}

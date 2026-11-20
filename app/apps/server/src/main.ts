import { serve } from "@hono/node-server";
import { HOST, SERVER_PORT } from "@hub/config";
import { HubHomeMissingError, hubPaths, instancePorts } from "@hub/config/paths";
import { bumpTopic, createRepos, dataVersion, openDb } from "@hub/db";
import { FakeDraftWriter, mailAppDraftWriter } from "@hub/agent/mail-drafts";
import { createApp } from "./app";
import { listenErrorLine, onShutdown } from "./lifecycle";
import { appleMailAccounts, chooseProbeKind, fakeMailAccounts, fakeProbeDeps } from "./connections";
import { configOf } from "./overview-facts";
import { projectsRoot } from "./project-overview";
import { allowListOf, configFile, createServerMailer } from "./send/mailer";
import { startMessengers } from "./messengers";
import { startTelegramUser } from "./telegram-user";
import { startPurge } from "./purge";
import { startSentReconciler } from "./sent";
import { chooseShell, createTerminal, serverDetector } from "./terminal";
import { chooseAgentTools, createAgentTools } from "./agent-tools";
import { logStoreOf } from "@hub/log/store";
import { createLive, folderSignature, logSignatures } from "./live";
import { createFocusStore } from "./focus";
import { chooseOpener, localOpenAvailable, localOpenDeps } from "@hub/projects/local-open";
import { throwawayDbNamed } from "@hub/send";
import { chooseLaunchctl, createAutostart } from "./autostart";
import { createCoreUpdates, execRun, offlineRun } from "./core-updates";

// The server is started by `hub up` (which sets HUB_HOME). Started by hand without it: one line and exit 2, not a stack.
try {
  hubPaths();
} catch (e) {
  if (!(e instanceof HubHomeMissingError)) throw e;
  console.error(`error: ${e.message}`);
  process.exit(2);
}

const { db, close } = openDb();
const repos = createRepos(db);
const port = Number(process.env.HUB_PORT ?? SERVER_PORT);

// P71 M2b: the messenger retention purge runs now and every hour, with or without a connected channel.
const purge = startPurge({ repos, log: (l) => console.log(l) });
// The messengers poller runs only when a bot token file exists; it only receives. Its state is part of /api/health.
const messengers = await startMessengers({ repos });
console.log(`messengers: ${messengers.status().state}${messengers.status().reason ? ` (${messengers.status().reason})` : ""}`);
// P71: the Telegram user accounts, one connection per session under state/secrets/sessions/. The line counts accounts, never names one.
const telegramUser = await startTelegramUser({ repos });
const tgStatus = telegramUser.status();
console.log(`telegram user accounts: ${tgStatus.state === "on" ? `${tgStatus.accounts.length} connected` : `off (${tgStatus.reason ?? ""})`}`);

// The Mailer behind Send: Mail.app, or the fake when HUB_MAILER=fake (refused without HUB_DB). A bad value stops the server here.
const projectsDir = projectsRoot();
const { kind, mailer } = createServerMailer(repos, projectsDir);
console.log(kind === "fake" ? "SEND IS FAKE (HUB_MAILER=fake): nothing leaves this process" : "send: Mail.app (a person confirms every send in the admin)");
// Sent detection reads Apple Mail's Sent mailbox while a draft waits (decision 0026); with the fake Mailer it never asks Mail.
const sent = startSentReconciler({ repos, ...(kind === "fake" ? { offReason: "HUB_MAILER=fake: Mail is not read" } : {}) });
console.log(`sent: ${sent.status().state}${sent.status().reason ? ` (${sent.status().reason})` : ""}`);
// Connections: the real probes and Apple Mail's account list, or stubs with HUB_CONNECTIONS_PROBE=fake (refused without HUB_DB).
const probe = chooseProbeKind(process.env);
if (probe === "fake") console.log("CONNECTION TESTS ARE FAKE (HUB_CONNECTIONS_PROBE=fake): nothing is sent to Notion or Telegram, Mail is not asked");
// Either fake (a demo or e2e run) keeps the server from asking the owner's Mail which accounts it has.
const listed = async () => (await repos.projects.registry()).projects.flatMap((p) => configOf(p).mail.accounts);
const mailAccounts = probe === "fake" || kind === "fake" ? fakeMailAccounts(listed) : appleMailAccounts();
const connections = probe === "fake" ? { deps: fakeProbeDeps(), mailAccounts } : { mailAccounts };
// The embedded terminal (P49): always on (decision 0032); a bad HUB_TERMINAL_SHELL stops the server here.
const paths = hubPaths();
const ports = instancePorts(paths);
const fakeShell = chooseShell(process.env) === "fake";
const fakeTools = chooseAgentTools(process.env) === "fake";
// P57: one detector of Claude Code and Codex (the owner's login shell), shared by the terminal's pick and Agent tools.
const detector = serverDetector({ env: process.env, fake: fakeShell || fakeTools });
const terminal = createTerminal({ paths, repos, adminPort: ports.admin, apiPort: port, fakeShell, detector });
// P66: the readiness check runs now (it sets node-pty's helper bit), not on the first tab.
const terminalProblem = terminal.warm();
console.log(`terminal: ${terminalProblem ? `cannot start: ${terminalProblem.reason} (fix: ${terminalProblem.fix})` : fakeShell ? "on, FAKE SHELL (HUB_TERMINAL_SHELL=fake)" : "on (admin origin + ticket only)"}`);
const agentTools = createAgentTools({ paths, repos, fake: fakeTools, detector, onRefresh: () => void terminal.recheck() });
// P67: "Start the Hub after a restart". HUB_LAUNCHCTL=fake records each launchctl argv and reaches no launchd (refused without HUB_DB).
const launchctl = chooseLaunchctl(process.env, paths, throwawayDbNamed(process.env));
const startedBy = process.env.HUB_AUTOSTART === "1" ? ("launchd" as const) : ("hand" as const);
const autostart = createAutostart({ paths, run: launchctl.run, agentsDir: launchctl.agentsDir, uid: process.getuid?.() ?? 501, startedBy, supported: launchctl.kind === "fake" || process.platform === "darwin", ...(launchctl.kind === "fake" ? { bootAt: async () => undefined, mailMcp: async () => true } : {}) });
console.log(launchctl.kind === "fake" ? "LAUNCHCTL IS FAKE (HUB_LAUNCHCTL=fake): launchd is not asked, each argv goes to state/autostart/launchctl.jsonl" : `autostart: this server was started ${startedBy === "launchd" ? "by launchd at login" : "by hand"}`);
// P68: the core update check. Under the fake Mailer (e2e, demos) no timer runs and "Check now" reaches no origin.
const coreUpdates = createCoreUpdates({ paths, run: kind === "fake" ? offlineRun() : execRun, auto: kind !== "fake" });
coreUpdates.start();
console.log(kind === "fake" ? "core update check: off (HUB_MAILER=fake): Check now answers offline" : "core update check: 2 min after start, then every 6 h (the origin's tags)");
// Live panels (P50): the trigger counter tailed every 200 ms; the pollers' state and the Connections files are watched,
// since they are not rows (a timestamp of the last poll is left out: it moves on every poll and means nothing to a panel).
const pollers = () => [messengers.status(), sent.status(), ...telegramUser.status().accounts].map((s) => `${s.state}|${"reason" in s ? (s.reason ?? "") : ""}|${s.lastError ?? ""}`).join("\n");
// P59: the agent session log is watched per project (one stat per day file), so the feed follows a hook's line in under 1 s.
const live = createLive({ db, watch: [{ topic: "health", signature: pollers, everyMs: 1000 }, { topic: "connections", signature: () => folderSignature(paths.secrets), everyMs: 1000 }, { topic: "agent-log", signatures: () => logSignatures(paths.log), everyMs: 500 }, { topic: "autostart", signature: autostart.signature, everyMs: 1000 }, { topic: "core", signature: coreUpdates.signature, everyMs: 1000 }] });
// The shared focus (P51): the admin tab says what it shows; the agent reads it from state/focus.json.
const focus = createFocusStore({ file: paths.focus });
// P61: the local Open actions (Finder, a project file). HUB_OPENER=fake records each argv in state/opener.jsonl and opens nothing (refused without HUB_DB); a bad value stops the server here.
const opener = chooseOpener(process.env, paths, throwawayDbNamed(process.env));
const local = { deps: localOpenDeps(repos, paths), run: opener.run, available: localOpenAvailable(opener.kind) };
console.log(opener.kind === "fake" ? "OPEN IS FAKE (HUB_OPENER=fake): nothing opens, each argv goes to state/opener.jsonl" : `open: ${local.available ? "on (/usr/bin/open, the admin page only)" : "off (not macOS): the Open buttons are hidden"}`);
const app = createApp(repos, { live, focus, local, autostart, coreUpdates, agentLog: logStoreOf(paths), terminal, agentTools, adminPort: ports.admin, connections, messengers: messengers.status, telegramUser, sent: sent.status, dataVersion: () => dataVersion(db), sender: { kind, mailer, projectsDir, policyDir: paths.stateProjects, allowList: allowListOf(configFile()), adminPort: ports.admin, writer: kind === "fake" ? new FakeDraftWriter() : mailAppDraftWriter(), mailWritten: (project) => void bumpTopic(db, "mail", project) } });

const server = serve({ fetch: app.fetch, hostname: HOST, port }, (info) => {
  console.log(`hub server on http://${info.address}:${info.port}`);
});
server.on("upgrade", terminal.upgrade);
// A taken port is one line and exit 2 (the same shape as a missing HUB_HOME above), not a stack.
server.on("error", (err) => {
  const line = listenErrorLine(err, HOST, port);
  if (!line) throw err;
  console.error(line);
  process.exit(2);
});

// A stuck poller must not make SIGTERM hang: 5 s, then the process exits anyway.
onShutdown({
  deadlineMs: 5000,
  log: (l) => console.error(l),
  exit: (code) => process.exit(code),
  stop: async () => {
    live.stop();
    purge.stop();
    coreUpdates.stop();
    sent.stop();
    terminal.stop();
    try { await Promise.all([messengers.stop(), telegramUser.stop()]); } finally { server.close(); close(); }
  },
});

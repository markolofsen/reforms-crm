import { serve } from "@hono/node-server";
import { HOST, SERVER_PORT } from "@hub/config";
import { HubHomeMissingError, hubPaths, instancePorts } from "@hub/config/paths";
import { createRepos, dataVersion, openDb } from "@hub/db";
import { createApp } from "./app";
import { listenErrorLine, onShutdown } from "./lifecycle";
import { appleMailAccounts, chooseProbeKind, fakeMailAccounts, fakeProbeDeps } from "./connections";
import { configOf } from "./overview-facts";
import { projectsRoot } from "./project-overview";
import { allowListOf, configFile, createServerMailer } from "./send/mailer";
import { startMessengers } from "./messengers";
import { startSentReconciler } from "./sent";
import { chooseShell, createTerminal } from "./terminal";
import { chooseAgentTools, createAgentTools } from "./agent-tools";
import { createLive, folderSignature } from "./live";

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

// The messengers poller runs only when a bot token file exists; it only receives. Its state is part of /api/health.
const messengers = await startMessengers({ repos });
console.log(`messengers: ${messengers.status().state}${messengers.status().reason ? ` (${messengers.status().reason})` : ""}`);

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
// The embedded terminal (P49): off unless config/config.json says terminal.enabled true; a bad HUB_TERMINAL_SHELL stops the server here.
const paths = hubPaths();
const ports = instancePorts(paths);
const fakeShell = chooseShell(process.env) === "fake";
const terminal = createTerminal({ paths, repos, adminPort: ports.admin, apiPort: port, fakeShell });
console.log(`terminal: ${terminal.enabled() ? (fakeShell ? "on, FAKE SHELL (HUB_TERMINAL_SHELL=fake)" : "on (admin origin + ticket only)") : "off (terminal.enabled in config/config.json)"}`);
const agentTools = createAgentTools({ paths, repos, fake: chooseAgentTools(process.env) === "fake" });
// Live panels (P50): the trigger counter tailed every 200 ms; the pollers' state and the Connections files are watched,
// since they are not rows (a timestamp of the last poll is left out: it moves on every poll and means nothing to a panel).
const pollers = () => [messengers.status(), sent.status()].map((s) => `${s.state}|${s.reason ?? ""}|${s.lastError ?? ""}`).join("\n");
const live = createLive({ db, watch: [{ topic: "health", signature: pollers, everyMs: 1000 }, { topic: "connections", signature: () => folderSignature(paths.secrets), everyMs: 1000 }] });
const app = createApp(repos, { live, terminal, agentTools, adminPort: ports.admin, connections, messengers: messengers.status, sent: sent.status, dataVersion: () => dataVersion(db), sender: { kind, mailer, projectsDir, policyDir: paths.stateProjects, allowList: allowListOf(configFile()), adminPort: ports.admin } });

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
    sent.stop();
    terminal.stop();
    try { await messengers.stop(); } finally { server.close(); close(); }
  },
});

import { serve } from "@hono/node-server";
import { HOST, SERVER_PORT } from "@hub/config";
import { HubHomeMissingError, hubPaths } from "@hub/config/paths";
import { createRepos, dataVersion, openDb } from "@hub/db";
import { createApp } from "./app";
import { listenErrorLine, onShutdown } from "./lifecycle";
import { appleMailAccounts, chooseProbeKind, fakeMailAccounts, fakeProbeDeps } from "./connections";
import { configOf } from "./overview-facts";
import { projectsRoot } from "./project-overview";
import { allowListOf, configFile, createServerMailer } from "./send/mailer";
import { startMessengers } from "./messengers";
import { startSentReconciler } from "./sent";

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
const app = createApp(repos, { connections, messengers: messengers.status, sent: sent.status, dataVersion: () => dataVersion(db), sender: { kind, mailer, projectsDir, allowList: allowListOf(configFile()) } });

const server = serve({ fetch: app.fetch, hostname: HOST, port }, (info) => {
  console.log(`hub server on http://${info.address}:${info.port}`);
});
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
    sent.stop();
    try { await messengers.stop(); } finally { server.close(); close(); }
  },
});

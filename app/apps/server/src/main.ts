import { serve } from "@hono/node-server";
import { HOST, SERVER_PORT } from "@hub/config";
import { HubHomeMissingError, hubPaths } from "@hub/config/paths";
import { createRepos, dataVersion, openDb } from "@hub/db";
import { createApp } from "./app";
import { chooseProbeKind, fakeProbeDeps } from "./connections";
import { createMailService } from "./mail";
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

// Mail is read only: the history reader and the Sent reconciler share one set of login files and are off without them.
const mail = createMailService({ repos });
const sent = startSentReconciler({ repos, mail });
console.log(`mail: ${mail.status().state}${mail.status().reason ? ` (${mail.status().reason})` : ""}`);
// The Mailer behind Send: Mail.app, or the fake when HUB_MAILER=fake (refused without HUB_DB). A bad value stops the server here.
const projectsDir = projectsRoot();
const { kind, mailer } = createServerMailer(repos, projectsDir);
console.log(kind === "fake" ? "SEND IS FAKE (HUB_MAILER=fake): nothing leaves this process" : "send: Mail.app (a person confirms every send in the admin)");
// Connections: the real probes, or stubs with HUB_CONNECTIONS_PROBE=fake (refused without HUB_DB). A bad value stops the server here.
const probe = chooseProbeKind(process.env);
if (probe === "fake") console.log("CONNECTION TESTS ARE FAKE (HUB_CONNECTIONS_PROBE=fake): nothing is sent to Notion, Telegram or a mail host");
const app = createApp(repos, { connections: probe === "fake" ? { deps: fakeProbeDeps() } : {}, messengers: messengers.status, sent: sent.status, mail, dataVersion: () => dataVersion(db), sender: { kind, mailer, projectsDir, allowList: allowListOf(configFile()) } });

const server = serve({ fetch: app.fetch, hostname: HOST, port }, (info) => {
  console.log(`hub server on http://${info.address}:${info.port}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    sent.stop();
    void messengers.stop().finally(() => {
      server.close();
      close();
      process.exit(0);
    });
  });
}

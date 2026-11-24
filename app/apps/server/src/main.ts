import { serve } from "@hono/node-server";
import { HOST, SERVER_PORT } from "@hub/config";
import { HubHomeMissingError, hubPaths, instanceLogRetention } from "@hub/config/paths";
import { modesLine, runtimeModes } from "@hub/config/modes";
import { openDb } from "@hub/db";
import { errFields, ops } from "@hub/log/ops";
import { scheduleRetention } from "@hub/log/retention";
import { createApp } from "./app";
import { startRuntime } from "./composition/start";
import { holdIdleSockets, listenErrorLine, onShutdown } from "./composition/lifecycle";

// P86: every line of this process goes to the ops log and a human copy to stderr. An error nothing caught is a line with its stack:
// a rejection is logged and the server keeps running; an uncaught exception is logged, then exit 1 and launchd starts it again.
const log = ops("server");
process.on("unhandledRejection", (reason) => log.error("unhandled promise rejection", errFields(reason, true)));
process.on("uncaughtException", (err) => {
  log.error("uncaught exception: the server exits", errFields(err, true));
  process.exit(1);
});
const fatal = (line: string): never => {
  log.error(line);
  process.exit(2);
};

// Started by hand without HUB_HOME (`hub up` sets it): one line and exit 2, not a stack. P126 K1: every switch is read once here;
// a bad value stops the server before anything starts, and one line names every fake and every off switch.
const paths = (() => {
  try {
    return hubPaths();
  } catch (e) {
    if (e instanceof HubHomeMissingError) return fatal(e.message);
    throw e;
  }
})();
const modes = (() => {
  try {
    return runtimeModes(process.env);
  } catch (e) {
    return fatal((e as Error).message);
  }
})();
const modeLine = modesLine(modes);
if (modeLine) log.info(`switches: ${modeLine}`);

// P137 L4: both logs keep 30 days, gzipped after 2; applied now and every night (the timer never holds the process).
scheduleRetention(paths.opsLog, { sessionKeepDays: instanceLogRetention(paths) });

// The server is the one process that migrates an existing database (`OpenDbOptions.migrate`).
const { db, close } = openDb(undefined, { migrate: true });
const port = Number(process.env.HUB_PORT ?? SERVER_PORT);
const started = await startRuntime({ db, modes, paths, apiPort: port });
const server = serve({ fetch: createApp(started.runtime).fetch, hostname: HOST, port }, (info) => log.info(`hub server on http://${info.address}:${info.port}`, { pid: process.pid }));
// The `/api` proxy reuses idle sockets; the server must not close them first (ECONNRESET, a 500 on the page).
if ("keepAliveTimeout" in server) holdIdleSockets(server);
server.on("upgrade", started.upgrade);
// A taken port is one line and exit 2, not a stack.
server.on("error", (err) => fatal(listenErrorLine(err, HOST, port) ?? (() => { throw err; })()));
// A stuck poller must not make SIGTERM hang: 5 s, then the process exits anyway.
onShutdown({ deadlineMs: 5000, log: (l) => log.warn(l), exit: (code) => process.exit(code), stop: async () => { try { await started.stop(); } finally { server.close(); close(); } } });

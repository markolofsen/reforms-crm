import { serve } from "@hono/node-server";
import { HOST, SERVER_PORT } from "@hub/config";
import { HubHomeMissingError, hubPaths, instancePorts } from "@hub/config/paths";
import { bumpTopic, createRepos, dataVersion, openDb } from "@hub/db";
import { FakeDraftWriter, mailAppDraftWriter } from "@hub/agent/mail-drafts";
import { createApp } from "./app";
import { holdIdleSockets, listenErrorLine, onShutdown } from "./lifecycle";
import { appleMailAccounts, chooseProbeKind, fakeMailAccounts, fakeProbeDeps } from "./connections";
import { configOf } from "./overview-facts";
import { projectsRoot } from "./project-overview";
import { allowListOf, configFile, createServerMailer } from "./send/mailer";
import { startMessengers } from "./messengers";
import { startTelegramUser } from "./telegram-user";
import { startWhatsApp, type WhatsAppHandle } from "./whatsapp";
import type { TelegramUserHandle } from "./telegram-user";
import { startProjectAutolink } from "./autolink-setup";
import { startPurge } from "./purge";
import { createPreanalysis } from "./preanalysis";
import { createLlm } from "@hub/llm";
import { startSentReconciler } from "./sent";
import { startInboundReader } from "./inbound";
import { convertSentLead, startLeadsReader } from "./leads-reader";
import { mailRunning, readMessageText } from "./apple-mail";
import { defaultOsa, MAIL_READ_TIMEOUT_MS, osaWithin } from "@hub/send";
import { bodyCache, readHistory } from "./conversation";
import type { ConversationMail } from "./composition/capabilities";
import { stampSentMail, teamStampOf } from "@hub/notion/stamp";
import type { SentNotice } from "@hub/send";
import { chooseShell, createTerminal, serverDetector } from "./terminal";
import { chooseAgentTools, createAgentTools } from "./agent-tools";
import { logStoreOf } from "@hub/log/store";
import { createLive, folderSignature, logSignatures } from "./live";
import { createFocusStore } from "./focus";
import { chooseOpener, localOpenAvailable, localOpenDeps } from "@hub/projects/local-open";
import { throwawayDbNamed } from "@hub/send";
import { chooseLaunchctl, createAutostart } from "./autostart";
import { createCoreUpdates, execRun, offlineRun } from "./core-updates";
import { errFields, ops, opsSignature, opsStoreOf } from "@hub/log/ops";

// P86: every line of this process goes to the ops log (`<state>/log/ops-<day>.jsonl`) and a human copy to stderr.
const log = ops("server");
// An error nothing caught is a line with its stack, never a silent death: a rejection is logged and the server keeps running
// (each caller owns its failure); an uncaught exception is logged, then the process exits 1 and launchd starts it again.
process.on("unhandledRejection", (reason) => log.error("unhandled promise rejection", errFields(reason, true)));
process.on("uncaughtException", (err) => {
  log.error("uncaught exception: the server exits", errFields(err, true));
  process.exit(1);
});

// The server is started by `hub up` (which sets HUB_HOME). Started by hand without it: one line and exit 2, not a stack.
try {
  hubPaths();
} catch (e) {
  if (!(e instanceof HubHomeMissingError)) throw e;
  log.error(e.message);
  process.exit(2);
}

const { db, close } = openDb();
const repos = createRepos(db);
const port = Number(process.env.HUB_PORT ?? SERVER_PORT);

// P71 M2b: the messenger retention purge runs now and every hour, with or without a connected channel.
const purge = startPurge({ repos });
// P71 M-P: the pre-analysis of linked chats whose switch is on, through `@hub/llm` (the ledger is `llm_calls`). A pass runs only
// after a poll stored messages or on the owner's click; with no OpenRouter key (and not HUB_LLM=fake) it asks nothing.
const llm = createLlm({ ledger: repos.llmCalls });
const preanalysis = createPreanalysis({ repos, llm });
log.info(`pre-analysis: ${preanalysis.standing().state === "no_key" ? "off (no OpenRouter key)" : llm.transport === "fake" ? "on, FAKE MODEL (HUB_LLM=fake): nothing leaves this process" : "ready (only chats whose switch is on)"}`);
const onStored = (project: string) => { preanalysis.after(project); };
// The messengers poller runs only when a bot token file exists; it only receives. Its state is part of /api/health.
const messengers = await startMessengers({ repos, onStored });
log.info(`messengers: ${messengers.status().state}${messengers.status().reason ? ` (${messengers.status().reason})` : ""}`);
// P84: the autolink of chats to client records (the Notion clients read into memory, `messengers.autolink` read from project.md). The
// adapters tell it only who an unlinked chat is (never a text); the handles are bound once they exist.
const handles: { tg?: TelegramUserHandle; wa?: WhatsAppHandle } = {};
const linker = await startProjectAutolink({
  repos,
  adapterOf: (channel, account) => (channel === "telegram_user" ? handles.tg?.adapter(account) : handles.wa?.adapter(account)),
  accounts: () => [
    ...(handles.tg?.status().accounts.filter((a) => a.state === "running").map((a) => ({ channel: "telegram_user" as const, account: a.account })) ?? []),
    ...(handles.wa?.status().accounts.filter((a) => a.state === "running").map((a) => ({ channel: "whatsapp" as const, account: a.account })) ?? []),
  ],
});
// P71: the Telegram user accounts, one connection per session under state/secrets/sessions/. The line counts accounts, never names one.
const telegramUser = await startTelegramUser({
  repos,
  onStored,
  onUnlinked: (account, d, inbound) => linker.autolink.seen("telegram_user", account, d, inbound),
  onConnected: (account) => void linker.autolink.scan("telegram_user", account).catch((e: unknown) => ops("autolink").warn("the scan of a connected Telegram account failed", { account, ...errFields(e) })),
});
handles.tg = telegramUser;
const tgStatus = telegramUser.status();
log.info(`telegram user accounts: ${tgStatus.state === "on" ? `${tgStatus.accounts.length} connected` : `off (${tgStatus.reason ?? ""})`}`);
// P71 M5: the WhatsApp linked devices, one socket per folder under state/secrets/sessions/. The line counts numbers, never names one.
const whatsapp = await startWhatsApp({ repos, onStored, onUnlinked: (account, d, inbound) => linker.autolink.seen("whatsapp", account, d, inbound) });
handles.wa = whatsapp;
const waStatus = whatsapp.status();
log.info(`whatsapp linked devices: ${waStatus.state === "on" ? `${waStatus.accounts.length} connected` : `off (${waStatus.reason ?? ""})`}`);

// The Mailer behind Send: Mail.app, or the fake when HUB_MAILER=fake (refused without HUB_DB). A bad value stops the server here.
const projectsDir = projectsRoot();
const { kind, mailer } = createServerMailer(repos, projectsDir);
log.info(kind === "fake" ? "SEND IS FAKE (HUB_MAILER=fake): nothing leaves this process" : "send: Mail.app (a person confirms every send in the admin)");
// P89: after a confirmed send (the send door or Sent detection) the client's Notion page gets Last sent at / Last sent by. In the
// background: a send never waits for Notion, and a failure is one ops-log line. Off with the fake Mailer (nothing was really sent).
// P97 S4 (decision 0044 point 3): first the lead's Clients card and In progress (when the address is a stored lead), then the stamp,
// so the stamp finds the card. Each never throws and never touches the send.
const onSent = kind === "fake" ? undefined : (n: SentNotice) => {
  void (async () => {
    await convertSentLead({ repos, projectsDir }, n);
    await stampSentMail({ projectsDir, secretsDir: paths.secrets, stateDir: paths.state }, n);
  })();
};
// Sent detection reads Apple Mail's Sent mailbox while a draft waits (decision 0026); with the fake Mailer it never asks Mail.
// P90: each pass also reads the clients' Notion Last sent stamps written by other people (the open card's teammate line).
const teamStamp = kind === "fake" ? undefined : (project: string, email: string) => teamStampOf({ projectsDir, secretsDir: paths.secrets, stateDir: paths.state }, project, email);
const sent = startSentReconciler({ repos, ...(onSent ? { onSent } : {}), ...(teamStamp ? { teamStamp } : {}), ...(kind === "fake" ? { offReason: "HUB_MAILER=fake: Mail is not read" } : {}) });
log.info(`sent: ${sent.status().state}${sent.status().reason ? ` (${sent.status().reason})` : ""}`);
// P96: the Mail reader reads the projects' inbound mailboxes read-only (every 2 min while the admin is open or a session runs,
// else every 15); with the fake Mailer it never asks Mail. Its `busy` is bound below, once the live stream and the terminal exist.
// P97 S2: the Leads reader reads each active project's Notion Leads (the project's token) at start, every 15 minutes, and at once
// when the Mail reader sees a new lead notice. With the fake Mailer (demo, e2e) it reads nothing: the seeded rows show.
const leads = startLeadsReader({ repos, projectsDir, ...(kind === "fake" ? { offReason: "Demo mode: Notion Leads are not read" } : {}) });
const busy: { now: () => boolean } = { now: () => false };
const inbound = startInboundReader({
  onNotice: (project) => void leads.read(project),
  repos,
  projectsDir,
  policyDir: hubPaths().stateProjects,
  configFile: configFile(),
  busy: () => busy.now(),
  knownClient: (project, email) => linker.project === project && (linker.directory.current()?.all.some((e) => e.email?.trim().toLowerCase() === email) ?? false),
  ...(kind === "fake" ? { offReason: "Demo mode: Mail is not read" } : {}),
});
log.info(`mail reader: ${inbound.status().state}${inbound.status().reason ? ` (${inbound.status().reason})` : ""}`);
// The Inbox card's text, read from Mail when a row is opened (never launches Mail; the fake writer finds nothing).
const mailWriter = kind === "fake" ? new FakeDraftWriter() : mailAppDraftWriter();
const inboundText = async (account: string, messageId: string) => {
  if (kind === "fake") return { note: "Demo mode: Mail is not read, only the stored preview shows." };
  if (!(await mailRunning(defaultOsa).catch(() => false))) return { note: "Mail is not running: open Mail to read the whole message." };
  const found = await mailWriter.findInbound([account], messageId);
  return found ? { text: await mailWriter.readContent(found) } : { note: "This message is no longer in Mail (moved or deleted)." };
};
// P99: one person's history for the conversation pane, read from Mail on open (AppleScript, the spike's choice), and one body on
// demand, kept in this process's memory only (decision 0013). The fake Mailer reads nothing: the pane shows the Hub's own rows.
const bodies = bodyCache();
const conversationMail: ConversationMail =
  kind === "fake"
    ? { history: async () => ({ note: "Demo mode: Mail is not read, the Hub's own rows show." }), text: async () => ({ note: "Demo mode: Mail is not read, only the stored preview shows." }), headers: async () => ({ note: "Demo mode: Mail headers are not read." }) }
    : {
        history: async (q) => {
          const osa = osaWithin(MAIL_READ_TIMEOUT_MS);
          if (!(await mailRunning(osa).catch(() => false))) return { note: "Mail is not running: open Mail to see the whole conversation." };
          const t0 = Date.now();
          const messages = await readHistory(osa, q);
          return { messages, ms: Date.now() - t0 };
        },
        text: async (at) => {
          const key = "messageId" in at ? `${at.account}|${at.messageId}` : `${at.account}|${at.mailbox}|${at.mailId}`;
          const hit = bodies.get(key);
          if (hit !== null) return { text: hit };
          const read: { text: string } | { note: string } = "messageId" in at ? await inboundText(at.account, at.messageId) : await (async (): Promise<{ text: string } | { note: string }> => {
            const osa = osaWithin(MAIL_READ_TIMEOUT_MS);
            if (!(await mailRunning(osa).catch(() => false))) return { note: "Mail is not running: open Mail to read the whole message." };
            const text = await readMessageText(osa, at.account, at.mailbox, at.mailId);
            return text === null ? { note: "This message is no longer in Mail (moved or deleted)." } : { text };
          })();
          if ("text" in read) bodies.set(key, read.text);
          return read;
        },
        headers: async ({ account, messageId }) => {
          const osa = osaWithin(MAIL_READ_TIMEOUT_MS);
          if (!(await mailRunning(osa).catch(() => false))) return { note: "Mail is not running: open Mail to resolve the conversation's recipient." };
          const found = await mailWriter.findInbound([account], messageId);
          if (!found) return { note: "This message is no longer in Mail (moved or deleted)." };
          return { headers: await mailWriter.readHeaders(found), accountAddresses: found.accountAddresses ?? [account] };
        },
      };
// Connections: the real probes and Apple Mail's account list, or stubs with HUB_CONNECTIONS_PROBE=fake (refused without HUB_DB).
const probe = chooseProbeKind(process.env);
if (probe === "fake") log.info("CONNECTION TESTS ARE FAKE (HUB_CONNECTIONS_PROBE=fake): nothing is sent to Notion or Telegram, Mail is not asked");
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
(terminalProblem ? ops("terminal").error : log.info)(`terminal: ${terminalProblem ? `cannot start: ${terminalProblem.reason} (fix: ${terminalProblem.fix})` : fakeShell ? "on, FAKE SHELL (HUB_TERMINAL_SHELL=fake)" : "on (admin origin + ticket only)"}`);
const agentTools = createAgentTools({ paths, repos, fake: fakeTools, detector, onRefresh: () => void terminal.recheck() });
// P67: "Start the Hub after a restart". HUB_LAUNCHCTL=fake records each launchctl argv and reaches no launchd (refused without HUB_DB).
const launchctl = chooseLaunchctl(process.env, paths, throwawayDbNamed(process.env));
const startedBy = process.env.HUB_AUTOSTART === "1" ? ("launchd" as const) : ("hand" as const);
const autostart = createAutostart({ paths, run: launchctl.run, agentsDir: launchctl.agentsDir, uid: process.getuid?.() ?? 501, startedBy, supported: launchctl.kind === "fake" || process.platform === "darwin", ...(launchctl.kind === "fake" ? { bootAt: async () => undefined, mailMcp: async () => true } : {}) });
log.info(launchctl.kind === "fake" ? "LAUNCHCTL IS FAKE (HUB_LAUNCHCTL=fake): launchd is not asked, each argv goes to state/autostart/launchctl.jsonl" : `autostart: this server was started ${startedBy === "launchd" ? "by launchd at login" : "by hand"}`);
// P68: the core update check. Under the fake Mailer (e2e, demos) no timer runs and "Check now" reaches no origin.
const coreUpdates = createCoreUpdates({ paths, run: kind === "fake" ? offlineRun() : execRun, auto: kind !== "fake" });
coreUpdates.start();
log.info(kind === "fake" ? "core update check: off (HUB_MAILER=fake): Check now answers offline" : "core update check: 2 min after start, then every 6 h (the origin's tags)");
// Live panels (P50): the trigger counter tailed every 200 ms; the pollers' state and the Connections files are watched,
// since they are not rows (a timestamp of the last poll is left out: it moves on every poll and means nothing to a panel).
// P96: the Mail reader's line moves with each pass (its `lastRunAt` is in the signature on purpose: "Mail read 1 min ago" must follow).
const pollers = () => [messengers.status(), sent.status(), { state: inbound.status().state, reason: `${inbound.status().reason ?? ""}${inbound.status().reading ? " reading" : ""}${inbound.status().lastRunAt ?? ""}`, lastError: inbound.status().lastError }, ...telegramUser.status().accounts, ...whatsapp.status().accounts].map((s) => `${s.state}|${"reason" in s ? (s.reason ?? "") : ""}|${s.lastError ?? ""}`).join("\n");
// P59: the agent session log is watched per project (one stat per day file), so the feed follows a hook's line in under 1 s.
const live = createLive({ db, watch: [{ topic: "health", signature: pollers, everyMs: 1000 }, { topic: "connections", signature: () => folderSignature(paths.secrets), everyMs: 1000 }, { topic: "agent-log", signatures: () => logSignatures(paths.log), everyMs: 500 }, { topic: "autostart", signature: autostart.signature, everyMs: 1000 }, { topic: "core", signature: coreUpdates.signature, everyMs: 1000 }, { topic: "ops-log", signature: () => opsSignature(opsStoreOf(paths)), everyMs: 1000 }] });
busy.now = () => live.count() > 0 || terminal.state().sessions.length > 0;
// The shared focus (P51): the admin tab says what it shows; the agent reads it from state/focus.json.
const focus = createFocusStore({ file: paths.focus });
// P61: the local Open actions (Finder, a project file). HUB_OPENER=fake records each argv in state/opener.jsonl and opens nothing (refused without HUB_DB); a bad value stops the server here.
const opener = chooseOpener(process.env, paths, throwawayDbNamed(process.env));
const local = { deps: localOpenDeps(repos, paths), run: opener.run, available: localOpenAvailable(opener.kind) };
log.info(opener.kind === "fake" ? "OPEN IS FAKE (HUB_OPENER=fake): nothing opens, each argv goes to state/opener.jsonl" : `open: ${local.available ? "on (/usr/bin/open, the admin page only)" : "off (not macOS): the Open buttons are hidden"}`);
const app = createApp(repos, { live, focus, pointerFile: paths.pointer, local, autostart, coreUpdates, agentLog: logStoreOf(paths), opsLog: opsStoreOf(paths), terminal, agentTools, adminPort: ports.admin, connections, messengers: messengers.status, telegramUser, whatsapp, autolink: linker, preanalysis, reply: { llm }, sent: sent.status, inbound, leads, inboundText, conversationMail, dataVersion: () => dataVersion(db), sender: { kind, mailer, projectsDir, policyDir: paths.stateProjects, ...(onSent ? { onSent } : {}), allowList: allowListOf(configFile()), adminPort: ports.admin, writer: mailWriter, mailWritten: (project) => void bumpTopic(db, "mail", project) } });

const server = serve({ fetch: app.fetch, hostname: HOST, port }, (info) => {
  log.info(`hub server on http://${info.address}:${info.port}`, { pid: process.pid });
});
// The `/api` proxy reuses idle sockets; the server must not close them first (ECONNRESET, a 500 on the page).
if ("keepAliveTimeout" in server) holdIdleSockets(server);
server.on("upgrade", terminal.upgrade);
// A taken port is one line and exit 2 (the same shape as a missing HUB_HOME above), not a stack.
server.on("error", (err) => {
  const line = listenErrorLine(err, HOST, port);
  if (!line) throw err;
  log.error(line);
  process.exit(2);
});

// A stuck poller must not make SIGTERM hang: 5 s, then the process exits anyway.
onShutdown({
  deadlineMs: 5000,
  log: (l) => log.warn(l),
  exit: (code) => process.exit(code),
  stop: async () => {
    live.stop();
    purge.stop();
    linker.stop();
    coreUpdates.stop();
    sent.stop();
    inbound.stop();
    leads.stop();
    terminal.stop();
    try { await Promise.all([messengers.stop(), telegramUser.stop(), whatsapp.stop()]); } finally { server.close(); close(); }
  },
});

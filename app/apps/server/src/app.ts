import { Hono } from "hono";
import { ADMIN_PORT, ALLOWED_HOSTNAMES } from "@hub/config";
import { API_VERSION, healthDto } from "@hub/contract/health";
import { isBusy, type Repos } from "@hub/db";
import { HubError, STATUS_OF, type ErrorKind } from "@hub/config/errors";
import type { ApiErrorCode } from "@hub/contract/errors";
import { bulkRoutes } from "./routes/bulk";
import { connectionRoutes } from "./routes/connections";
import { draftRoutes } from "./routes/drafts";
import { draftMailRoutes } from "./routes/draft-mail";
import { inboxRoutes } from "./routes/inbox";
import { inboundRoutes } from "./routes/inbound";
import { conversationRoutes } from "./routes/conversations";
import { INBOUND_OFF, type InboundHandle } from "./inbound";
import type { LeadsHandle } from "./leads-reader";
import { coreRoutes, instanceRoutes } from "./routes/instance";
import type { CoreUpdatesService } from "./core-updates";
import { overviewRoutes } from "./routes/overview";
import { projectRoutes } from "./routes/project";
import { projectCatalogRoutes } from "./routes/projects";
import { healthRoutes } from "./routes/health";
import { sendRoutes, type SenderOptions } from "./routes/sends";
import type { MessengerSenders } from "./send/messenger-door";
import { sequenceRoutes } from "./routes/sequences";
import { terminalRoutes } from "./routes/terminal";
import { liveRoutes } from "./routes/live";
import { focusRoutes } from "./routes/focus";
import { pointerRoutes } from "./routes/pointer";
import { agentFeedRoutes } from "./routes/agent-feed";
import { knowledgeRoutes } from "./routes/knowledge";
import { localRoutes } from "./routes/local";
import { NO_APPS } from "@hub/contract/local";
import { autostartRoutes } from "./routes/autostart";
import type { AutostartService } from "./autostart";
import type { LogStore } from "@hub/log/store";
import type { FocusStore } from "./focus";
import type { LiveService } from "./live";
import type { TerminalService } from "./terminal";
import { agentToolRoutes, type AgentToolsService } from "./agent-tools";
import { createConnections, type ConnectionsOptions } from "./connections";
import { OFF, type MessengersStatus } from "./messengers";
import { TELEGRAM_USER_OFF, type TelegramUserHandle } from "./telegram-user";
import { messengerRoutes } from "./routes/messengers";
import type { Preanalysis } from "./preanalysis";
import type { Llm } from "@hub/llm";
import { telegramUserRoutes } from "./routes/telegram-user";
import { whatsappRoutes } from "./routes/whatsapp";
import { autolinkRoutes } from "./routes/autolink";
import type { ProjectAutolink } from "./autolink-setup";
import { WHATSAPP_OFF, type WhatsAppHandle } from "./whatsapp";
import { SENT_OFF, type SentStatus } from "./sent";
import { createOverview, type OverviewService } from "./overview";
import { STUCK_MINUTES } from "./overview-facts";
import { projectOverview, projectsRoot } from "./project-overview";
import { projectDoctor } from "./project-doctor";
import { projectLinksRoutes } from "./routes/project-links";
import type { NotionReader } from "@hub/notion";
import { schemeRoutes } from "./routes/scheme";
import type { SchemeSources } from "./scheme";
import { instanceLlm } from "@hub/config/llm";
import { hubPaths } from "@hub/config/paths";
import { capSentence, hasKey, llmFake, noKeySentence } from "@hub/llm";
import { errFields, ops, type OpsStore } from "@hub/log/ops";
import { opsLogRoutes } from "./routes/ops-log";
import { agentFeedServicesOf, agentServicesOf, autolinkServicesOf, autostartServicesOf, bulkServicesOf, connectionsServicesOf, conversationServicesOf, coreServicesOf, focusServicesOf, healthServicesOf, inboxServicesOf, inboundServicesOf, instanceServicesOf, knowledgeServicesOf, liveServicesOf, localServicesOf, mailServicesOf, messengerServicesOf, opsLogServicesOf, overviewServicesOf, pointerServicesOf, projectCatalogServicesOf, projectLinksServicesOf, projectServicesOf, reviewServicesOf, schemeServicesOf, sendServicesOf, sequenceServicesOf, telegramUserServicesOf, terminalServicesOf, whatsappServicesOf, type ConversationMail, type InboundTextReader, type LocalService } from "./composition/capabilities";

/** The one send of each connected messenger account, handed to the send door and nothing else (P71 M4). */
const messengerSenders = (tg: TelegramUserHandle | undefined, wa: WhatsAppHandle | undefined): MessengerSenders | undefined =>
  tg || wa
    ? {
        sender: (channel, account) => (channel === "telegram_user" ? tg?.sender(account) : channel === "whatsapp" ? wa?.sender(account) : undefined),
        failed: (channel, account, err) => (channel === "telegram_user" ? tg?.sendFailed(account, err) : channel === "whatsapp" ? wa?.sendFailed(account, err) : undefined) ?? Promise.resolve(),
      }
    : undefined;

export type AppOptions = {
  messengers?: () => MessengersStatus;
  /** P71: the Telegram user accounts' supervisor (its state in health, the login, the picker, the link); without it those routes are 404. */
  telegramUser?: TelegramUserHandle;
  /** P71 M5: the WhatsApp linked devices' supervisor (health, the pairing, the picker, the link); without it those routes are 404. */
  whatsapp?: WhatsAppHandle;
  /** P84: the autolink of chats to client records (its state, preview, Link, Unlink and Never link routes). */
  autolink?: ProjectAutolink;
  /** P71 M-P: the pre-analysis job (its standing on the chats reply; a pass when the owner turns a chat's switch on). */
  preanalysis?: Preanalysis;
  /** P106: the typed Hub-LLM draft preparation door; it only creates an unsent messenger draft. */
  reply?: { llm: Llm };
  sent?: () => SentStatus;
  /** P96: the Mail reader (its state in health, the Inbox routes, Check now); without it the Inbox is empty and Check now reads nothing. */
  inbound?: InboundHandle;
  /** P97 S2: the Leads reader (Notion Leads into the Inbox's Leads group), its card read and the Spam write. */
  leads?: LeadsHandle;
  /** P96: reads one message's text from Mail for the Inbox card; without it the card says Mail is not read here. */
  inboundText?: InboundTextReader;
  /** P99: one person's history and one body read from Mail for the conversation pane; without it the pane shows the Hub's own rows. */
  conversationMail?: ConversationMail;
  /** Tests: the Overview with its own project folder and zone. */
  overview?: { projectsDir?: string; service?: OverviewService; timeZone?: string };
  /** Tests: the instance's config folder (brand); default `hubPaths()`. */
  instance?: { configFile: string; configDir: string };
  /** Tests and e2e: the Connections service with its own folder, fake probes and clock. */
  connections?: Partial<Omit<ConnectionsOptions, "repos">> & { service?: ReturnType<typeof createConnections> };
  /** The Mailer behind the Send button. Without it the send routes answer "not set up" and nothing can send. */
  sender?: SenderOptions & { kind: "mail-app" | "fake" };
  /** SQLite `data_version` of the server's connection; changes when another process commits (see `dataVersion`). */
  dataVersion?: () => number;
  /** The embedded terminal (P49, always on: decision 0032). The server always passes it; a test without it gets 404 on its routes. */
  terminal?: TerminalService;
  /** The admin's port, for the exact-origin doors (the terminal ticket). Default 5173. */
  adminPort?: number;
  /** Connections' Agent tools block (P49 5B); without it its routes are 404. */
  agentTools?: AgentToolsService;
  /** Live panels (P50): the stream behind `GET /api/live`; without it the route is 404 and the admin keeps polling the pulse. */
  live?: LiveService;
  /** The shared focus (P51): `POST /api/focus` keeps the admin's last focus for `hub focus` and `hub mcp`; without it the route is 404. */
  focus?: FocusStore;
  /** The agent's pointer (P72): `state/pointer.json`, read by `GET /api/pointer`; without it the route answers no pointer. */
  pointerFile?: string;
  /** The agent session log (P54) the activity feed reads (P59); without it `GET /api/projects/:slug/agent-feed` is 404. */
  agentLog?: LogStore;
  /** P86: the ops log, for Overview's Recent errors (`GET /api/ops/errors`); absent, the route answers an empty list. */
  opsLog?: OpsStore;
  /** The local Open actions (P61): `POST /api/local/:action` and `localOpen` on the instance; without it the route is 404 and `localOpen` false. */
  local?: LocalService;
  /** P67: "Start the Hub after a restart" (`/api/instance/autostart`); without it both routes are 404. */
  autostart?: AutostartService;
  /** P68: the core update check (`/api/instance/core`); without it both routes are 404. */
  coreUpdates?: CoreUpdatesService;
  /** Tests: the readers of `GET /api/scheme` (P63); default: the server's own services, read without running a check. */
  scheme?: Partial<SchemeSources>;
  /** P101: optional injected read-only Notion reader for resolving declared Quick Links. */
  projectLinks?: { reader?: NotionReader };
  now?: () => Date;
};

/**
 * The whole API. Loopback only: the listener binds 127.0.0.1, and every request must
 * name a loopback host (DNS-rebinding guard) and, when it has one, a loopback Origin.
 * No CORS headers are set. Sending is the one confirmed route (`routes/sends.ts`, decision 0011): a person's dry run,
 * then a send that carries what they saw. The only status a client may write to a draft is one of SETTABLE_STATUSES
 * (which has no `sent`: Mail's Sent folder is the one source of that).
 * Every refusal is `{ error, code }` (`@hub/contract/errors`); a locked database is 503 `busy`.
 */
/** The wire code of a kind (`@hub/contract/errors`): the kind itself, except a failed upstream service, which the wire calls `server`. */
const wireCode = (kind: ErrorKind): ApiErrorCode => (kind === "upstream" ? "server" : kind);

export function createApp(repos: Repos, opts: AppOptions = {}) {
  const health = () =>
    healthDto.parse({
      ok: true,
      apiVersion: API_VERSION,
      messengers: (opts.messengers ?? (() => OFF))(),
      telegramUser: opts.telegramUser?.status() ?? TELEGRAM_USER_OFF,
      whatsapp: opts.whatsapp?.status() ?? WHATSAPP_OFF,
      sent: (opts.sent ?? (() => SENT_OFF))(),
      inbound: opts.inbound?.status() ?? INBOUND_OFF,
      mailer: opts.sender?.kind ?? "mail-app",
    });
  const now = opts.now ?? (() => new Date());
  const ov = opts.overview;
  const projectsDir = ov?.projectsDir ?? opts.sender?.projectsDir ?? projectsRoot();
  const overview =
    ov?.service ??
    createOverview({
      repos,
      projectsDir,
      ...(opts.sender?.policyDir ? { policyDir: opts.sender.policyDir } : {}),
      health,
      dataVersion: () => opts.dataVersion?.() ?? 0,
      now,
      ...(ov?.timeZone ? { timeZone: ov.timeZone } : {}),
    });
  const connections =
    opts.connections?.service ??
    createConnections({ messengers: opts.messengers ?? (() => OFF), now, ...opts.connections, repos });
  /** How long the Overview's parts wait for Mail's account list before saying "not checked here" (the read goes on and fills the cache). */
  const SCHEME_MAIL_MS = 400;
  const scheme: SchemeSources = {
    projects: async () => (await repos.projects.registry()).projects.filter((p) => !p.archived).map((p) => p.slug),
    doctor: (slug) => projectDoctor(repos, slug, projectsDir, process.env, opts.sender?.policyDir),
    files: (slug) => projectOverview(repos, slug, projectsDir),
    agentTools: (slug) => opts.agentTools?.peek(slug) ?? null,
    connections: () => connections.list({ mailWithinMs: SCHEME_MAIL_MS }),
    health,
    stopped: (slug) => repos.sends.isStopped(slug),
    sendTrouble: async (slug) => {
      const t = now().getTime();
      const day = new Date(t - 24 * 3_600_000).toISOString();
      const s = await repos.sends.summarySince(slug, { today: day, day, stuckBefore: new Date(t - STUCK_MINUTES * 60_000).toISOString() });
      return { failed: s.failed, stuck: s.stuck };
    },
    clis: () => opts.agentTools?.clis() ?? null,
    core: () => opts.coreUpdates?.read() ?? null,
    // P78: read per request (the key and config.json may change while the server runs); the key's value is dropped in hasKey.
    llm: async () => ({ month: await repos.llmCalls.month(now()), capMicroUsd: instanceLlm(hubPaths()).capMicroUsd, keyPresent: hasKey(), fake: llmFake(), noKeyFix: noKeySentence(), capFix: capSentence }),
    ...opts.scheme,
  };
  return new Hono()
    .onError((err, c) => {
      // P126 E1: every refusal the Hub states is a HubError; its kind gives the status (a failed upstream is the wire's `server`).
      if (err instanceof HubError) return c.json({ ...err.detail, error: err.message, code: wireCode(err.kind) }, STATUS_OF[err.kind]);
      if (isBusy(err)) return c.json({ error: "The database is busy with another write. Try again in a moment.", code: "busy" as const }, 503);
      ops("server").error(`500 ${c.req.method} ${c.req.path}`, errFields(err, true));
      return c.json({ error: "server error", code: "server" as const }, 500);
    })
    .use("*", async (c, next) => {
      const allowed = (v: string) => (ALLOWED_HOSTNAMES as readonly string[]).includes(v);
      const origin = c.req.header("origin");
      let originOk = true;
      if (origin) {
        try {
          originOk = allowed(new URL(origin).hostname);
        } catch {
          originOk = false;
        }
      }
      if (!allowed(new URL(c.req.url).hostname) || !originOk) return c.json({ error: "forbidden host", code: "forbidden" as const }, 403);
      await next();
    })
    .route("/", healthRoutes(healthServicesOf(health, () => opts.dataVersion?.() ?? 0, now)))
    .route("/", liveRoutes(liveServicesOf(opts.live)))
    .route("/", projectCatalogRoutes(projectCatalogServicesOf(repos)))
    .route("/", instanceRoutes(instanceServicesOf(opts.instance, () => opts.local?.available ?? false, opts.local?.apps ? () => opts.local?.apps?.status() ?? NO_APPS : undefined)))
    .route("/", coreRoutes(coreServicesOf(opts.coreUpdates)))
    .route("/", draftRoutes(reviewServicesOf(repos, opts.sender)))
    .route("/", sendRoutes(sendServicesOf(repos, opts.sender, messengerSenders(opts.telegramUser, opts.whatsapp))))
    .route("/", draftMailRoutes(mailServicesOf(repos, opts.sender)))
    .route("/", projectRoutes(projectServicesOf(repos, projectsDir, opts.sender?.policyDir)))
    .route("/", projectLinksRoutes(projectLinksServicesOf(repos, projectsDir, { ...(opts.projectLinks?.reader ? { reader: opts.projectLinks.reader } : {}) })))
    .route("/", inboxRoutes(inboxServicesOf(repos)))
    .route("/", inboundRoutes(inboundServicesOf(repos, opts.inbound, opts.inboundText, opts.leads)))
    .route("/", conversationRoutes(conversationServicesOf(repos, opts.conversationMail, opts.autolink ? { project: opts.autolink.project, directory: opts.autolink.directory, identityOf: opts.autolink.autolink.identityOf } : undefined)))
    .route("/", sequenceRoutes(sequenceServicesOf(repos, projectsDir, now)))
    .route("/", bulkRoutes(bulkServicesOf(repos)))
    .route("/", overviewRoutes(overviewServicesOf(overview)))
    .route("/", schemeRoutes(schemeServicesOf(scheme)))
    .route("/", connectionRoutes(connectionsServicesOf(connections)))
    .route("/", agentToolRoutes(agentServicesOf(repos, opts.agentTools)))
    .route("/", agentFeedRoutes(agentFeedServicesOf(repos, opts.agentLog, now)))
    .route("/", opsLogRoutes(opsLogServicesOf(opts.opsLog, now)))
    .route("/", knowledgeRoutes(knowledgeServicesOf(repos, now, opts.overview?.timeZone)))
    .route("/", terminalRoutes(terminalServicesOf(opts.terminal, opts.adminPort ?? opts.sender?.adminPort ?? ADMIN_PORT)))
    .route("/", focusRoutes(focusServicesOf(opts.focus, opts.adminPort ?? opts.sender?.adminPort ?? ADMIN_PORT)))
    .route("/", pointerRoutes(pointerServicesOf(repos, opts.pointerFile, now)))
    .route("/", localRoutes(localServicesOf(opts.local, opts.adminPort ?? opts.sender?.adminPort ?? ADMIN_PORT)))
    .route("/", autostartRoutes(autostartServicesOf(opts.autostart, opts.adminPort ?? opts.sender?.adminPort ?? ADMIN_PORT)))
    .route("/", telegramUserRoutes(telegramUserServicesOf(opts.telegramUser, opts.adminPort ?? opts.sender?.adminPort ?? ADMIN_PORT)))
    .route("/", whatsappRoutes(whatsappServicesOf(opts.whatsapp, opts.adminPort ?? opts.sender?.adminPort ?? ADMIN_PORT)))
    .route("/", autolinkRoutes(autolinkServicesOf(repos, opts.autolink, opts.adminPort ?? opts.sender?.adminPort ?? ADMIN_PORT, opts.sender?.agent?.token)))
    .route(
      "/",
      messengerRoutes(
        messengerServicesOf(repos, {
          adminPort: opts.adminPort ?? opts.sender?.adminPort ?? ADMIN_PORT,
          ...(opts.preanalysis ? { preanalysis: opts.preanalysis } : {}),
          ...(opts.reply ? { reply: { llm: opts.reply.llm, projectsDir, ...(opts.sender?.policyDir ? { policyDir: opts.sender.policyDir } : {}) } } : {}),
          ...(opts.autolink ? { directory: { project: opts.autolink.project, directory: opts.autolink.directory, identityOf: opts.autolink.autolink.identityOf } } : {}),
        }),
      ),
    );
}

export type AppType = ReturnType<typeof createApp>;

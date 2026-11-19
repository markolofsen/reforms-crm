import { Hono } from "hono";
import { ADMIN_PORT, ALLOWED_HOSTNAMES } from "@hub/config";
import { API_VERSION, healthDto, pulseDto } from "@hub/contract/health";
import { projectsDto } from "@hub/contract/responses";
import { isBusy, RepoError, type Repos } from "@hub/db";
import { bulkRoutes } from "./routes/bulk";
import { connectionRoutes } from "./routes/connections";
import { draftRoutes } from "./routes/drafts";
import { draftMailRoutes } from "./routes/draft-mail";
import { inboxRoutes } from "./routes/inbox";
import { coreRoutes, instanceRoutes } from "./routes/instance";
import type { CoreUpdatesService } from "./core-updates";
import { overviewRoutes } from "./routes/overview";
import { projectRoutes } from "./routes/project";
import { sendRoutes, type SenderOptions } from "./routes/sends";
import { sequenceRoutes } from "./routes/sequences";
import { terminalRoutes } from "./routes/terminal";
import { liveRoutes } from "./routes/live";
import { focusRoutes } from "./routes/focus";
import { agentFeedRoutes } from "./routes/agent-feed";
import { knowledgeRoutes } from "./routes/knowledge";
import { localRoutes, type LocalService } from "./routes/local";
import { autostartRoutes } from "./routes/autostart";
import type { AutostartService } from "./autostart";
import type { LogStore } from "@hub/log/store";
import type { FocusStore } from "./focus";
import type { LiveService } from "./live";
import type { TerminalService } from "./terminal";
import { agentToolRoutes, type AgentToolsService } from "./agent-tools";
import { createConnections, type ConnectionsOptions } from "./connections";
import { OFF, type MessengersStatus } from "./messengers";
import { SENT_OFF, type SentStatus } from "./sent";
import { createOverview, type OverviewService } from "./overview";
import { STUCK_MINUTES } from "./overview-facts";
import { projectOverview, projectsRoot } from "./project-overview";
import { projectDoctor } from "./project-doctor";
import { schemeRoutes } from "./routes/scheme";
import type { SchemeSources } from "./scheme";

export type AppOptions = {
  messengers?: () => MessengersStatus;
  sent?: () => SentStatus;
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
  /** The agent session log (P54) the activity feed reads (P59); without it `GET /api/projects/:slug/agent-feed` is 404. */
  agentLog?: LogStore;
  /** The local Open actions (P61): `POST /api/local/:action` and `localOpen` on the instance; without it the route is 404 and `localOpen` false. */
  local?: LocalService;
  /** P67: "Start the Hub after a restart" (`/api/instance/autostart`); without it both routes are 404. */
  autostart?: AutostartService;
  /** P68: the core update check (`/api/instance/core`); without it both routes are 404. */
  coreUpdates?: CoreUpdatesService;
  /** Tests: the readers of `GET /api/scheme` (P63); default: the server's own services, read without running a check. */
  scheme?: Partial<SchemeSources>;
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
export function createApp(repos: Repos, opts: AppOptions = {}) {
  const health = () =>
    healthDto.parse({
      ok: true,
      apiVersion: API_VERSION,
      messengers: (opts.messengers ?? (() => OFF))(),
      sent: (opts.sent ?? (() => SENT_OFF))(),
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
    ...opts.scheme,
  };
  return new Hono()
    .onError((err, c) => {
      if (err instanceof RepoError) return c.json({ error: err.message, code: err.code === "not_found" ? ("not_found" as const) : ("wrong_state" as const) }, err.code === "not_found" ? 404 : 409);
      if (isBusy(err)) return c.json({ error: "The database is busy with another write. Try again in a moment.", code: "busy" as const }, 503);
      console.error(`500 ${c.req.method} ${c.req.path}`, err);
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
    .get("/api/health", (c) => c.json(health()))
    .route("/", liveRoutes(opts.live))
    .get("/api/pulse", (c) => c.json(pulseDto.parse({ dataVersion: opts.dataVersion?.() ?? 0, serverTime: (opts.now?.() ?? new Date()).toISOString(), health: health() })))
    .get("/api/projects", async (c) => c.json(projectsDto.parse({ projects: await repos.projects.list() })))
    .route("/", instanceRoutes(opts.instance, () => opts.local?.available ?? false))
    .route("/", coreRoutes(opts.coreUpdates))
    .route("/", draftRoutes(repos, opts.sender))
    .route("/", sendRoutes(repos, opts.sender))
    .route("/", draftMailRoutes(repos, opts.sender))
    .route("/", projectRoutes(repos, projectsDir, opts.sender?.policyDir))
    .route("/", inboxRoutes(repos))
    .route("/", sequenceRoutes(repos, projectsDir, now))
    .route("/", bulkRoutes(repos))
    .route("/", overviewRoutes(overview))
    .route("/", schemeRoutes(scheme))
    .route("/", connectionRoutes(connections))
    .route("/", agentToolRoutes(repos, opts.agentTools))
    .route("/", agentFeedRoutes(repos, opts.agentLog, now))
    .route("/", knowledgeRoutes(repos, now, opts.overview?.timeZone))
    .route("/", terminalRoutes(opts.terminal, opts.adminPort ?? opts.sender?.adminPort ?? ADMIN_PORT))
    .route("/", focusRoutes(opts.focus, opts.adminPort ?? opts.sender?.adminPort ?? ADMIN_PORT))
    .route("/", localRoutes(opts.local, opts.adminPort ?? opts.sender?.adminPort ?? ADMIN_PORT))
    .route("/", autostartRoutes(opts.autostart, opts.adminPort ?? opts.sender?.adminPort ?? ADMIN_PORT));
}

export type AppType = ReturnType<typeof createApp>;

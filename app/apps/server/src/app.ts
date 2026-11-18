import { Hono } from "hono";
import { ALLOWED_HOSTNAMES } from "@hub/config";
import { API_VERSION, healthDto, pulseDto } from "@hub/contract/health";
import { projectsDto } from "@hub/contract/responses";
import { isBusy, RepoError, type Repos } from "@hub/db";
import { bulkRoutes } from "./routes/bulk";
import { connectionRoutes } from "./routes/connections";
import { draftRoutes } from "./routes/drafts";
import { inboxRoutes } from "./routes/inbox";
import { overviewRoutes } from "./routes/overview";
import { runRoutes } from "./routes/runs";
import { sendRoutes, type SenderOptions } from "./routes/sends";
import { sequenceRoutes } from "./routes/sequences";
import { createConnections, type ConnectionsOptions } from "./connections";
import { MAIL_OFF, type MailService } from "./mail";
import { OFF, type MessengersStatus } from "./messengers";
import { SENT_OFF, type SentStatus } from "./sent";
import { createOverview, type OverviewService } from "./overview";
import { createLiveReads, type LiveOptions } from "./overview-live";
import { projectsRoot } from "./project-overview";

export type AppOptions = {
  messengers?: () => MessengersStatus;
  sent?: () => SentStatus;
  mail?: Pick<MailService, "status" | "historyFor"> & Partial<Pick<MailService, "accountsFor" | "connect">>;
  /** Tests: the Overview with its own clock, readers and project folder. */
  overview?: Partial<Pick<LiveOptions, "notionReader" | "mailTimeoutMs" | "notionTimeoutMs" | "minIntervalMs" | "env">> & { projectsDir?: string; service?: OverviewService; timeZone?: string };
  /** Tests and e2e: the Connections service with its own folder, fake probes and clock. */
  connections?: Partial<Omit<ConnectionsOptions, "repos">> & { service?: ReturnType<typeof createConnections> };
  /** The Mailer behind the Send button. Without it the send routes answer "not set up" and nothing can send. */
  sender?: SenderOptions & { kind: "mail-app" | "fake" };
  /** SQLite `data_version` of the server's connection; changes when another process commits (see `dataVersion`). */
  dataVersion?: () => number;
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
      mail: opts.mail?.status() ?? MAIL_OFF,
      sent: (opts.sent ?? (() => SENT_OFF))(),
      mailer: opts.sender?.kind ?? "mail-app",
    });
  const now = opts.now ?? (() => new Date());
  const ov = opts.overview;
  const overview =
    ov?.service ??
    createOverview({
      repos,
      projectsDir: ov?.projectsDir ?? opts.sender?.projectsDir ?? projectsRoot(),
      live: createLiveReads({
        now,
        ...(opts.mail?.accountsFor ? { accountsFor: opts.mail.accountsFor } : {}),
        ...(opts.mail?.connect ? { connect: opts.mail.connect } : {}),
        ...(ov?.env ? { env: ov.env } : {}),
        ...(ov?.notionReader ? { notionReader: ov.notionReader } : {}),
        ...(ov?.mailTimeoutMs ? { mailTimeoutMs: ov.mailTimeoutMs } : {}),
        ...(ov?.notionTimeoutMs ? { notionTimeoutMs: ov.notionTimeoutMs } : {}),
        ...(ov?.minIntervalMs !== undefined ? { minIntervalMs: ov.minIntervalMs } : {}),
      }),
      health,
      dataVersion: () => opts.dataVersion?.() ?? 0,
      now,
      ...(ov?.timeZone ? { timeZone: ov.timeZone } : {}),
    });
  const connections =
    opts.connections?.service ??
    createConnections({ messengers: opts.messengers ?? (() => OFF), now, ...opts.connections, repos });
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
    .get("/api/pulse", (c) => c.json(pulseDto.parse({ dataVersion: opts.dataVersion?.() ?? 0, serverTime: (opts.now?.() ?? new Date()).toISOString(), health: health() })))
    .get("/api/projects", async (c) => c.json(projectsDto.parse({ projects: await repos.projects.list() })))
    .route("/", draftRoutes(repos, opts.mail, opts.sender))
    .route("/", sendRoutes(repos, opts.sender))
    .route("/", runRoutes(repos, opts.sender?.projectsDir))
    .route("/", inboxRoutes(repos))
    .route("/", sequenceRoutes(repos, ov?.projectsDir ?? opts.sender?.projectsDir ?? projectsRoot(), now))
    .route("/", bulkRoutes(repos))
    .route("/", overviewRoutes(overview))
    .route("/", connectionRoutes(connections));
}

export type AppType = ReturnType<typeof createApp>;

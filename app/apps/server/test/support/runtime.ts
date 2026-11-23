import { ADMIN_PORT } from "@hub/config";
import type { Repos } from "@hub/db";
import type { HubPaths } from "@hub/config/paths";
import type { Llm } from "@hub/llm";
import type { LogStore } from "@hub/log/store";
import type { OpsStore } from "@hub/log/ops";
import type { NotionReader } from "@hub/notion";
import { projectStore, type ProjectStore } from "@hub/projects/store";
import { createApp } from "../../src/app";
import type { Runtime, RuntimeSender } from "../../src/composition/runtime";
import { messengerSenders } from "../../src/send/messenger-senders";
import type { ConversationMail, InboundTextReader } from "../../src/mail/context";
import type { InboundHandle } from "../../src/mail/inbound";
import type { SentStatus } from "../../src/mail/sent";
import type { LeadsHandle } from "../../src/clients/leads-reader";
import { OFF, type MessengersStatus } from "../../src/messengers/bot";
import type { TelegramUserHandle } from "../../src/messengers/accounts/telegram-user";
import type { WhatsAppHandle } from "../../src/messengers/accounts/whatsapp";
import type { ProjectAutolink } from "../../src/messengers/autolink/setup";
import type { Preanalysis } from "../../src/messengers/preanalysis";
import type { AgentToolsService } from "../../src/agent/tools";
import type { FocusStore } from "../../src/agent/focus";
import { createConnections, type ConnectionsOptions } from "../../src/instance/connections";
import type { AutostartService } from "../../src/instance/autostart";
import type { CoreUpdatesService } from "../../src/instance/core-updates";
import type { LocalService } from "../../src/local/context";
import type { LiveService } from "../../src/live/live";
import type { TerminalService } from "../../src/terminal/terminal";
import type { OverviewService } from "../../src/overview/overview";
import type { SchemeSources } from "../../src/overview/scheme";
import { projectsRoot } from "../../src/projects/overview";

/** What a test changes in the runtime; everything else is the quiet default (nothing started, port 5173, the real clock). */
export type TestOverrides = {
  now?: () => Date;
  adminPort?: number;
  dataVersion?: () => number;
  projects?: ProjectStore;
  sender?: RuntimeSender;
  sent?: () => SentStatus;
  inbound?: InboundHandle;
  inboundText?: InboundTextReader;
  leads?: LeadsHandle;
  conversationMail?: ConversationMail;
  messengers?: () => MessengersStatus;
  telegramUser?: TelegramUserHandle;
  whatsapp?: WhatsAppHandle;
  autolink?: ProjectAutolink;
  preanalysis?: Preanalysis;
  reply?: { llm: Llm };
  agentTools?: AgentToolsService;
  focus?: FocusStore;
  pointerFile?: string;
  agentLog?: LogStore;
  /** The Connections service with its own folder, fake probes and clock, or a whole service. */
  connections?: Partial<Omit<ConnectionsOptions, "repos">> & { service?: ReturnType<typeof createConnections> };
  instance?: Pick<HubPaths, "configFile" | "configDir">;
  local?: LocalService;
  autostart?: AutostartService;
  coreUpdates?: CoreUpdatesService;
  opsLog?: OpsStore;
  live?: LiveService;
  terminal?: TerminalService;
  /** The Overview with its own project folder, service and zone. */
  overview?: { projectsDir?: string; service?: OverviewService; timeZone?: string };
  scheme?: Partial<SchemeSources>;
  projectLinks?: { reader?: NotionReader };
};

const some = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> => (value === undefined ? {} : ({ [key]: value } as Record<K, V>));

/** The runtime a test builds the app from (P126 S1): one place for the defaults the 37 `createApp(repos, {...})` calls repeated. */
export function testRuntime(repos: Repos, o: TestOverrides = {}): Runtime {
  const now = o.now ?? (() => new Date());
  const projectsDir = o.overview?.projectsDir ?? o.sender?.projectsDir ?? projectsRoot();
  const policyDir = o.sender?.policyDir;
  const projects = o.projects ?? projectStore({ projects: projectsDir, ...(policyDir ? { stateProjects: policyDir } : {}) });
  const { service, ...connectionOptions } = o.connections ?? {};
  const connections = service ?? createConnections({ messengers: o.messengers ?? (() => OFF), now, ...connectionOptions, repos, store: projects });
  const senders = messengerSenders(o.telegramUser, o.whatsapp);
  return {
    repos,
    now,
    adminPort: o.adminPort ?? o.sender?.adminPort ?? ADMIN_PORT,
    dataVersion: o.dataVersion ?? (() => 0),
    projectsDir,
    ...some("policyDir", policyDir),
    projects,
    ...some("timeZone", o.overview?.timeZone),
    mail: { ...some("sender", o.sender), ...some("sent", o.sent), ...some("inbound", o.inbound), ...some("inboundText", o.inboundText), ...some("leads", o.leads), ...some("conversation", o.conversationMail) },
    messengers: {
      ...some("bot", o.messengers),
      ...some("telegramUser", o.telegramUser),
      ...some("whatsapp", o.whatsapp),
      ...some("autolink", o.autolink),
      ...some("preanalysis", o.preanalysis),
      ...some("reply", o.reply),
      ...some("senders", senders),
    },
    agent: { ...some("tools", o.agentTools), ...some("focus", o.focus), ...some("pointerFile", o.pointerFile), ...some("log", o.agentLog) },
    instance: { connections, ...some("paths", o.instance), ...some("local", o.local), ...some("autostart", o.autostart), ...some("core", o.coreUpdates), ...some("opsLog", o.opsLog) },
    ...some("live", o.live),
    ...some("terminal", o.terminal),
    overview: { ...some("service", o.overview?.service), ...some("scheme", o.scheme) },
    ...some("projectLinks", o.projectLinks),
  };
}

/** `createApp(testRuntime(repos, overrides))`. */
export const testApp = (repos: Repos, o: TestOverrides = {}) => createApp(testRuntime(repos, o));

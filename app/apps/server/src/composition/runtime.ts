import type { Repos } from "@hub/db";
import type { ProjectStore } from "@hub/projects/store";
import type { HubPaths } from "@hub/config/paths";
import type { Llm } from "@hub/llm";
import type { LogStore } from "@hub/log/store";
import type { OpsStore } from "@hub/log/ops";
import type { NotionReader } from "@hub/notion";
import type { MessengerSenders } from "@hub/messengers/door";
import type { SenderOptions } from "../send/context";
import type { ConversationMail, InboundTextReader } from "../mail/context";
import type { InboundHandle } from "../mail/inbound";
import type { SentStatus } from "../mail/sent";
import type { LeadsHandle } from "../clients/leads-reader";
import type { MessengersStatus } from "../messengers/bot";
import type { TelegramUserHandle } from "../messengers/accounts/telegram-user";
import type { WhatsAppHandle } from "../messengers/accounts/whatsapp";
import type { ProjectAutolink } from "../messengers/autolink/setup";
import type { Preanalysis } from "../messengers/preanalysis";
import type { AutopilotHandle } from "../messengers/autopilot/wake";
import type { FollowUpsRuntime } from "../follow-ups/start";
import type { LeadPassRuntime } from "../lead-pass/start";
import type { AgentToolsService } from "../agent/tools";
import type { FocusStore } from "../agent/focus";
import type { ConnectionsService } from "../instance/connections";
import type { AutostartService } from "../instance/autostart";
import type { CoreUpdatesService } from "../instance/core-updates";
import type { LocalService } from "../local/context";
import type { LiveService } from "../live/live";
import type { TerminalService } from "../terminal/terminal";
import type { OverviewService } from "../overview/overview";
import type { SchemeSources } from "../overview/scheme";

/** The Mailer behind Send, and which one it is (the fake only with a throwaway `HUB_DB`). */
export type RuntimeSender = SenderOptions & { kind: "mail-app" | "fake" };

/**
 * Everything the server started, once (P126 S1, section 3.5): the database's repos, one clock, one admin port, the projects and
 * their store, and each domain's started handles. `composition/contexts.ts` cuts one context per domain from it; nothing else
 * reads it. A handle that was not started is absent, and its routes answer 404 (or "not set up" for Send).
 */
export type Runtime = {
  repos: Repos;
  now: () => Date;
  /** The admin's port, for every exact-origin door (send ticket, terminal, focus, local Open, autostart, the accounts). */
  adminPort: number;
  /** SQLite `data_version` of the server's connection; changes when another process commits. */
  dataVersion: () => number;
  projectsDir: string;
  /** `hubPaths().stateProjects`: the send policy files. */
  policyDir?: string;
  projects: ProjectStore;
  /** Tests: the Overview's and the knowledge page's zone. */
  timeZone?: string;
  /** P142 (decision 0050): the daily follow-up sweep; absent in tests that do not wire it. */
  followUps?: FollowUpsRuntime;
  /** P147 (decision 0055): the daily lead pass; absent in tests that do not wire it. */
  leadPass?: LeadPassRuntime;
  mail: {
    sender?: RuntimeSender;
    sent?: () => SentStatus;
    /** P140 R5: one pass of the Sent reconciler now (Refresh). */
    sentPass?: () => Promise<void>;
    inbound?: InboundHandle;
    inboundText?: InboundTextReader;
    leads?: LeadsHandle;
    conversation?: ConversationMail;
  };
  messengers: {
    bot?: () => MessengersStatus;
    telegramUser?: TelegramUserHandle;
    whatsapp?: WhatsAppHandle;
    autolink?: ProjectAutolink;
    preanalysis?: Preanalysis;
    reply?: { llm: Llm };
    /** The one send of each connected account, handed to the send door and nothing else (P71 M4). */
    senders?: MessengerSenders;
    /** P139: the messenger autopilot (decision 0048): its switches, its scheduler and the ingest's wake. */
    autopilot?: AutopilotHandle;
  };
  agent: {
    tools?: AgentToolsService;
    focus?: FocusStore;
    pointerFile?: string;
    log?: LogStore;
  };
  instance: {
    connections: ConnectionsService;
    /** Tests: the instance's config folder (brand); default `hubPaths()`. */
    paths?: Pick<HubPaths, "configFile" | "configDir">;
    local?: LocalService;
    autostart?: AutostartService;
    core?: CoreUpdatesService;
    opsLog?: OpsStore;
  };
  live?: LiveService;
  terminal?: TerminalService;
  overview?: { service?: OverviewService; scheme?: Partial<SchemeSources> };
  /** P101: an injected read-only Notion reader for Quick Links. */
  projectLinks?: { reader?: NotionReader };
};

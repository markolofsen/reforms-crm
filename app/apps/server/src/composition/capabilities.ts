import type { Repos } from "@hub/db";
import type { HubPaths } from "@hub/config/paths";
import type { AgentToolsDto } from "@hub/contract/agent-tools";
import type { HealthDto } from "@hub/contract/health";
import type { OpenRun, ResolveDeps } from "@hub/projects/local-open";
import type { OpsStore } from "@hub/log/ops";
import type { LogStore } from "@hub/log/store";
import type { Llm } from "@hub/llm";
import type { ClientDirectory } from "../client-directory";
import type { ChatIdentityOf } from "../messenger-identity";
import type { AppsProbe } from "../apps-probe";
import type { AppsDto } from "@hub/contract/local";
import type { ConnectionsService } from "../connections";
import type { HistoryMessage, ReadInput } from "@hub/mail-app/history";
import type { FocusStore } from "../focus";
import type { InboundHandle } from "../inbound";
import type { LeadsHandle } from "../leads-reader";
import type { LiveService } from "../live";
import type { OverviewService } from "../overview";
import type { Preanalysis } from "../preanalysis";
import type { ProjectLinksOptions } from "../project-links";
import type { SendServices, SenderOptions } from "../routes/sends";
import type { SchemeSources } from "../scheme";
import type { MessengerSenders } from "@hub/messengers/door";
import type { TerminalService } from "../terminal";
import type { AutostartService } from "../autostart";
import type { CoreUpdatesService } from "../core-updates";
import type { ProjectAutolink } from "../autolink-setup";
import type { TelegramUserHandle } from "../telegram-user";
import type { WhatsAppHandle } from "../whatsapp";

export type MailServices = {
  repos: Repos;
  sender?: SenderOptions;
};

export const mailServicesOf = (repos: Repos, sender?: SenderOptions): MailServices => ({
  repos,
  ...(sender ? { sender } : {}),
});

export type ReviewServices = {
  repos: Repos;
  sender?: SenderOptions;
};

export const reviewServicesOf = (repos: Repos, sender?: SenderOptions): ReviewServices => ({
  repos,
  ...(sender ? { sender } : {}),
});

export const sendServicesOf = (repos: Repos, sender?: SenderOptions, messengers?: MessengerSenders): SendServices => ({
  repos,
  ...(sender ? { sender } : {}),
  ...(messengers ? { messengers } : {}),
});

export type BulkServices = {
  repos: Repos;
};

export const bulkServicesOf = (repos: Repos): BulkServices => ({ repos });

export type MessengerDirectory = {
  project: string | null;
  directory: ClientDirectory;
  /** P131 O5: a chat's own Telegram username and phone from the autolink memory. */
  identityOf?: ChatIdentityOf;
};

export type MessengerServices = {
  repos: Repos;
  adminPort: number;
  preanalysis?: Preanalysis;
  reply?: { llm: Llm; projectsDir: string; policyDir?: string };
  directory?: MessengerDirectory;
};

export const messengerServicesOf = (repos: Repos, services: Omit<MessengerServices, "repos">): MessengerServices => ({
  repos,
  ...services,
});

export type TelegramUserServices = {
  tg?: TelegramUserHandle;
  adminPort: number;
};

export const telegramUserServicesOf = (tg: TelegramUserHandle | undefined, adminPort: number): TelegramUserServices => ({
  ...(tg ? { tg } : {}),
  adminPort,
});

export type WhatsAppServices = {
  wa?: WhatsAppHandle;
  adminPort: number;
};

export const whatsappServicesOf = (wa: WhatsAppHandle | undefined, adminPort: number): WhatsAppServices => ({
  ...(wa ? { wa } : {}),
  adminPort,
});

export type AutolinkServices = {
  repos: Repos;
  autolink?: ProjectAutolink;
  adminPort: number;
  /** P128 X5: the token `hub mcp` presents (the agent send's, decision 0046); absent, the agent's chat-sorting doors refuse. */
  agentToken?: string;
};

export const autolinkServicesOf = (repos: Repos, autolink: ProjectAutolink | undefined, adminPort: number, agentToken?: string): AutolinkServices => ({
  repos,
  ...(autolink ? { autolink } : {}),
  adminPort,
  ...(agentToken ? { agentToken } : {}),
});

export type AgentToolsCapability = {
  get(slug: string): Promise<AgentToolsDto>;
  refresh(slug: string): Promise<AgentToolsDto>;
};

export type AgentServices = {
  repos: Repos;
  tools?: AgentToolsCapability;
};

export const agentServicesOf = (repos: Repos, tools?: AgentToolsCapability): AgentServices => ({
  repos,
  ...(tools ? { tools } : {}),
});

export type ProjectLinksServices = {
  repos: Repos;
  root: string;
  options?: ProjectLinksOptions;
};

export const projectLinksServicesOf = (repos: Repos, root: string, options?: ProjectLinksOptions): ProjectLinksServices => ({
  repos,
  root,
  ...(options ? { options } : {}),
});

export type ProjectServices = {
  repos: Repos;
  root: string;
  policyDir?: string;
};

export const projectServicesOf = (repos: Repos, root: string, policyDir?: string): ProjectServices => ({
  repos,
  root,
  ...(policyDir ? { policyDir } : {}),
});

export type ProjectCatalogServices = {
  repos: Repos;
};

export const projectCatalogServicesOf = (repos: Repos): ProjectCatalogServices => ({ repos });

export type HealthServices = {
  health: () => HealthDto;
  dataVersion: () => number;
  now: () => Date;
};

export const healthServicesOf = (health: () => HealthDto, dataVersion: () => number, now: () => Date): HealthServices => ({ health, dataVersion, now });

export interface ConversationMail {
  history(q: ReadInput): Promise<{ messages: HistoryMessage[]; ms: number } | { note: string }>;
  text(at: { account: string; mailbox: string; mailId: number } | { account: string; messageId: string }): Promise<{ text: string } | { note: string }>;
  headers?(at: { account: string; messageId: string }): Promise<{ headers: string; accountAddresses?: readonly string[] } | { note: string }>;
}

export type ConversationServices = {
  repos: Repos;
  mail?: ConversationMail;
  /** P131 O5: the Notion Clients records in memory, for the client's Telegram and WhatsApp. */
  directory?: MessengerDirectory;
};

export const conversationServicesOf = (repos: Repos, mail?: ConversationMail, directory?: MessengerDirectory): ConversationServices => ({
  repos,
  ...(mail ? { mail } : {}),
  ...(directory ? { directory } : {}),
});

export type InboundTextReader = (account: string, messageId: string) => Promise<{ text: string } | { note: string }>;

export type InboundServices = {
  repos: Repos;
  reader?: InboundHandle;
  readText?: InboundTextReader;
  leads?: LeadsHandle;
};

export const inboundServicesOf = (repos: Repos, reader?: InboundHandle, readText?: InboundTextReader, leads?: LeadsHandle): InboundServices => ({
  repos,
  ...(reader ? { reader } : {}),
  ...(readText ? { readText } : {}),
  ...(leads ? { leads } : {}),
});

export type SequenceServices = {
  repos: Repos;
  projectsDir: string;
  now: () => Date;
};

export const sequenceServicesOf = (repos: Repos, projectsDir: string, now: () => Date): SequenceServices => ({
  repos,
  projectsDir,
  now,
});

export type KnowledgeServices = {
  repos: Repos;
  now: () => Date;
  timeZone?: string;
};

export const knowledgeServicesOf = (repos: Repos, now: () => Date, timeZone?: string): KnowledgeServices => ({
  repos,
  now,
  ...(timeZone ? { timeZone } : {}),
});

export type OverviewServices = {
  service: OverviewService;
};

export const overviewServicesOf = (service: OverviewService): OverviewServices => ({ service });

export type SchemeServices = {
  sources: SchemeSources;
};

export const schemeServicesOf = (sources: SchemeSources): SchemeServices => ({ sources });

export type AgentFeedServices = {
  repos: Repos;
  store?: LogStore;
  now: () => Date;
};

export const agentFeedServicesOf = (repos: Repos, store: LogStore | undefined, now: () => Date): AgentFeedServices => ({
  repos,
  ...(store ? { store } : {}),
  now,
});

export type InboxServices = {
  repos: Repos;
};

export const inboxServicesOf = (repos: Repos): InboxServices => ({ repos });

export type OpsLogServices = {
  store?: OpsStore;
  now: () => Date;
};

export const opsLogServicesOf = (store: OpsLogServices["store"], now: () => Date): OpsLogServices => ({
  ...(store ? { store } : {}),
  now,
});

export type LiveServices = {
  live?: LiveService;
};

export const liveServicesOf = (live?: LiveService): LiveServices => ({
  ...(live ? { live } : {}),
});

export type PointerServices = {
  repos: Repos;
  file?: string;
  now: () => Date;
};

export const pointerServicesOf = (repos: Repos, file: string | undefined, now: () => Date): PointerServices => ({
  repos,
  ...(file ? { file } : {}),
  now,
});

export type FocusServices = {
  store?: FocusStore;
  adminPort: number;
};

export const focusServicesOf = (store: FocusStore | undefined, adminPort: number): FocusServices => ({
  ...(store ? { store } : {}),
  adminPort,
});

export type TerminalServices = {
  terminal?: TerminalService;
  adminPort: number;
};

export const terminalServicesOf = (terminal: TerminalService | undefined, adminPort: number): TerminalServices => ({
  ...(terminal ? { terminal } : {}),
  adminPort,
});

export type AutostartServices = {
  service?: AutostartService;
  adminPort: number;
};

export const autostartServicesOf = (service: AutostartService | undefined, adminPort: number): AutostartServices => ({
  ...(service ? { service } : {}),
  adminPort,
});

export interface LocalService {
  deps: ResolveDeps;
  run: OpenRun;
  available: boolean;
  now?: () => number;
  /** P131 O2: which destination apps this Mac has (`apps` on the instance), and Check again. */
  apps?: Pick<AppsProbe, "status" | "check">;
}

export type LocalServices = {
  local?: LocalService;
  adminPort: number;
};

export const localServicesOf = (local: LocalService | undefined, adminPort: number): LocalServices => ({
  ...(local ? { local } : {}),
  adminPort,
});

export type InstanceServices = {
  paths?: Pick<HubPaths, "configFile" | "configDir">;
  localOpen?: () => boolean;
  /** P131 O2: the destination apps of this Mac; none when the server cannot open locally. */
  apps?: () => AppsDto;
};

export const instanceServicesOf = (paths?: Pick<HubPaths, "configFile" | "configDir">, localOpen?: () => boolean, apps?: () => AppsDto): InstanceServices => ({
  ...(paths ? { paths } : {}),
  ...(localOpen ? { localOpen } : {}),
  ...(apps ? { apps } : {}),
});

export type CoreServices = {
  service?: CoreUpdatesService;
};

export const coreServicesOf = (service?: CoreUpdatesService): CoreServices => ({
  ...(service ? { service } : {}),
});

export type ConnectionsServices = {
  service: ConnectionsService;
};

export const connectionsServicesOf = (service: ConnectionsService): ConnectionsServices => ({ service });

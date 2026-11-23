import type { Repos } from "@hub/db";
import type { Llm } from "@hub/llm";
import type { ClientDirectory } from "../clients/directory";
import type { ChatIdentityOf } from "./identity";
import type { Preanalysis } from "./preanalysis";
import type { ProjectAutolink } from "./autolink/setup";
import type { TelegramUserHandle } from "./accounts/telegram-user";
import type { WhatsAppHandle } from "./accounts/whatsapp";

/** The Notion Clients records in memory, for a chat's or a person's Telegram and WhatsApp (P131 O5). */
export type MessengerDirectory = {
  project: string | null;
  directory: ClientDirectory;
  /** P131 O5: a chat's own Telegram username and phone from the autolink memory. */
  identityOf?: ChatIdentityOf;
};

/**
 * The messengers domain's context (P126 S1): the chats, the accounts and the autolink. A handle the server did not start is
 * absent, and its routes answer 404.
 */
export type MessengersContext = {
  repos: Repos;
  adminPort: number;
  preanalysis?: Preanalysis;
  reply?: { llm: Llm; projectsDir: string; policyDir?: string };
  directory?: MessengerDirectory;
  tg?: TelegramUserHandle;
  wa?: WhatsAppHandle;
  autolink?: ProjectAutolink;
  /** P128 X5: the token `hub mcp` presents (the agent send's, decision 0046); absent, the agent's chat-sorting doors refuse. */
  agentToken?: string;
};

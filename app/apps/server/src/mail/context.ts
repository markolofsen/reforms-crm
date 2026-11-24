import type { Repos } from "@hub/db";
import type { ProjectStore } from "@hub/projects/store";
import type { HistoryMessage, ReadInput } from "@hub/mail-app/history";
import type { SenderOptions } from "../send/context";
import type { MessengerDirectory } from "../messengers/context";
import type { InboundHandle } from "./inbound";
import type { LeadsHandle } from "../clients/leads-reader";

/** P99: one person's history and one body read from Mail for the conversation pane. */
export interface ConversationMail {
  history(q: ReadInput): Promise<{ messages: HistoryMessage[]; ms: number } | { note: string }>;
  text(at: { account: string; mailbox: string; mailId: number } | { account: string; messageId: string }): Promise<{ text: string } | { note: string }>;
  headers?(at: { account: string; messageId: string }): Promise<{ headers: string; accountAddresses?: readonly string[] } | { note: string }>;
  /** P140 R5: drops these messages' bodies from the server's memory (Refresh), so the next read asks Mail. */
  forget?(at: ReadonlyArray<{ account: string; mailbox: string; mailId: number } | { account: string; messageId: string }>): void;
}

/** P96: one message's text from Mail for the Inbox card. */
export type InboundTextReader = (account: string, messageId: string) => Promise<{ text: string } | { note: string }>;

/**
 * The Mail domain's context (P126 S1): drafts, the Inbox, inbound, conversations and bulk. A reader the server did not start is
 * absent: the Inbox is empty, the card and the pane say Mail is not read here.
 */
export type MailContext = {
  repos: Repos;
  /** P126 P3: the project's config, read from project.md (never the registry's snapshot). */
  projects: ProjectStore;
  sender?: SenderOptions;
  reader?: InboundHandle;
  readText?: InboundTextReader;
  leads?: LeadsHandle;
  mail?: ConversationMail;
  /** P140 R5: one pass of the Sent reconciler now (Refresh). */
  sentPass?: () => Promise<void>;
  /** P140 R5 (P141 W3): refills one WhatsApp chat's cache from the Mac's WhatsApp app; the rows it stored. */
  refillWhatsApp?: (project: string, chat: { chatId: string; jid: string | null }, opts?: { force?: boolean }) => Promise<number>;
  /** P131 O5: the Notion Clients records in memory, for the client's Telegram and WhatsApp. */
  directory?: MessengerDirectory;
};

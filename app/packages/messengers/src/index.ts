// Agent-facing entry. Everything here is read, store or draft: nothing links a chat, approves a reply or sends.
// Those live in `@hub/messengers/human` and need a HumanActor (see human.ts).
export { CHANNELS, MAX_TEXT, RETENTION_DAYS, channelsOf } from "./types";
export type { Draft, IdentifierKind, MessengerChannel } from "./types";
export { MessengersError, type MessengersErrorCode } from "./errors";
export { normalizeIdentifier } from "./normalize";
export { isConfirmed, type ConfirmedDraft } from "./confirmed";
export {
  AdapterError,
  baileysSocketFactory,
  isParkedCode,
  isSending,
  mtcuteClients,
  parkedLine,
  parkedOf,
  PARKED_CODES,
  pollOnly,
  telegramPollAdapter,
  type AdapterErrorCode,
  type ParkedCode,
  type InboundMessage,
  type MessengerAdapter,
  type PollBatch,
  type PollOptions,
  type SendingAdapter,
  type SentReceipt,
} from "./adapter";
export { FakeAdapter, FakeSendingAdapter } from "./fake";
export { createTelegramAdapter, toAdapterError, toInbound, type TelegramApi, type TelegramOptions } from "./telegram";
export { botTokenFile, botIdOf, readBotToken } from "./token";
export { telegramAdapterFromToken } from "./telegram-api";
export { ingest, type Dropped, type IngestDeps, type IngestResult } from "./ingest";
export { backoffMs, pollOnce, redact, runPoller, type PollDeps, type PollEvent, type PollResult, type RunDeps } from "./poller";
export { createDraft, listOpenDrafts, type NewDraftInput } from "./drafts";
export { clientHistory, type ClientHistory, type ClientHistoryDeps, type HistoryItem } from "./history";
export { pollCommand, pollLine, statusLines, STALE_AFTER_MS } from "./commands";
export { purgeNow } from "./purge";
export { buildDirectory, e164, matchDialog, MATCH_REASON, username as telegramUsername, type DialogChannel, type DialogIdentity, type DialogMatch, type Directory, type DirectoryEntry, type DirectoryKey } from "./autolink";
export { extractSignaturePhones, signatureBlock } from "./signature-phones";
export {
  createTelegramUserAdapter,
  toUserAdapterError,
  toUserInbound,
  FLOOD_PARK_SECONDS,
  IMPORT_LIMIT,
  QUEUE_MAX,
  telegramPhone,
  type MtClient,
  type MtMe,
  type MtMessage,
  type MtPeer,
  type TelegramUserAdapter,
  type TelegramUserOptions,
  type TelegramUserSendingAdapter,
  type UserDialog,
} from "./telegram-user";
export { readSession, redactSessions, sessionAccounts, sessionsDir, SESSION_FILE, type SessionRead, type UserSession } from "./sessions";
export type { LoginCredentials, LoginStep, MtLoginClient } from "./telegram-user-login";
export { FakeLoginClient, FakeMtClient, FakeRpcError, fakePerson } from "./fake-user";
export {
  createWhatsAppAdapter,
  toWaAdapterError,
  toWaInbound,
  WA_CODES,
  WA_DIRECTORY_MAX,
  WA_HISTORY_MS,
  WA_OPEN_MS,
  type WaAnchor,
  type WaChat,
  type WaConnection,
  type WaEvents,
  type WaMe,
  type WaMessage,
  type WaSocket,
  type WaSocketFactory,
  type WhatsAppAdapter,
  type WhatsAppOptions,
  type WhatsAppSendingAdapter,
} from "./whatsapp";
export { CREDS as WA_CREDS, readWaAuth, waFolderOf, WaAuthFiles, type WaAuthRead } from "./whatsapp-auth";
export { FakeBoom, FakeWaSocket } from "./fake-wa";

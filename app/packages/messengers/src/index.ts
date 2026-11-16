// Agent-facing entry. Everything here is read, store or draft: nothing links a chat, approves a reply or sends.
// Those live in `@hub/messengers/human` and need a HumanActor (see human.ts).
export { CHANNELS, MAX_TEXT, RETENTION_DAYS, canSendVia, channelsOf } from "./types";
export type { Draft, IdentifierKind, MessengerChannel, SendableChannel } from "./types";
export { MessengersError, type MessengersErrorCode } from "./errors";
export { normalizeIdentifier } from "./normalize";
export { isConfirmed, type ConfirmedDraft } from "./confirmed";
export {
  AdapterError,
  isSending,
  pollOnly,
  telegramPollAdapter,
  type AdapterErrorCode,
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
export { ingest, type Dropped, type IngestDeps, type IngestResult } from "./ingest";
export { backoffMs, pollOnce, redact, runPoller, type PollDeps, type PollEvent, type PollResult, type RunDeps } from "./poller";
export { createDraft, listOpenDrafts, type NewDraftInput } from "./drafts";
export { clientHistory, type ClientHistory, type ClientHistoryDeps, type HistoryItem, type MailPages } from "./history";
export { pollCommand, pollLine, statusLines, STALE_AFTER_MS } from "./commands";
export { purgeNow } from "./purge";

// The only public entry of @hub/db: the async repository layer and the database opener.
export { draftCountsReadOnly } from "./status";
export { copyAndVerify, inspectCopy, type CopyCheck } from "./backup-check";
export { defaultDbPath, openDb, type Db, type DbHandle } from "./client";
export { renameProjectInDb, type DbRenameResult, type RenameTable } from "./rename";
export { dataVersion, isBusy } from "./tx";
export { RepoError, type RepoErrorCode } from "./errors";
export { buildMatchQuery, createRepos, isExpired, type Repos } from "./repos";
export { EVENT_DETAIL_DAYS } from "./repos/runs";
export type {
  AddressRow,
  AgentDraft,
  AudienceClient,
  BatchRow,
  BatchSummary,
  NewBatch,
  QueuedBatch,
  ReviewDraft,
  ChatRef,
  ClientIdentifierRow,
  MessengerAccountRow,
  MessengerDraftRow,
  MessengerMessageRow,
  NewMessengerDraft,
  NewMessengerMessage,
  ClientRow,
  DraftRow,
  EventRow,
  KnowledgeDocRow,
  NewClient,
  InboxInput,
  InboxItem,
  InboxResult,
  InboxRow,
  NewDraft,
  NewEvent,
  NewKnowledgeDoc,
  NewProjectRow,
  NewQuestion,
  NewRun,
  NewSend,
  SendRow,
  ProjectRow,
  RecordDraftInput,
  RecordDraftResult,
  QuestionRow,
  RunRow,
  SearchHit,
  SearchOptions,
} from "./repos";
export { SEND_STATUSES, type SendStatus } from "./schema";
export type { IdentifierKind, MessengerChannel, MessengerDirection, MessengerDraftStatus } from "./schema";
export { allAcknowledged, effectiveRules, evaluateSafety, type SafetyInput } from "./safety";
export { seed } from "./seed";

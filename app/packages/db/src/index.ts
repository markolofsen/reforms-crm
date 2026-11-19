// The only public entry of @hub/db: the async repository layer and the database opener.
export { draftCountsReadOnly } from "./status";
export { copyAndVerify, inspectCopy, restoreCheck, type CopyCheck, type RestoreCheck } from "./backup-check";
export { defaultDbPath, openDb, openDbReadOnly, type Db, type DbHandle } from "./client";
export { renameProjectInDb, type DbRenameResult, type RenameTable } from "./rename";
export { dataVersion, isBusy } from "./tx";
export { bumpTopic, bumpTopicIn, liveSeq, liveSince, LIVE_TABLES, TOPIC_PREFIX, type LiveChange, type LiveTable } from "./live";
export { RepoError, type RepoErrorCode } from "./errors";
export { bareRef, buildMatchQuery, createRepos, isExpired, type Repos } from "./repos";
export { EVENT_DETAIL_DAYS } from "./repos/runs";
export type {
  Activity,
  ActivityFilter,
  ActivityOutcome,
  ActivityRow,
  ActivitySession,
  AddressRow,
  Candidate,
  EnrollmentItem,
  EnrollmentRow,
  NewEnrollment,
  Outbound,
  BatchRow,
  BatchSummary,
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
  MailVersionRow,
  MailVersionSource,
  NewMailVersion,
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
  SearchHit,
  SearchOptions,
} from "./repos";
export { SEND_STATUSES, type SendStatus } from "./schema";
export type { IdentifierKind, MessengerChannel, MessengerDirection, MessengerDraftStatus } from "./schema";
export { allAcknowledged, effectiveRules, evaluateSafety, type SafetyInput } from "./safety";
export { seed } from "./seed";

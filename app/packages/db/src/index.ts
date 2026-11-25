// The only public entry of @hub/db: the async repository layer and the database opener.
import { existsSync } from "node:fs";
import { DEFAULT_AGENT_SETTINGS, type AgentSettings } from "@hub/config";
import { openDbReadOnly } from "./client";
import { agentSettingsOf } from "./repos/agent-settings";
export { draftCountsReadOnly } from "./status";
export { copyAndVerify, inspectCopy, restoreCheck, type CopyCheck, type RestoreCheck } from "./backup-check";
export { DbBehindError, defaultDbPath, openDb, openDbReadOnly, type Db, type DbHandle, type OpenDbOptions } from "./client";
export { renameProjectInDb, type DbRenameResult, type RenameTable } from "./rename";
export { dataVersion, isBusy } from "./tx";
export { bumpTopic, bumpTopicIn, liveSeq, liveSince, LIVE_TABLES, TOPIC_PREFIX, type LiveChange, type LiveTable } from "./live";
export { RepoError, type RepoErrorCode } from "./errors";
export { decisionSummary, dueClients, judgeDue, type DueChat, type DueClient, type DueFacts, type FollowUpDecisionInput, type FollowUpItem, type FollowUpRow, type FollowUpSweepRow, type NotDue } from "./repos";
export { adoptable, bareRef, isReplyShell, buildMatchQuery, createRepos, isExpired, isDoneThrough, rulesOf, senderName, shellHashOf, startsWithWrite, teamNoticeOf, textKey, usageRefusal, versionHashOf, withoutLeadingBlankLines, type Repos } from "./repos";
export { EVENT_DETAIL_DAYS } from "./repos/runs";
export { answeringDraft, PREVIEW_CHARS } from "./repos/inbound-mail";
export { CONVERSATION_STATES, CONVERSATION_VIEWS, stateOf, type ConversationCounts, type ConversationItem, type ConversationState, type ConversationView } from "./repos/conversations";
export { LEAD_PREVIEW_CHARS } from "./repos/lead-rows";
export { dueLeads, type LeadDecisionInput, type LeadPassItem, type LeadPassRow } from "./repos/lead-pass";
export { REFUSAL_COALESCE_MS } from "./repos/llm-calls";
export type {
  Activity,
  ActivityOutcome,
  ActivityRow,
  ActivityView,
  TimelineQuery,
  AddressRow,
  Candidate,
  EnrollmentItem,
  EnrollmentRow,
  NewEnrollment,
  Outbound,
  BatchRow,
  BatchSummary,
  ReviewDraft,
  TeamNotice,
  ChatActivity,
  ChatRef,
  ClientIdentifierRow,
  MessengerChatRow,
  MessengerAccountRow,
  MessengerDraftRow,
  MessengerMessageRow,
  MessengerProjectionRow,
  NewMessengerDraft,
  NewMessengerMessage,
  ClientRow,
  DraftRow,
  EventRow,
  KnowledgeDocRow,
  LlmMonth,
  NewLlmCall,
  Adoption,
  MailVersionRow,
  MailVersionSource,
  MailWriteRow,
  NewMailVersion,
  NewMailWrite,
  ThreadDraft,
  NewClient,
  InboundItem,
  InboundKnown,
  InboundRow,
  InboundWhy,
  NewInbound,
  LeadItem,
  LeadRow,
  NewLead,
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
  NewOwnerFix,
  OwnerFixRow,
  MessengerUsage,
  NewMessengerSend,
  NewTriage,
  TriageCounts,
  NewSend,
  SendRow,
  ProjectRow,
  RecordDraftInput,
  RecordDraftResult,
  QuestionRow,
  SearchHit,
  SearchOptions,
} from "./repos";
export { SEND_CHANNELS, SEND_STATUSES, type SendChannel, type SendStatus } from "./schema";
export { LEAD_DISMISS_REASONS, type LeadDismissReason } from "./schema";
export type { IdentifierKind, MessageSource, MessengerChannel, MessengerDirection, MessengerDraftStatus } from "./schema";
export { allAcknowledged, effectiveRules, evaluateSafety, type SafetyInput } from "./safety";
export { seed } from "./seed";
export { agentSettingsOf };

/**
 * P55: a project's agent settings as `hub agent` reads them when it writes the session files: read only, and the default
 * when the database is missing, older than migration 0024 or unreadable (a session must start even then).
 */
export function readAgentSettings(dbPath: string, project: string | undefined): AgentSettings {
  if (!project || !existsSync(dbPath)) return { ...DEFAULT_AGENT_SETTINGS };
  try {
    const h = openDbReadOnly(dbPath);
    try {
      return agentSettingsOf(h.db, project);
    } finally {
      h.close();
    }
  } catch {
    return { ...DEFAULT_AGENT_SETTINGS };
  }
}

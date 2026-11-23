import type { Db } from "../client";
import { agentSettingsRepo } from "./agent-settings";
import { batchesRepo } from "./batches";
import { clientsRepo } from "./clients";
import { conversationsRepo } from "./conversations";
import { draftsRepo } from "./drafts";
import { enrollmentsRepo } from "./enrollments";
import { inboxRepo } from "./inbox";
import { inboundMailRepo } from "./inbound-mail";
import { knowledgeRepo } from "./knowledge";
import { leadRowsRepo } from "./lead-rows";
import { llmCallsRepo } from "./llm-calls";
import { mailVersionsRepo, mailWritesRepo } from "./mail-versions";
import { messengersRepo } from "./messengers";
import { projectsRepo } from "./projects";
import { runsRepo } from "./runs";
import { safetyRulesRepo } from "./safety-rules";
import { sendsRepo } from "./sends";

export function createRepos(db: Db) {
  return {
    clients: clientsRepo(db),
    conversations: conversationsRepo(db),
    drafts: draftsRepo(db),
    runs: runsRepo(db),
    projects: projectsRepo(db),
    knowledge: knowledgeRepo(db),
    messengers: messengersRepo(db),
    batches: batchesRepo(db),
    safetyRules: safetyRulesRepo(db),
    agentSettings: agentSettingsRepo(db),
    sends: sendsRepo(db),
    inbox: inboxRepo(db),
    inboundMail: inboundMailRepo(db),
    leadRows: leadRowsRepo(db),
    enrollments: enrollmentsRepo(db),
    mailVersions: mailVersionsRepo(db),
    mailWrites: mailWritesRepo(db),
    llmCalls: llmCallsRepo(db),
  };
}
export type Repos = ReturnType<typeof createRepos>;
export type { ClientRow, DraftRow, NewClient } from "./clients";
export type { NewDraft, RecordDraftInput, RecordDraftResult } from "./drafts";
export type { EventRow, NewEvent, NewRun } from "./runs";
export type { Activity, ActivityOutcome, ActivityRow, ActivityView, TimelineQuery } from "./activity";
export type { AddressRow, NewProjectRow, NewQuestion, ProjectRow, QuestionRow } from "./projects";
export type { KnowledgeDocRow, NewKnowledgeDoc, SearchHit, SearchOptions } from "./knowledge";
export { buildMatchQuery, isExpired } from "./knowledge";
export type {
  ChatRef,
  ClientIdentifierRow,
  MessengerAccountRow,
  MessengerDraftRow,
  MessengerMessageRow,
  NewMessengerDraft,
  NewMessengerMessage,
} from "./messengers";
export type { MessengerProjectionRow } from "./messenger-projection";
export type { ChatActivity, MessengerChatRow } from "./messenger-chats";
export type { NewTriage, TriageCounts } from "./messenger-triage";
export { rulesOf } from "./messenger-chats";
export type { BatchRow, BatchSummary } from "./batches";
export type { BasedOn, ReviewDraft, TeamNotice } from "./review";
export { senderName, teamNoticeOf } from "./review";
export type { InboundItem, InboundKnown, InboundRow, InboundWhy, NewInbound } from "./inbound-mail";
export { PREVIEW_CHARS } from "./inbound-mail";
export type { LeadItem, LeadRow, NewLead } from "./lead-rows";
export { LEAD_PREVIEW_CHARS } from "./lead-rows";
export type { MessengerUsage, NewMessengerSend, NewSend, SendRow } from "./sends";
export { usageRefusal } from "./sends";
export type { Adoption, MailVersionRow, MailVersionSource, MailWriteRow, NewMailVersion, NewMailWrite, ThreadDraft } from "./mail-versions";
export { adoptable, bareRef, isReplyShell, shellHashOf, startsWithWrite, textKey, versionHashOf, withoutLeadingBlankLines } from "./mail-versions";
export type { LlmMonth, NewLlmCall } from "./llm-calls";
export type { InboxInput, InboxItem, InboxResult, InboxRow } from "./inbox";
export type { Candidate, EnrollmentItem, EnrollmentRow, NewEnrollment, Outbound } from "./enrollments";

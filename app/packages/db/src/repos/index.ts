import type { Db } from "../client";
import { batchesRepo } from "./batches";
import { clientsRepo } from "./clients";
import { draftsRepo } from "./drafts";
import { enrollmentsRepo } from "./enrollments";
import { inboxRepo } from "./inbox";
import { knowledgeRepo } from "./knowledge";
import { mailVersionsRepo, mailWritesRepo } from "./mail-versions";
import { messengersRepo } from "./messengers";
import { projectsRepo } from "./projects";
import { runsRepo } from "./runs";
import { safetyRulesRepo } from "./safety-rules";
import { sendsRepo } from "./sends";

export function createRepos(db: Db) {
  return {
    clients: clientsRepo(db),
    drafts: draftsRepo(db),
    runs: runsRepo(db),
    projects: projectsRepo(db),
    knowledge: knowledgeRepo(db),
    messengers: messengersRepo(db),
    batches: batchesRepo(db),
    safetyRules: safetyRulesRepo(db),
    sends: sendsRepo(db),
    inbox: inboxRepo(db),
    enrollments: enrollmentsRepo(db),
    mailVersions: mailVersionsRepo(db),
    mailWrites: mailWritesRepo(db),
  };
}
export type Repos = ReturnType<typeof createRepos>;
export type { ClientRow, DraftRow, NewClient } from "./clients";
export type { NewDraft, RecordDraftInput, RecordDraftResult } from "./drafts";
export type { EventRow, NewEvent, NewRun } from "./runs";
export type { Activity, ActivityFilter, ActivityOutcome, ActivityRow, ActivitySession } from "./activity";
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
export type { BatchRow, BatchSummary } from "./batches";
export type { BasedOn, ReviewDraft } from "./review";
export type { NewSend, SendRow } from "./sends";
export type { Adoption, MailVersionRow, MailVersionSource, MailWriteRow, NewMailVersion, NewMailWrite, ThreadDraft } from "./mail-versions";
export { adoptable, bareRef, shellHashOf, startsWithWrite, textKey, versionHashOf } from "./mail-versions";
export type { InboxInput, InboxItem, InboxResult, InboxRow } from "./inbox";
export type { Candidate, EnrollmentItem, EnrollmentRow, NewEnrollment, Outbound } from "./enrollments";

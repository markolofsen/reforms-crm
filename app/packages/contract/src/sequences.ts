import { z } from "zod";
import { ENROLLMENT_STATES, ENROLLMENT_VIEWS, FINISH_REASONS, NOTION_KINDS, SEQUENCE_DISPLAY_STATES, STOP_REASONS } from "@hub/config";

// Follow-up sequences (P47, `@docs/core/23-sequences.md`): the requests the API accepts and the replies it sends. The admin
// parses replies only with these (state-and-data rule 4) and never imports `@hub/sequences`. Nothing here sends: the
// owner enrols, pauses, resumes or stops; a session drafts the due steps; the owner sends each from Mail.

const project = z.string().min(1).max(100);
const iso = z.string();
const nullableIso = z.string().nullable();

// ---- Requests

export const enrollmentsQuery = z.object({ view: z.enum(ENROLLMENT_VIEWS).default("due") });
export const enrollmentParam = z.object({ slug: project, id: z.coerce.number().int().positive() });
export const slugOnlyParam = z.object({ slug: project });
/** The owner enrols one client in one of the project's sequences, or says "Not now" for this silence. */
export const enrolBody = z.strictObject({ clientId: z.number().int().positive(), sequence: z.string().trim().min(1).max(100), notNow: z.boolean().optional() });
export type EnrolBody = z.infer<typeof enrolBody>;
export const stopBody = z.strictObject({ reason: z.enum(STOP_REASONS).default("stopped") });

// ---- Replies

/** Our newest outbound message to the client: what the follow-up replies to. */
export const outboundDto = z.object({ draftId: z.number(), at: iso, subject: z.string(), mailRef: z.string().nullable(), sentMessageId: z.string().nullable(), mailClass: z.string().nullable(), notionKind: z.enum(NOTION_KINDS).nullable() });

export const enrollmentDto = z.object({
  id: z.number(),
  sequence: z.string(),
  /** The sequence's name from its file, or the id when the file is gone. */
  sequenceName: z.string(),
  step: z.number(),
  steps: z.number(),
  state: z.enum(ENROLLMENT_STATES),
  display: z.enum(SEQUENCE_DISPLAY_STATES),
  nextDueAt: nullableIso,
  anchorAt: iso,
  enrolledAt: iso,
  enrolledBy: z.string(),
  finishedAt: nullableIso,
  finishReason: z.enum(FINISH_REASONS).nullable(),
  openDraftId: z.number().nullable(),
  client: z.object({ id: z.number(), name: z.string(), email: z.string() }),
  last: outboundDto.nullable(),
});
export type EnrollmentDto = z.infer<typeof enrollmentDto>;
export const enrollmentsDto = z.object({ enrollments: z.array(enrollmentDto), counts: z.object({ due: z.number(), active: z.number() }) });
export type EnrollmentsDto = z.infer<typeof enrollmentsDto>;
export const enrollmentChangedDto = z.object({ ok: z.literal(true), enrollment: enrollmentDto });

/** A client the owner might enrol, with the sequence offered first (null when none of the project's sequences fits). */
export const candidateDto = z.object({
  client: z.object({ id: z.number(), name: z.string(), email: z.string() }),
  last: outboundDto,
  lastInboundAt: nullableIso,
  sequence: z.string().nullable(),
});
export type CandidateDto = z.infer<typeof candidateDto>;
export const candidatesDto = z.object({ candidates: z.array(candidateDto) });
export type CandidatesDto = z.infer<typeof candidatesDto>;

/** A sequence file as the owner chooses from it: no step text, only what the choice and the check need. */
export const sequenceSummaryDto = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.enum(["Draft", "Active", "Retired"]).nullable(),
  appliesTo: z.array(z.string()),
  mailClasses: z.array(z.string()),
  steps: z.number(),
  usable: z.boolean(),
  issues: z.array(z.object({ severity: z.enum(["error", "warning"]), message: z.string() })),
});
export type SequenceSummaryDto = z.infer<typeof sequenceSummaryDto>;
export const sequencesDto = z.object({ sequences: z.array(sequenceSummaryDto) });
export type SequencesDto = z.infer<typeof sequencesDto>;

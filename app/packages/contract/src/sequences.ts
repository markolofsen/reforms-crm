import { z } from "zod";
import { ENROLLMENT_STATES, ENROLLMENT_VIEWS, FINISH_REASONS, NOTION_KINDS, SEQUENCE_DISPLAY_STATES, STOP_REASONS } from "@hub/config";

// Follow-up sequences (P47, `@docs/core/23-sequences.md`): the requests the API accepts and the replies it sends. The admin
// parses replies only with these (state-and-data rule 4) and never imports `@hub/sequences`. Nothing here sends. A session
// enrols a client only on the owner's phrase, recorded with the enrolment (D1, P48); the admin shows the Follow-ups view
// read-only with Stop; pause and resume are the owner's, in his terminal; the owner sends each step from Mail.

const project = z.string().min(1).max(100);
const iso = z.string();
const nullableIso = z.string().nullable();

// ---- Requests

export const enrollmentsQuery = z.object({ view: z.enum(ENROLLMENT_VIEWS).default("due") });
export const enrollmentParam = z.object({ slug: project, id: z.coerce.number().int().positive() });
export const slugOnlyParam = z.object({ slug: project });
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
  /** `owner` (his terminal) or `agent` (a session, on the owner's phrase: D1, P48). */
  enrolledBy: z.string(),
  /** The owner's words that asked for this enrolment in a session; null when he enrolled it himself in his terminal. */
  enrolledPhrase: z.string().nullable(),
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

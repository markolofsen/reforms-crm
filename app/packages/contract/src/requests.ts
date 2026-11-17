import { z } from "zod";
import { AUDIENCES, BATCH_FILTERS, BATCH_INTENTS, CLIENT_FILTERS, DEFAULT_SILENT_DAYS, INBOX_FILTERS, INBOX_KINDS, MARKS, SAFETY_KINDS, SETTABLE_STATUSES, TONES } from "@hub/config";

// Every request the API accepts, once. The server validates with these; the admin imports the types of the bodies it
// builds. `SETTABLE_STATUSES` has no `sent`: the draft-only invariant is part of the contract.

export const idParam = z.object({ id: z.coerce.number().int().positive() });
export const project = z.string().min(1).max(100);
export const projectQuery = z.object({ project });
const text = (max: number) => z.string().trim().min(1).max(max);

/** Lists are paged: `limit` rows from `offset`. The order is stable, so an offset is a valid cursor. */
export const PAGE_SIZE = 100;
const page = { limit: z.coerce.number().int().min(1).max(500).default(PAGE_SIZE), offset: z.coerce.number().int().min(0).default(0) };

/** `search` narrows the rows (name, address or subject), never the counts beside the views; `batch` limits the list to the drafts one batch wrote. */
export const draftsQuery = z.object({
  project,
  filter: z.enum(CLIENT_FILTERS).default("all"),
  search: z.string().trim().max(200).default(""),
  batch: z.coerce.number().int().positive().optional(),
  ...page,
});
export const inboxQuery = z.object({ project, filter: z.enum(INBOX_FILTERS).default("owed"), ...page });
export const notByEmailQuery = z.object({ project, kind: z.enum(INBOX_KINDS).optional(), ...page });
export const batchQuery = z.object({ project, filter: z.enum(BATCH_FILTERS).default("all"), ...page });
export const historyQuery = z.object({ project, limit: z.coerce.number().int().min(1).max(200).optional(), cursor: z.string().min(1).max(2000).optional() });
export const audienceQuery = z.object({
  project,
  audience: z.enum(AUDIENCES).default("all"),
  silentDays: z.coerce.number().int().min(1).max(3650).default(DEFAULT_SILENT_DAYS),
});

// Draft and client mutations carry `project`: a draft or client of another project is "not found" (`@rules/README.md` rule 11).
export const marksBody = z.object({ project, marks: z.array(z.enum(MARKS)).max(MARKS.length) });
/** `hash` is the hash of the Mail draft the person read (P27 M2.4); the server refuses it when Mail has changed since. */
export const checkedBody = z.object({ project, checked: z.boolean(), hash: z.string().min(1).optional() });
export const statusBody = z.object({ project, status: z.enum(SETTABLE_STATUSES), reason: text(200).optional() });
export const toneBody = z.object({ project, tone: z.enum(TONES) });
export const ackBody = z.object({ project, kind: z.enum(SAFETY_KINDS), acked: z.boolean() });
export type StatusBody = z.infer<typeof statusBody>;

const tones = z.partialRecord(z.enum(TONES), text(20_000));
export const batchCreateBody = z.object({
  project,
  name: text(200),
  intent: z.enum(BATCH_INTENTS),
  audience: z.enum(AUDIENCES),
  silentDays: z.number().int().min(1).max(3650).nullish(),
  clientIds: z.array(z.number().int().positive()).min(1).max(5000),
  /** Purpose and tone, in the owner's words: the agent writes each draft from it. */
  brief: text(4000),
});
export type BatchCreateBody = z.infer<typeof batchCreateBody>;

export const agentDraftBody = z.object({
  project,
  clientId: z.number().int().positive(),
  subject: text(300),
  body: text(20_000),
  reason: text(1500),
  tones: tones.optional(),
  ccAddr: z.string().max(500).nullish(),
  mailRef: z.string().max(500).nullish(),
});
export const closeBody = z.object({
  project,
  status: z.enum(["ready", "failed"]),
  tokensIn: z.number().int().min(0).optional(),
  tokensOut: z.number().int().min(0).optional(),
  costUsd: z.number().min(0).optional(),
  model: z.string().max(100).nullish(),
});

export const safetyKindParam = z.object({ kind: z.enum(SAFETY_KINDS) });
export const safetyRuleBody = z.object({
  project,
  enabled: z.boolean().optional(),
  level: z.enum(["amber", "red"]).optional(),
  params: z.object({ words: z.array(text(60)).max(200).optional(), days: z.number().int().min(1).max(3650).optional() }).optional(),
});
export type SafetyRuleBody = z.infer<typeof safetyRuleBody>;

// Sending (decision 0011, P23 S3). A dry run needs no confirmation; a send carries what the person saw on screen, and
// the server refuses it when Mail's draft no longer matches. The route is the only place the admin can send from.
export const slugParam = z.object({ slug: project });
export const sendParam = z.object({ slug: project, id: z.coerce.number().int().positive() });
export const sendBody = z.discriminatedUnion("apply", [
  z.object({ apply: z.literal(false) }),
  z.object({ apply: z.literal(true), confirm: z.object({ to: z.array(text(320)).min(1).max(50), subject: text(300) }) }),
]);
export type SendBody = z.infer<typeof sendBody>;

// Connections (P37, decision 0020). A secret travels in one direction only: from the form to `PUT /api/connections/:id/secret`. No response,
// log line, error or read carries it back. `strictObject`: a stray field is refused, never stored.
export const connectionIdParam = z.object({ id: z.string().min(1).max(200) });
/** A Notion or Telegram token. The server checks its shape for that kind; the provider decides whether it works (that is Test). */
export const tokenSecretBody = z.strictObject({ value: z.string().trim().min(1).max(512) });
/** An IMAP app-password login. `account` must be the account the row is for (the id carries its slug). */
export const mailLoginBody = z.strictObject({
  account: z.string().trim().min(1).max(100),
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  user: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(512),
});
export const setSecretBody = z.union([tokenSecretBody, mailLoginBody]);
export type TokenSecretBody = z.infer<typeof tokenSecretBody>;
export type MailLoginBody = z.infer<typeof mailLoginBody>;
export type SetSecretBody = z.infer<typeof setSecretBody>;

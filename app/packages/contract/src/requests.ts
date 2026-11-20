import { z } from "zod";
import { ACTIVITY_CURSOR, ACTIVITY_VIEWS } from "./activity";
import { ADVISOR_MODELS, AGENT_MODELS, BATCH_FILTERS, CLIENT_FILTERS, INBOX_FILTERS, INBOX_KINDS, MARKS, SAFETY_KINDS, SETTABLE_STATUSES, TONES } from "@hub/config";

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
/** Activity (P73): a view by outcome, optionally one client, and the page before a cursor (`next` of the previous page). */
export const activityQuery = z.object({ project, view: z.enum(ACTIVITY_VIEWS).default("all"), client: z.coerce.number().int().positive().optional(), before: z.string().regex(ACTIVITY_CURSOR).optional() });
export const historyQuery = z.object({ project, limit: z.coerce.number().int().min(1).max(200).optional(), cursor: z.string().min(1).max(2000).optional() });
// Draft and client mutations carry `project`: a draft or client of another project is "not found" (`@rules/README.md` rule 11).
export const marksBody = z.object({ project, marks: z.array(z.enum(MARKS)).max(MARKS.length) });
/** `hash` is the hash of the Mail draft the person read (P27 M2.4); the server refuses it when Mail has changed since. */
export const checkedBody = z.object({ project, checked: z.boolean(), hash: z.string().min(1).optional() });
export const statusBody = z.object({ project, status: z.enum(SETTABLE_STATUSES), reason: text(200).optional() });
export const toneBody = z.object({ project, tone: z.enum(TONES) });
export const ackBody = z.object({ project, kind: z.enum(SAFETY_KINDS), acked: z.boolean() });
export type StatusBody = z.infer<typeof statusBody>;

export const safetyKindParam = z.object({ kind: z.enum(SAFETY_KINDS) });
export const safetyRuleBody = z.object({
  project,
  enabled: z.boolean().optional(),
  level: z.enum(["amber", "red"]).optional(),
  params: z.object({ words: z.array(text(60)).max(200).optional(), days: z.number().int().min(1).max(3650).optional() }).optional(),
});
export type SafetyRuleBody = z.infer<typeof safetyRuleBody>;

/** P55: a change to the project's agent settings (Settings ▸ Agent); a field left out keeps its value. */
export const agentSettingsBody = z.object({
  project,
  model: z.enum(AGENT_MODELS).optional(),
  advisor: z.boolean().optional(),
  advisorModel: z.enum(ADVISOR_MODELS).optional(),
});
export type AgentSettingsBody = z.infer<typeof agentSettingsBody>;

// Sending (decision 0011, P23 S3). A dry run needs no confirmation; a send carries what the person saw on screen, and
// the server refuses it when Mail's draft no longer matches. The route is the only place the admin can send from.
export const slugParam = z.object({ slug: project });
export const sendParam = z.object({ slug: project, id: z.coerce.number().int().positive() });
/** A person's Save of the draft's text (P56 S1): the whole text after the hub marker, and the hash of the read it was edited from. */
export const draftEditBody = z.strictObject({ text: z.string().min(1).max(20_000), hash: z.string().min(1).max(128) });
export const sendBody = z.discriminatedUnion("apply", [
  z.object({ apply: z.literal(false) }),
  // `ticket` (P49 S12): minted by POST /api/sends/tickets for this draft, single use. Optional here so a missing one is the route's 403, not a 400.
  z.object({ apply: z.literal(true), confirm: z.object({ to: z.array(text(320)).min(1).max(50), subject: text(300) }), ticket: z.string().min(1).max(200).optional() }),
]);
/** The admin page asks for a send ticket just before it applies a send (P49 S12); `kind: "messenger"` for a messenger draft (P71 M4). */
export const sendTicketBody = z.strictObject({ project, draftId: z.number().int().positive(), kind: z.enum(["mail", "messenger"]).default("mail") });
export type SendBody = z.infer<typeof sendBody>;

/**
 * P85b: Send all Checked of one batch. The dry run (`apply: false`) lists what would go out; the apply carries exactly the drafts
 * and text hashes the person confirmed, and a ticket minted for that list (`batchTicketBody`). Never more than the batch cap.
 */
const batchItems = z.array(z.strictObject({ draftId: z.number().int().positive(), hash: z.string().regex(/^[0-9a-f]{64}$/) })).min(1).max(200);
export const batchSendBody = z.discriminatedUnion("apply", [z.strictObject({ apply: z.literal(false) }), z.strictObject({ apply: z.literal(true), items: batchItems, ticket: z.string().min(1).max(200).optional() })]);
export const batchTicketBody = z.strictObject({ project, batchId: z.number().int().positive(), items: batchItems });
export const batchSendParam = z.object({ slug: z.string().min(1).max(100), id: z.coerce.number().int().positive() });
export type BatchSendBody = z.infer<typeof batchSendBody>;

// Connections (P37, decision 0020 as amended by 0026). A secret travels in one direction only: from the form to `PUT /api/connections/:id/secret`. No response,
// log line, error or read carries it back. `strictObject`: a stray field is refused, never stored.
export const connectionIdParam = z.object({ id: z.string().min(1).max(200) });
/** A Notion or Telegram token, the only secret the admin can send (mail has no key: decision 0026). The server checks its shape for that kind; the provider decides whether it works (that is Test). */
export const setSecretBody = z.strictObject({ value: z.string().trim().min(1).max(512) });
export type SetSecretBody = z.infer<typeof setSecretBody>;

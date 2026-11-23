import { z } from "zod";

const iso = z.string();
const nullableIso = z.string().nullable();

// Sending responses stay separate from review/project responses so the send door can
// evolve without making unrelated contract modules depend on its audit state.

// One row of the audit (`send_log`) as the Project screen shows it. Since P71 M4
// a row is Mail's (`channel: "mail"`, `draftId`) or a messenger's
// (`messengerDraftId`; `toAddr` is `<channel>:<chat id>`, `subject`
// who it went to).
export const sendRowDto = z.object({
  id: z.number(),
  draftId: z.number().nullable(),
  /** P99: the client of the draft, whose conversation the row links; null for a messenger send or a draft gone. */
  clientId: z.number().nullable(),
  channel: z.enum(["mail", "telegram_user", "telegram_bot", "whatsapp"]),
  messengerDraftId: z.number().nullable(),
  mode: z.enum(["manual", "auto"]),
  status: z.enum(["queued", "sending", "sent", "failed", "cancelled"]),
  actor: z.string(),
  createdAt: iso,
  dueAt: nullableIso,
  doneAt: nullableIso,
  toAddr: z.string(),
  ccAddr: z.string().nullable(),
  subject: z.string(),
  body: z.string(),
  error: z.string().nullable(),
});
export type SendRowDto = z.infer<typeof sendRowDto>;

/** `stopped` lists the scopes with Stop all on: `*` (every project) and/or project slugs. */
export const sendsDto = z.object({ sends: z.array(sendRowDto), stopped: z.array(z.string()) });
export type SendsDto = z.infer<typeof sendsDto>;

/** The dry run: exactly what Mail would send, for the confirm panel. */
export const sendPreviewDto = z.object({ ok: z.literal(true), dryRun: z.literal(true), from: z.string().nullable(), to: z.array(z.string()), cc: z.array(z.string()), subject: z.string(), body: z.string() });
export type SendPreviewDto = z.infer<typeof sendPreviewDto>;

export const sentDto = z.object({ ok: z.literal(true), sendId: z.number() });

/** A single-use ticket for one apply (P49 S12): minted only for the admin's exact origin, valid for seconds. */
export const sendTicketDto = z.object({ ticket: z.string(), expiresAt: z.string() });

/** P85b: the dry run of Send all Checked of one batch: who would get what (recipients, subject, the text's hash), who is held and why. */
const batchItemDto = z.object({ draftId: z.number(), name: z.string(), to: z.array(z.string()), cc: z.array(z.string()), subject: z.string(), hash: z.string() });
const batchHeldDto = z.object({ draftId: z.number(), name: z.string(), to: z.array(z.string()), subject: z.string(), reasons: z.array(z.string()) });
export const batchSendPlanDto = z.object({ ok: z.literal(true), dryRun: z.literal(true), batchId: z.number(), items: z.array(batchItemDto), held: z.array(batchHeldDto), cap: z.object({ limit: z.number(), used: z.number(), room: z.number() }), spacingSeconds: z.number() });
export type BatchSendPlanDto = z.infer<typeof batchSendPlanDto>;

export const BATCH_ITEM_STATUSES = ["waiting", "sending", "sent", "refused", "failed", "stopped"] as const;

/** P85b: one batch run as the server runs it (in its memory: a restart ends the run; the `send_log` rows stay). */
export const batchRunDto = z.object({
  project: z.string(),
  batchId: z.number(),
  state: z.enum(["running", "finished", "stopped"]),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  spacingSeconds: z.number(),
  items: z.array(z.object({ draftId: z.number(), name: z.string(), to: z.array(z.string()), subject: z.string(), status: z.enum(BATCH_ITEM_STATUSES), reasons: z.array(z.string()), sendId: z.number().nullable(), at: z.string().nullable() })),
});
export type BatchRunDto = z.infer<typeof batchRunDto>;
export const batchRunStateDto = z.object({ run: batchRunDto.nullable() });
export const sendCancelledDto = z.object({ ok: z.literal(true), sendId: z.number() });
export const stopDto = z.object({ ok: z.literal(true), cancelled: z.number(), stopped: z.array(z.string()) });

// The project doctor (`hub project doctor`) as the Project screen's health view. It lives with the send contract: its facts
// are the send policy (Settings ▸ Sending). Checks that need Mail or Notion are not run by the server and show as skipped.
export const doctorCheckDto = z.object({ name: z.string(), outcome: z.enum(["pass", "warn", "fail", "skipped"]), detail: z.string() });
/**
 * What Settings ▸ Sending and Overview's setup part show about the project: the status, the Mail accounts, who a draft may go to
 * (`draft.recipients`; a list is said as its size, never its addresses: decision 0013) and autosend (P70: `send.mode`, the classes
 * it may send, the daily cap). The last two are the send policy (P49 S11), changed only by `hub send policy set` in a person's shell.
 */
export const doctorFactsDto = z.object({
  status: z.string(),
  accounts: z.array(z.string()),
  recipients: z.enum(["test", "any", "list"]),
  listed: z.number().int(),
  autosend: z.object({ mode: z.string(), classes: z.array(z.string()), dailyCap: z.number().int() }),
});
export const doctorDto = z.object({ state: z.enum(["ok", "absent"]), checks: z.array(doctorCheckDto), facts: doctorFactsDto.nullable() });
export type DoctorDto = z.infer<typeof doctorDto>;

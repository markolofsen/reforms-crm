import { z } from "zod";
import { safetyResultDto } from "./review";

// The Mail draft as Mail holds it now and the Tidy of the Hub's leftovers (P56, P105).

/**
 * The Mail draft as it is right now, read on demand by its Message-ID and never stored (decision 0013, P27 M2). `hash` is
 * what Checked binds to; `safetyResults` are the checks run on this live text, so the card shows what would really go out.
 */
export const draftMailDto = z.object({
  /** False when this server has no Mailer (Mail-only mode): nothing can be read, and that is not a fault of the draft. */
  configured: z.boolean(),
  found: z.boolean(),
  /** Why the text could not be read (not found, Mail closed). Null when found. */
  reason: z.string().nullable(),
  /**
   * Found, but Mail holds more than one version (P53): which one is shown and what to delete. Such a read has no `hash`,
   * so it cannot be Checked and the send refuses it. Optional for a server older than API 10.
   */
  note: z.string().nullable().optional(),
  /** Found, and other drafts with this subject exist that the hub did not write for this thread (P56): named, never touched, never sent. Optional before API 11. */
  aside: z.string().nullable().optional(),
  /**
   * Not found, and Mail answered: no draft for it at all (P56). `trashRef` is the newest copy the hub wrote for this
   * thread that is in Mail's Trash (what Restore writes again), else null. Optional before API 11.
   */
  gone: z.object({ trashRef: z.string().nullable() }).nullable().optional(),
  /** Whether Checked is bound to this very text (the row's hash equals this read's); false after any revision. Optional before API 11. */
  checkedCurrent: z.boolean().optional(),
  /** The From header the client will see: Mail's own read of the draft (P58). */
  from: z.string().nullable(),
  /** P58 R1: the Mail draft's own Message-ID, bare (what Open draft in Mail links to); null when Mail gave none. Optional before API 22. */
  messageId: z.string().nullable().optional(),
  to: z.array(z.string()),
  cc: z.array(z.string()),
  subject: z.string(),
  body: z.string(),
  hash: z.string().nullable(),
  safetyResults: z.array(safetyResultDto),
  readAt: z.string(),
});
export type DraftMailDto = z.infer<typeof draftMailDto>;

/** P105: what Tidy moved to Mail's Trash (the Hub's own leftover drafts of the project), and what Mail refused because it changed since the read. */
export const mailTidyDto = z.object({ ok: z.literal(true), moved: z.number().int(), refused: z.number().int() });
export type MailTidyDto = z.infer<typeof mailTidyDto>;

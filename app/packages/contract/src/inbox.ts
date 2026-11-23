import { z } from "zod";
import { INBOX_ACTIONS, INBOX_FILTERS, INBOX_KINDS, NOTION_KINDS } from "@hub/config";

// The clients the agent did not answer by email (a View of Mail, P48).
const iso = z.string();
const nullableIso = z.string().nullable();
const filterCounts = <K extends readonly [string, ...string[]]>(keys: K) => z.record(z.enum(keys), z.number());

/** One client the agent touched in a triage (`client_record` / `draft_write`). No mail text: the body is read from Mail on demand. */
export const inboxRowDto = z.object({
  id: z.number(),
  email: z.string(),
  name: z.string(),
  subject: z.string().nullable(),
  mailRef: z.string().nullable(),
  lastInboundAt: nullableIso,
  mailClass: z.string().nullable(),
  action: z.enum(INBOX_ACTIONS),
  reason: z.string().nullable(),
  kind: z.enum(INBOX_KINDS).nullable(),
  phone: z.string().nullable(),
  /** The reply is still owed: the agent left it to the owner and no open draft exists. */
  owed: z.boolean(),
  openDraftId: z.number().nullable(),
  notionKind: z.enum(NOTION_KINDS).nullable(),
  notionPageId: z.string().nullable(),
  notionUrl: z.string().nullable(),
  skill: z.string().nullable(),
  firstSeenAt: iso,
  recordedAt: iso,
});
export type InboxRowDto = z.infer<typeof inboxRowDto>;
export const inboxDto = z.object({
  rows: z.array(inboxRowDto),
  counts: filterCounts(INBOX_FILTERS),
  /** When the agent last recorded a client; null = no triage was ever recorded for the project. */
  lastTriageAt: nullableIso,
  total: z.number(),
});
export type InboxDto = z.infer<typeof inboxDto>;
/** The clients not answered by email (P27 M6): read-only, grouped by why. */
export const notByEmailDto = z.object({ rows: z.array(inboxRowDto), counts: z.object({ call: z.number(), no_action: z.number(), crossed_off: z.number(), unknown_sender: z.number() }), total: z.number() });
export type NotByEmailDto = z.infer<typeof notByEmailDto>;

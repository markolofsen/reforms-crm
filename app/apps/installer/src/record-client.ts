import { INBOX_ACTIONS } from "@hub/config";
import { createRepos, defaultDbPath, openDb, RepoError, type InboxInput } from "@hub/db";
import { z } from "zod";
import { notionRef } from "./record-draft";
import type { RecordOutcome } from "./record-draft";

// `hub record-client --project <slug>`: the triage session reports a client it handled WITHOUT leaving a draft
// (skipped, escalated, suspected injection), so the admin's inbox shows who was seen and why (P26, decision 0009).
// Nothing of the mail is stored: no body, no excerpt (decision 0013). `hub record-draft` records the drafted ones itself.

const text = (max: number) => z.string().trim().min(1).max(max);
const when = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), "not a date")
  .transform((v) => new Date(v).toISOString());

/** Unknown keys are refused, so a pasted body or an `excerpt` fails instead of being silently dropped. */
export const clientInput = z
  .object({
    email: z.string().trim().max(320).email(),
    name: text(200).optional(),
    action: z.enum(INBOX_ACTIONS),
    reason: text(500).nullish(),
    subject: text(300).nullish(),
    mailRef: text(500).nullish(),
    lastInboundAt: when.nullish(),
    mailClass: text(60).nullish(),
    /** Defaults from the action: false for skipped, true otherwise. */
    repliesOwed: z.boolean().optional(),
    notion: notionRef,
    skill: text(60).nullish(),
    runId: z.number().int().positive().nullish(),
  })
  .strict();

const slug = z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/, "project must be a slug such as acme-travel");
const isBusy = (e: unknown) => {
  const x = e as { code?: string; message?: string };
  return x?.code === "SQLITE_BUSY" || x?.code === "SQLITE_LOCKED" || /database is locked/i.test(x?.message ?? "");
};

export interface RecordClientOptions {
  project: string;
  payload: string;
  dbPath?: string;
  now?: () => Date;
}

/** Validates, writes the inbox row, returns ONE JSON line. Exit 0 only when it says `"ok":true`; 2 for a bad project or payload; 1 for a failed write. */
export async function recordClient(o: RecordClientOptions): Promise<RecordOutcome> {
  const fail = (code: 1 | 2, error: string, extra: Record<string, unknown> = {}): RecordOutcome => ({ code, line: JSON.stringify({ ok: false, error, ...extra }) });
  const project = slug.safeParse(o.project);
  if (!project.success) return fail(2, project.error.issues[0]?.message ?? "bad project");
  let raw: unknown;
  try { raw = JSON.parse(o.payload); } catch { return fail(2, "stdin is not JSON"); }
  const parsed = clientInput.safeParse(raw);
  if (!parsed.success) return fail(2, parsed.error.issues.map((i) => `${i.path.join(".") || "payload"}: ${i.message}`).join("; "));
  const v = parsed.data;
  const input: InboxInput = {
    project: project.data,
    email: v.email,
    name: v.name ?? v.email,
    action: v.action,
    reason: v.reason ?? null,
    subject: v.subject ?? null,
    mailRef: v.mailRef ?? null,
    lastInboundAt: v.lastInboundAt ?? null,
    mailClass: v.mailClass ?? null,
    ...(v.repliesOwed !== undefined ? { repliesOwed: v.repliesOwed } : {}),
    notion: v.notion,
    skill: v.skill ?? null,
    runId: v.runId ?? null,
  };
  let handle: ReturnType<typeof openDb> | undefined;
  try {
    handle = openDb(o.dbPath ?? defaultDbPath());
    const r = await createRepos(handle.db).inbox.record(input, o.now?.() ?? new Date());
    return { code: 0, line: JSON.stringify({ ok: true, ...r }) };
  } catch (e) {
    if (e instanceof RepoError) return fail(1, e.message, { code: e.code });
    return fail(1, isBusy(e) ? "the database is busy: try again in a moment" : e instanceof Error ? e.message : String(e), isBusy(e) ? { code: "busy" } : {});
  } finally {
    handle?.close();
  }
}

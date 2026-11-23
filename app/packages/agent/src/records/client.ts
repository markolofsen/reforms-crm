import { createRepos, openDb, RepoError, type InboxInput, type InboxResult } from "@hub/db";
import type { ClientRecord } from "./schema";

// `client_record` (P129 verdict 4, decision 0045 point 10): a client the session handled WITHOUT a draft (skipped,
// escalated, injection suspected, a call), so Mail and Activity show who was seen and why (P26). Nothing of the mail is
// stored: no body, no excerpt (decision 0013). Replaces `hub record-client`; one short write connection per call.

export type ClientRecordOutcome = ({ ok: true } & InboxResult) | { ok: false; code: "record_failed" | "busy"; error: string };

export async function recordClientCall(project: string, v: ClientRecord, o: { dbPath: string; now?: () => Date }): Promise<ClientRecordOutcome> {
  const input: InboxInput = {
    project,
    email: v.email,
    name: v.name ?? v.email,
    action: v.action,
    reason: v.reason ?? null,
    kind: v.kind ?? null,
    phone: v.phone ?? null,
    subject: v.subject ?? null,
    mailRef: v.mail_ref ?? null,
    lastInboundAt: v.last_inbound_at ?? null,
    mailClass: v.mail_class ?? null,
    ...(v.replies_owed !== undefined ? { repliesOwed: v.replies_owed } : {}),
    notion: v.notion,
    skill: v.skill ?? null,
    runId: v.run_id ?? null,
    batchKey: v.batch_key ?? null,
  };
  let handle: ReturnType<typeof openDb> | undefined;
  try {
    handle = openDb(o.dbPath);
    const r = await createRepos(handle.db).inbox.record(input, o.now?.() ?? new Date());
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof RepoError) return { ok: false, code: "record_failed", error: e.message };
    const code = e && typeof e === "object" && "code" in e ? e.code : undefined;
    if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") return { ok: false, code: "busy", error: "the database is busy: try again in a moment" };
    return { ok: false, code: "record_failed", error: e instanceof Error ? e.message : String(e) };
  } finally {
    handle?.close();
  }
}

import { hubPaths } from "@hub/config/paths";
import { recordDraftCall, type DraftRecordEnv, type DraftRecordOutcome } from "@hub/agent/records/draft";
import { draftRecord } from "@hub/agent/records/schema";

// The test seeder's body (e2e and unit tests): a flat payload in the shape the flows always used (email, subject, mailRef
// or newThread, ownerRequest, and the record's fields in camelCase), mapped onto `draft_write`'s record and written by the
// same writer `draft_write` calls after Mail saved a draft (P129 A3). Test only: no skill or rule names it.

const SNAKE: Record<string, string> = { mailClass: "mail_class", lastContactAt: "last_contact_at", repliesOwed: "replies_owed", injectionSuspected: "injection_suspected", runId: "run_id" };
const CALL_KEYS = new Set(["email", "subject", "mailRef", "newThread", "ownerRequest"]);

const entries = (v: unknown): Array<[string, unknown]> => (v && typeof v === "object" ? Object.entries(v) : []);

/** Records one flat payload; a payload the record schema refuses is `record_invalid`, as `draft_write` refuses it. */
export async function recordFlat(project: string, payload: object, env: DraftRecordEnv, o: { brand?: string | null; wroteTo?: string | null } = {}): Promise<DraftRecordOutcome> {
  const j = Object.fromEntries(entries(payload));
  const rec: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(j)) if (!CALL_KEYS.has(k)) rec[SNAKE[k] ?? k] = v;
  if (rec.notion && typeof rec.notion === "object") rec.notion = Object.fromEntries(entries(rec.notion).map(([k, v]) => [k === "pageId" ? "page_id" : k, v]));
  if (rec.sequence && typeof rec.sequence === "object") rec.sequence = Object.fromEntries(entries(rec.sequence).map(([k, v]) => [k === "enrollmentId" ? "enrollment_id" : k, v]));
  const record = draftRecord.safeParse(rec);
  if (!record.success) return { ok: false, code: "record_invalid", error: record.error.issues.map((i) => `${i.path.join(".") || "record"}: ${i.message}`).join("; ") };
  if (typeof j.email !== "string" || typeof j.subject !== "string") return { ok: false, code: "record_invalid", error: "email and subject are required" };
  if ((j.mailRef === undefined) === (j.newThread !== true)) return { ok: false, code: "record_invalid", error: "give mailRef or newThread, exactly one" };
  return recordDraftCall({ project, email: j.email, subject: j.subject, mailRef: j.newThread === true ? null : String(j.mailRef), ownerRequest: typeof j.ownerRequest === "string" ? j.ownerRequest : null, record: record.data, brand: o.brand ?? null, wroteTo: o.wroteTo ?? null }, env);
}

/** `seed-draft.mjs`: the instance from `HUB_HOME` / `HUB_DB` / `HUB_PROJECTS`, as `hub mcp` resolves it. */
export async function seedDraft(project: string, text: string): Promise<DraftRecordOutcome> {
  const paths = hubPaths();
  const parsed: unknown = JSON.parse(text);
  return recordFlat(project, parsed && typeof parsed === "object" ? parsed : {}, { dbPath: paths.db, projectsDir: paths.projects, policyDir: paths.stateProjects, configFile: paths.configFile });
}

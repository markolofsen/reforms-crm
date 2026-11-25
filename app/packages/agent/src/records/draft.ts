import { newThreadKey, SEQUENCE_SKILL, type DraftFinding } from "@hub/config";
import { createRepos, openDb, RepoError, type RecordDraftInput, type RecordDraftResult } from "@hub/db";
import { checkDraftRecipients, readAllowList } from "@hub/projects/guard";
import { kindOf } from "@hub/projects/kinds";
import { projectStore } from "@hub/projects/store";
import { addressesOf, otherBrandFacts, previousRevision } from "./checks";
import type { DraftRecord } from "./schema";

// The one writer of a draft record from a session (decision 0009 as amended by 0045 point 10): `draft_write` calls it after
// Mail saved the reply; `hub record-draft` is gone. The mail text is not stored; Mail holds the one copy. A short write
// connection per record (the hub MCP server's handle stays read-only); WAL plus a busy timeout share the file with `hub up`.

/** What the tool knows of the draft it just wrote, beside the agent's `record`. */
export interface DraftRecordCall {
  project: string;
  email: string;
  subject: string;
  /** The Message-ID of the message answered; null for a new thread. */
  mailRef: string | null;
  /** The owner's words, as the call passed them. */
  ownerRequest: string | null;
  record: DraftRecord;
  /** P140 R3: the brand and the address the client wrote to that the signer resolved for the version this record is for (never another write's). */
  brand: string | null;
  wroteTo: string | null;
  /** P142: the nudge's number when the draft is a follow-up (`draft_write`'s `follow_up`). */
  followUpN?: number | null;
  /** P147: a lead pass draft (a lead turn's, or an attended pass's): it joins the day's lead batch and is stamped on its lead. */
  leadPass?: { pageId: string; passId: number | null; day: string } | null;
  mailPass?: { inboundId: number; passId: number | null; day: string } | null;
  /** P145 B4: a fixed bug's mail note (the sweep's claim): it joins the day's lead batch and is stamped on its note. */
  bugNote?: { noteId: number; day: string } | null;
}

export interface DraftRecordEnv {
  dbPath: string;
  /** When set, the project's `draft.recipients` rule is enforced on To, Cc and the client address. */
  projectsDir?: string;
  policyDir?: string;
  configFile?: string;
  attempts?: number;
  retryMs?: number;
}

export type RecordRefusalCode = "record_invalid" | "not_allowed" | "busy" | "record_failed";
export type DraftRecordOutcome =
  | ({ ok: true; warnings: string[]; notice?: string } & RecordDraftResult)
  | { ok: false; code: RecordRefusalCode; error: string; blocked?: string[]; warnings?: string[] };

const isBusy = (e: unknown): boolean => {
  const code = e && typeof e === "object" && "code" in e ? e.code : undefined;
  return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" || (e instanceof Error && /database is locked/i.test(e.message));
};
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function recordDraftCall(c: DraftRecordCall, o: DraftRecordEnv): Promise<DraftRecordOutcome> {
  const r = c.record;
  const newThread = c.mailRef === null;
  if (newThread && !c.ownerRequest?.trim()) return { ok: false, code: "record_invalid", error: "a new thread is recorded only with owner_request: the owner's own words that asked for it" };
  if (r.sequence && r.skill !== SEQUENCE_SKILL) return { ok: false, code: "record_invalid", error: `a follow-up step (record.sequence) is recorded with skill "${SEQUENCE_SKILL}"` };
  const ref = c.mailRef ?? newThreadKey(c.email);
  // P52: a revision of the client's open draft (same mailRef) keeps what the agent did not restate.
  const prev = await previousRevision(o.dbPath, c.project, c.email, ref);
  const nameGiven = r.name && r.name.trim().toLowerCase() !== c.email.trim().toLowerCase() ? r.name : undefined;
  const inherited = !r.context && prev?.context ? prev.context : undefined;
  const context = r.context ?? inherited;
  const name = nameGiven ?? prev?.name ?? c.email;
  const notion = r.notion ?? prev?.notion ?? null;
  const to = r.to ?? prev?.to ?? null;
  const cc = r.cc ?? prev?.cc ?? null;
  const mailClass = r.mail_class ?? prev?.mailClass ?? null;
  const input: RecordDraftInput = {
    project: c.project,
    email: c.email,
    name,
    subject: c.subject,
    mailRef: c.mailRef,
    ...(newThread ? { newThread: true } : {}),
    to,
    cc,
    reason: r.reason ?? prev?.reason ?? null,
    notion,
    excerpt: r.excerpt ?? null,
    ...(r.last_contact_at !== undefined && r.last_contact_at !== null ? { lastContactAt: r.last_contact_at } : {}),
    ...(r.replies_owed !== undefined ? { repliesOwed: r.replies_owed } : {}),
    ...(r.marks ? { marks: r.marks } : {}),
    skill: r.skill ?? null,
    ...(r.injection_suspected !== undefined ? { injectionSuspected: r.injection_suspected } : {}),
    mailClass,
    runId: r.run_id ?? null,
    ...(r.sequence ? { sequence: { enrollmentId: r.sequence.enrollment_id, step: r.sequence.step } } : {}),
    ...(c.ownerRequest ? { ownerRequest: c.ownerRequest } : {}),
    // P58/P60, P140 R3: the brand and the address the client wrote to come from the version's signer, never from the record.
    brand: c.brand,
    wroteTo: c.wroteTo,
    ...(c.followUpN != null ? { followUpN: c.followUpN } : {}),
    ...(c.leadPass ? { leadPass: c.leadPass } : {}),
    ...(c.mailPass ? { mailPass: c.mailPass } : {}),
    ...(c.bugNote ? { bugNote: c.bugNote } : {}),
  };

  let brandScope = false;
  if (o.projectsDir) {
    let loaded;
    try { loaded = projectStore({ projects: o.projectsDir, ...(o.policyDir ? { stateProjects: o.policyDir } : {}) }).file(c.project); }
    catch (e) { return { ok: false, code: "not_allowed", error: e instanceof Error ? e.message : String(e) }; }
    const kind = kindOf(loaded.parsed.config.kind);
    if (mailClass && kind && !kind.mailClasses.some((m) => m.id === mailClass)) {
      return { ok: false, code: "record_invalid", error: `record.mail_class "${mailClass}" is not a class of kind ${kind.id} (${kind.mailClasses.map((m) => m.id).join(", ")})` };
    }
    // The draft goes to `to` (or to the client when `to` is empty) and to `cc`: every address must pass.
    const g = checkDraftRecipients(loaded.parsed.config, addressesOf(to ?? c.email, cc), o.configFile ? readAllowList(o.configFile) : []);
    if (!g.ok) return { ok: false, code: "not_allowed", error: `draft.recipients of ${c.project} does not permit ${g.blocked.join(", ")}`, blocked: g.blocked };
    brandScope = loaded.parsed.config.knowledge.scope === "by-brand";
  }

  // P140 K2 (owner, 2026-11-24): what the draft was based on is the agent's statement, stored for the card and never judged. The
  // one check left is P60's: in a by-brand project every knowledge entry used must list the draft's brand (the version's) or ANY.
  const findings: DraftFinding[] = brandScope && context?.facts.used.length ? (await otherBrandFacts(o.dbPath, c.project, context.facts.used, c.brand)).map((x) => ({ code: x.code, text: x.text, amber: x.amber })) : [];
  const warnings = findings.map((x) => `${x.code}: ${x.text}`);
  input.context = context ?? null;
  input.findings = findings;
  input.batchKey = context?.batchKey ?? null;

  const attempts = o.attempts ?? 3;
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    let handle: ReturnType<typeof openDb> | undefined;
    try {
      handle = openDb(o.dbPath);
      const res = await createRepos(handle.db).drafts.record(input);
      return { ok: true, ...res, warnings, ...(notion ? {} : { notice: 'record.notion not stated: pass {"kind":"client"|"lead"|"none"} so the card can link the page' }) };
    } catch (e) {
      last = e;
      if (e instanceof RepoError) return { ok: false, code: "record_failed", error: e.message };
      if (!isBusy(e)) break;
      if (i < attempts) await wait(o.retryMs ?? 1000);
    } finally {
      handle?.close();
    }
  }
  return isBusy(last) ? { ok: false, code: "busy", error: "the database is busy: try again in a moment" } : { ok: false, code: "record_failed", error: last instanceof Error ? last.message : String(last) };
}

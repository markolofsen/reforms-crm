import { newThreadKey, SEQUENCE_SKILL, type EvidenceLevel } from "@hub/config";
import { createRepos, openDb, RepoError, type RecordDraftInput, type RecordDraftResult } from "@hub/db";
import { checkContext, contextMode, type ContextMode, type PriorRecord, type Violation } from "@hub/projects/context";
import { checkDraftRecipients, readAllowList } from "@hub/projects/guard";
import { judgeSimilarity, measureAgainstSet, SIM_AMBER } from "@hub/projects/similarity";
import { kindOf } from "@hub/projects/kinds";
import { projectStore } from "@hub/projects/store";
import { appendLine, readLines, recordsFile } from "../evidence/store";
import { addressesOf, crossCheck, otherBrandFacts, previousRevision, type RecordLine } from "./checks";
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
  /** True when `ownerRequest` was found in this project's session log (P129 verdict 7): the draft rests on his words. */
  ownerVerified: boolean;
  record: DraftRecord;
}

export interface DraftRecordEnv {
  dbPath: string;
  /** When set, the project's `draft.recipients` rule is enforced on To, Cc and the client address. */
  projectsDir?: string;
  policyDir?: string;
  configFile?: string;
  /** The instance root whose state/evidence/ holds the ledger. Without it no ledger is read or written. */
  ledgerRoot?: string;
  now?: () => Date;
  attempts?: number;
  retryMs?: number;
}

export type RecordRefusalCode = "record_invalid" | "not_allowed" | "context_refused" | "busy" | "record_failed";
export type DraftRecordOutcome =
  | ({ ok: true; evidence: EvidenceLevel; source: "observed" | "claimed"; warnings: string[]; similarTo: string | null; notice?: string } & RecordDraftResult)
  | { ok: false; code: RecordRefusalCode; error: string; blocked?: string[]; warnings?: string[] };

/** Findings about the chain (thread, profile) that a draft on the owner's verified words does not need. */
const CHAIN_CODES = new Set(["context-missing", "no-thread-read", "first-contact-claim", "no-profile-read", "profile-stale"]);

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
  const ledger = o.ledgerRoot ? readLines<RecordLine>(recordsFile(o.ledgerRoot, c.project)) : [];
  const prev = await previousRevision(o.dbPath, c.project, c.email, ref, ledger);
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
  };

  let required: ContextMode | null = null;
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
    required = loaded.parsed.config.context.required;
    brandScope = loaded.parsed.config.knowledge.scope === "by-brand";
  }

  // P28: the evidence block. warn records and reports; block refuses before anything is written.
  const mode = contextMode(required, o.now?.() ?? new Date());
  const emailKey = c.email.trim().toLowerCase();
  const batchKey = context?.batchKey;
  const batchPeers = batchKey ? ledger.filter((l) => l.batchKey === batchKey && l.email !== emailKey) : [];
  const prior: PriorRecord[] = batchPeers.flatMap((l) => (l.context ? [{ email: l.email, anchors: l.context.anchors, ...(l.context.personalization ? { personalization: l.context.personalization } : {}) }] : []));
  const checked = checkContext(context, { lastContactAt: input.lastContactAt ?? null, repliesOwed: input.repliesOwed }, prior);
  // P129 verdict 7: on the owner's verified words the chain is not asked for; the rest of the rules still hold.
  const violations: Violation[] = checked.violations.filter((x) => !(c.ownerVerified && (x.missing || CHAIN_CODES.has(x.code))));
  let source: "observed" | "claimed" = "claimed";
  let fp: number[] | undefined;
  let observed: RecordLine["observed"];
  let similarTo: string | null = null;
  let draftHash: string | undefined;
  if (o.ledgerRoot) {
    const claimed = new Set(ledger.map((l) => l.draftHash ?? ""));
    const x = crossCheck(o.ledgerRoot, c.project, emailKey, inherited ? undefined : context, claimed);
    if (x.entry) {
      source = "observed";
      // P58/P60: the brand and the address the client wrote to come from the writer's own result, never from the record.
      if (x.entry.wroteTo !== undefined) input.wroteTo = x.entry.wroteTo;
      if (x.entry.brand !== undefined) input.brand = x.entry.brand;
      observed = x.observed;
      draftHash = x.entry.hash;
      if (x.entry.fp?.length) fp = x.entry.fp;
      violations.push(...x.violations);
    }
    if (fp && batchPeers.length) {
      const set = [...batchPeers.flatMap((l) => (l.fp?.length ? [{ id: l.email, fp: l.fp }] : [])), { id: emailKey, fp }];
      const m = measureAgainstSet(emailKey, set);
      similarTo = m.maxSim >= SIM_AMBER ? m.similarTo : null;
      const j = judgeSimilarity({ maxSim: m.maxSim, ...(m.residue !== undefined ? { residue: m.residue } : {}) });
      for (const reason of j.reasons) violations.push({ code: j.level === "red" ? "near-duplicate" : "similar-to-another", text: `${reason}${m.similarTo ? `; closest: ${m.similarTo}` : ""}`, amber: j.level !== "red" });
    }
  }
  // P60 B3: in a by-brand project every knowledge entry used must list the draft's brand (from the writer's result) or ANY.
  if (brandScope && context?.facts.used.length) violations.push(...(await otherBrandFacts(o.dbPath, c.project, context.facts.used, input.brand ?? null)));
  const evidence: EvidenceLevel = violations.some((x) => x.missing) ? "missing" : violations.length ? "weak" : "ok";
  const warnings = violations.map((x) => `${x.code}: ${x.text}`);
  const refusals = violations.filter((x) => !x.amber);
  if (mode === "block" && refusals.length) return { ok: false, code: "context_refused", error: `context.required is block: ${refusals.map((x) => `${x.code}: ${x.text}`).join("; ")}`, warnings };

  // The stored evidence: what the draft was based on, so the card can say it. Sketches only; never the reply text.
  input.evidence = { level: evidence, source, findings: violations.map((x) => ({ code: x.code, text: x.text, amber: x.amber })), ...(context ? { context } : {}), similarTo, fingerprint: fp ?? null, batchKey: batchKey ?? null };

  const attempts = o.attempts ?? 3;
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    let handle: ReturnType<typeof openDb> | undefined;
    try {
      handle = openDb(o.dbPath);
      const res = await createRepos(handle.db).drafts.record(input);
      if (o.ledgerRoot) {
        try {
          const line: RecordLine = { at: (o.now?.() ?? new Date()).toISOString(), ...(batchKey ? { batchKey } : {}), email: emailKey, name, mailRef: ref, draftId: res.draftId, evidence, source, warnings, ...(context ? { context } : {}), ...(fp ? { fp } : {}), ...(draftHash ? { draftHash } : {}), ...(observed ? { observed } : {}) };
          appendLine(recordsFile(o.ledgerRoot, c.project), line);
        } catch { /* the ledger is evidence, not a precondition: the draft is recorded */ }
      }
      return { ok: true, ...res, evidence, source, warnings, similarTo, ...(notion ? {} : { notice: 'record.notion not stated: pass {"kind":"client"|"lead"|"none"} so the card can link the page' }) };
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

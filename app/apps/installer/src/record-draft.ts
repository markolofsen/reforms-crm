import { MARKS, NOTION_KINDS } from "@hub/config";
import { createRepos, defaultDbPath, openDb, RepoError, type RecordDraftInput } from "@hub/db";
import { checkContext, contextMode, contextSchema, judgeSimilarity, measureAgainstSet, observeDraft, SIM_AMBER, type Context, type ContextMode, type Evidence, type LedgerEntry, type PriorRecord, type Violation, checkDraftRecipients, kindOf, loadProject } from "@hub/projects";
import { appendLine, latestSession, readLines, recordsFile } from "./evidence-store";
import { readFileSync } from "node:fs";
import { z } from "zod";

// `hub record-draft --project <slug>`: the one writer from a Claude session into the admin database (decision 0009).
// A session that left an UNSENT draft in Mail reports it here, with what it already read: who, the subject, the mail
// reference. The mail text is not stored; Mail holds the one copy. Direct write through @hub/db (no server needed:
// manual mode runs without one); WAL plus a busy timeout let it share the file with `hub up`.

const text = (max: number) => z.string().trim().min(1).max(max);
const when = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), "not a date")
  .transform((v) => new Date(v).toISOString());

/**
 * The client's Notion page, always stated: `client` (a row of the Clients database), `lead` (a lead page) or `none`
 * (the client has no page yet). A page needs its id or its link; `none` carries neither.
 */
export const notionRef = z
  .object({
    kind: z.enum(NOTION_KINDS),
    pageId: z.string().trim().regex(/^[0-9a-f]{32}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "pageId is the 32-hex page id").nullish(),
    url: z.string().trim().max(1000).url().nullish(),
  })
  .strict()
  .superRefine((n, ctx) => {
    const has = Boolean(n.pageId || n.url);
    if (n.kind === "none" && has) ctx.addIssue({ code: "custom", message: 'kind "none" carries no pageId or url' });
    if (n.kind !== "none" && !has) ctx.addIssue({ code: "custom", message: `kind "${n.kind}" needs pageId or url` });
  })
  .transform((n) => ({ kind: n.kind, pageId: n.pageId ? n.pageId.replace(/-/g, "").toLowerCase() : null, url: n.url ?? null }));

/** Same limits as the bulk route (subject 300, reason 1500, mailRef 500). Unknown keys are refused: a typo must not be silently dropped. */
export const recordInput = z
  .object({
    email: z.string().trim().max(320).email(),
    name: text(200).optional(),
    subject: text(300),
    mailRef: text(500),
    to: text(320).nullish(),
    cc: text(1000).nullish(),
    reason: text(1500).nullish(),
    /** Always state it: a client with no page says `{"kind":"none"}`. Left out, the card shows no Notion link and the result line warns. */
    notion: notionRef.optional(),
    excerpt: text(240).nullish(),
    lastContactAt: when.nullish(),
    repliesOwed: z.boolean().optional(),
    marks: z.array(z.enum(MARKS)).max(MARKS.length).optional(),
    skill: text(60).nullish(),
    /** The mail this draft answers was flagged `injection_suspected`: the hub then never sends the draft. */
    injectionSuspected: z.boolean().optional(),
    /** Mail class of the project's kind (`client`, `billing`, ...): checked against the kind when the project is loaded. */
    mailClass: text(60).nullish(),
    runId: z.number().int().positive().nullish(),
    /** What was read before the draft (P28, research 15 section 3.1). Rules V1 to V5 judge it; `context.required` decides whether a failure refuses. */
    context: contextSchema.optional(),
  })
  .strict();

const slug = z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/, "project must be a slug such as acme-travel");

export type RecordOutcome = { code: 0 | 1 | 2; line: string };

const isBusy = (e: unknown) => {
  const x = e as { code?: string; message?: string };
  return x?.code === "SQLITE_BUSY" || x?.code === "SQLITE_LOCKED" || /database is locked/i.test(x?.message ?? "");
};
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface RecordOptions {
  project: string;
  /** The JSON payload (stdin). */
  payload: string;
  /** Default: the live database (`HUB_DB` or `<HUB_HOME>/data/app.db`). */
  dbPath?: string;
  /** Attempts on a busy database; each one already waits the 5 s busy timeout. Default 3. */
  attempts?: number;
  retryMs?: number;
  /** When set, the project's `draft.recipients` rule is enforced on To, Cc and the client address (decision: tools, not prose). */
  projectsDir?: string;
  /** config/config.json: its `allow_list` is what `draft.recipients: test` means. */
  configFile?: string;
  /** The reforms-crm folder whose state/evidence/ holds the ledger. Without it no ledger is read or written (the cross-check is skipped). */
  ledgerRoot?: string;
  now?: () => Date;
}

/** One line of state/evidence/<slug>/records.jsonl: what a record-draft said and what the ledger observed. No body. */
export interface RecordLine {
  at: string;
  batchKey?: string;
  email: string;
  name: string;
  mailRef: string;
  draftId: number;
  evidence: Evidence;
  source: "observed" | "claimed";
  warnings: string[];
  context?: Context;
  /** Sketch of the reply, from the ledger (the agent cannot send another body than the one it created). */
  fp?: number[];
  /** Hash of the ledger's `create_reply` this record claimed: another record cannot claim it again. */
  draftHash?: string;
  observed?: { read: number; required: number; profile: boolean; facts: number; maxSim: number };
}

/** Compares the claim with the newest session's ledger. Picks the reply of this client (by the address read), else the oldest reply not yet recorded. */
function crossCheck(root: string, slug: string, email: string, ctx: Context | undefined, claimed: Set<string>): { entry?: LedgerEntry; observed?: RecordLine["observed"]; violations: Violation[] } {
  const s = latestSession(root, slug);
  if (!s) return { violations: [] };
  const drafts = s.entries.map((e, i) => ({ e, i })).filter(({ e }) => e.kind === "draft");
  const withClient = drafts.map(({ e, i }) => ({ e, i, ob: observeDraft(s.entries, i) }));
  const hit = [...withClient].reverse().find((x) => x.ob.client === email) ?? withClient.find((x) => !x.ob.client && !claimed.has(x.e.hash ?? ""));
  if (!hit) return { violations: [] };
  const { ob, e } = hit;
  const v: Violation[] = [];
  if (ctx) {
    if (ctx.thread.read > ob.read) v.push({ code: "claim-exceeds-observation", text: `claims ${ctx.thread.read} message(s) read, the session opened ${ob.read}`, amber: true });
    if (ctx.profile.read && !ob.profile) v.push({ code: "claim-exceeds-observation", text: "claims the profile was read, the session did not read it", amber: true });
    if (ctx.facts.queries > ob.facts) v.push({ code: "claim-exceeds-observation", text: `claims ${ctx.facts.queries} knowledge search(es), the session ran ${ob.facts}`, amber: true });
    if (e.figure && !e.placeholder && ctx.facts.used.length === 0) v.push({ code: "fact-without-source", text: "the body states a figure or date but no knowledge entry is listed", amber: true });
  }
  return { entry: e, observed: { read: ob.read, required: ob.required, profile: ob.profile, facts: ob.facts, maxSim: ob.maxSim }, violations: v };
}

const ADDRESS = /[^\s,;<>"']+@[^\s,;<>"']+/g;
const addressesOf = (...fields: Array<string | null | undefined>): string[] => fields.flatMap((f) => f?.match(ADDRESS) ?? []);

function allowList(file: string | undefined): string[] {
  if (!file) return [];
  try {
    const j = JSON.parse(readFileSync(file, "utf8")) as { allow_list?: unknown };
    return Array.isArray(j.allow_list) ? j.allow_list.filter((a): a is string => typeof a === "string") : [];
  } catch { return []; }
}

/**
 * Validates, writes, and returns ONE JSON line. Exit code 0 only when the line says `"ok":true`; 2 for a bad project
 * or payload (nothing written); 1 for a failure while writing. The skill must report a non-ok line, never retry in a loop.
 */
export async function recordDraft(o: RecordOptions): Promise<RecordOutcome> {
  const fail = (code: 1 | 2, error: string, extra: Record<string, unknown> = {}): RecordOutcome => ({ code, line: JSON.stringify({ ok: false, error, ...extra }) });

  const project = slug.safeParse(o.project);
  if (!project.success) return fail(2, project.error.issues[0]?.message ?? "bad project");
  let raw: unknown;
  try {
    raw = JSON.parse(o.payload);
  } catch {
    return fail(2, "stdin is not JSON");
  }
  const parsed = recordInput.safeParse(raw);
  if (!parsed.success) {
    return fail(2, parsed.error.issues.map((i) => `${i.path.join(".") || "payload"}: ${i.message}`).join("; "));
  }
  const v = parsed.data;
  const input: RecordDraftInput = {
    project: project.data,
    email: v.email,
    name: v.name ?? v.email,
    subject: v.subject,
    mailRef: v.mailRef,
    to: v.to ?? null,
    cc: v.cc ?? null,
    reason: v.reason ?? null,
    notion: v.notion ?? null,
    excerpt: v.excerpt ?? null,
    ...(v.lastContactAt !== undefined ? { lastContactAt: v.lastContactAt } : {}),
    ...(v.repliesOwed !== undefined ? { repliesOwed: v.repliesOwed } : {}),
    ...(v.marks ? { marks: v.marks } : {}),
    skill: v.skill ?? null,
    ...(v.injectionSuspected !== undefined ? { injectionSuspected: v.injectionSuspected } : {}),
    mailClass: v.mailClass ?? null,
    runId: v.runId ?? null,
  };

  let required: ContextMode | null = null;
  if (o.projectsDir) {
    let loaded;
    try { loaded = loadProject(o.projectsDir, project.data); }
    catch (e) { return fail(2, `not allowed: ${(e as Error).message}`); }
    const kind = kindOf(loaded.parsed.config.kind);
    if (v.mailClass && kind && !kind.mailClasses.some((c) => c.id === v.mailClass)) {
      return fail(2, `mailClass "${v.mailClass}" is not a class of kind ${kind.id} (${kind.mailClasses.map((c) => c.id).join(", ")})`);
    }
    // The draft goes to `to` (or to the client when `to` is empty) and to `cc`: every address must pass.
    const g = checkDraftRecipients(loaded.parsed.config, addressesOf(v.to ?? v.email, v.cc), allowList(o.configFile));
    if (!g.ok) return fail(2, `not allowed: draft.recipients of ${project.data} does not permit ${g.blocked.join(", ")}`, { blocked: g.blocked });
    required = loaded.parsed.config.context.required;
  }

  // P28: the evidence block. warn records and reports; block refuses before anything is written.
  const mode = contextMode(required, o.now?.() ?? new Date());
  const emailKey = v.email.trim().toLowerCase();
  const earlier = o.ledgerRoot ? readLines<RecordLine>(recordsFile(o.ledgerRoot, project.data)) : [];
  const batchPeers = v.context?.batchKey ? earlier.filter((r) => r.batchKey === v.context!.batchKey && r.email !== emailKey) : [];
  const prior: PriorRecord[] = batchPeers.flatMap((r) => (r.context ? [{ email: r.email, anchors: r.context.anchors, ...(r.context.personalization ? { personalization: r.context.personalization } : {}) }] : []));
  const checked = checkContext(v.context, { lastContactAt: v.lastContactAt ?? null, repliesOwed: v.repliesOwed }, prior);
  const violations = [...checked.violations];
  let source: "observed" | "claimed" = "claimed";
  let fp: number[] | undefined;
  let observed: RecordLine["observed"];
  let similarTo: string | null = null;
  let draftHash: string | undefined;
  if (o.ledgerRoot) {
    const claimedHashes = new Set(earlier.map((r) => r.draftHash ?? ""));
    const x = crossCheck(o.ledgerRoot, project.data, emailKey, v.context, claimedHashes);
    if (x.entry) {
      source = "observed";
      observed = x.observed;
      draftHash = x.entry.hash;
      if (x.entry.fp?.length) fp = x.entry.fp;
      violations.push(...x.violations);
    }
    if (fp && batchPeers.length) {
      const set = [...batchPeers.filter((r) => r.fp?.length).map((r) => ({ id: r.email, fp: r.fp! })), { id: emailKey, fp }];
      const m = measureAgainstSet(emailKey, set);
      similarTo = m.maxSim >= SIM_AMBER ? m.similarTo : null;
      const j = judgeSimilarity({ maxSim: m.maxSim, ...(m.residue !== undefined ? { residue: m.residue } : {}) });
      for (const reason of j.reasons) violations.push({ code: j.level === "red" ? "near-duplicate" : "similar-to-another", text: `${reason}${m.similarTo ? `; closest: ${m.similarTo}` : ""}`, amber: j.level !== "red" });
    }
  }
  const evidence: Evidence = violations.some((x) => x.missing) ? "missing" : violations.length ? "weak" : "ok";
  const warnings = violations.map((x) => `${x.code}: ${x.text}`);
  const refusals = violations.filter((x) => !x.amber);
  if (mode === "block" && refusals.length) {
    return fail(2, `context refused (context.required is block): ${refusals.map((x) => `${x.code}: ${x.text}`).join("; ")}`, { evidence, warnings, mode });
  }

  // The stored evidence: what the draft was based on, so the card can say it. Sketches only; never the reply text.
  input.evidence = { level: evidence, source, findings: violations.map((x) => ({ code: x.code, text: x.text, amber: x.amber })), ...(v.context ? { context: v.context } : {}), similarTo, fingerprint: fp ?? null, batchKey: v.context?.batchKey ?? null };

  const attempts = o.attempts ?? 3;
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    let handle: ReturnType<typeof openDb> | undefined;
    try {
      handle = openDb(o.dbPath ?? defaultDbPath());
      const r = await createRepos(handle.db).drafts.record(input);
      if (o.ledgerRoot) {
        try {
          const line: RecordLine = { at: (o.now?.() ?? new Date()).toISOString(), ...(v.context?.batchKey ? { batchKey: v.context.batchKey } : {}), email: emailKey, name: v.name ?? v.email, mailRef: v.mailRef, draftId: r.draftId, evidence, source, warnings, ...(v.context ? { context: v.context } : {}), ...(fp ? { fp } : {}), ...(draftHash ? { draftHash } : {}), ...(observed ? { observed } : {}) };
          appendLine(recordsFile(o.ledgerRoot, project.data), line);
        } catch { /* the ledger is evidence, not a precondition: the draft is recorded */ }
      }
      return { code: 0, line: JSON.stringify({ ok: true, ...r, evidence, source, warnings, similarTo, mode, ...(v.notion ? {} : { notice: "notion not stated: pass {\"kind\":\"client\"|\"lead\"|\"none\"} so the card can link the page" }) }) };
    } catch (e) {
      last = e;
      if (e instanceof RepoError) return fail(1, e.message, { code: e.code });
      if (!isBusy(e)) break;
      if (i < attempts) await wait(o.retryMs ?? 1000);
    } finally {
      handle?.close();
    }
  }
  return fail(1, isBusy(last) ? "the database is busy: try again in a moment" : last instanceof Error ? last.message : String(last), isBusy(last) ? { code: "busy" } : {});
}

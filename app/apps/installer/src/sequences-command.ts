import { STOP_REASONS, type StopReason } from "@hub/config";
import { createRepos, defaultDbPath, openDb, RepoError, type EnrollmentItem, type Repos } from "@hub/db";
import { kindOf, loadProject } from "@hub/projects";
import { CORE_STOP_ON, decideStop, findSequence, isUsable, loadSequences, pickSequence, scheduleOf, sequenceErrors, type LoadedSequence, type StopFacts } from "@hub/sequences";
import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { z } from "zod";

// `hub sequences ...` (P47, `@docs/core/23-sequences.md`). Reads and the moves that REDUCE mail (stop, delay, judge) are for
// anyone, the agent included. The moves that start or restart follow-ups (enrol, pause, resume) are the owner's: the P17
// deny rules and the guard refuse them in an agent session, and they refuse themselves when they see one (third layer).

export interface SequencesDeps {
  projectsDir: string;
  dbPath?: string;
  out?: (line: string) => void;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}
type Target = { id?: string; client?: string };

const OWNER_ONLY = "is the owner's step: run it in your own terminal, or use Enrol and the Follow-ups block in the admin's Drafts";
/** An agent session: Claude Code marks its shells `CLAUDECODE=1`; `hub agent` binds them with `HUB_PROJECT`. */
export const inAgentSession = (env: NodeJS.ProcessEnv): boolean => env.CLAUDECODE === "1" || Boolean(env.HUB_PROJECT?.trim());

const json = (o: unknown) => JSON.stringify(o);

function folderOf(d: SequencesDeps, slug: string): string {
  return loadProject(d.projectsDir, slug).folder;
}

async function withRepos<T>(d: SequencesDeps, fn: (r: Repos) => Promise<T>): Promise<T> {
  const h = openDb(d.dbPath ?? defaultDbPath());
  try {
    return await fn(createRepos(h.db));
  } finally {
    h.close();
  }
}

/** What a session needs to draft one due step: who, which step, what it adds, what to reply to. No mail text. */
function dueRow(e: EnrollmentItem, all: readonly LoadedSequence[]) {
  const def = findSequence(all, e.sequence);
  const row = def?.steps[e.step - 1] ?? null;
  return {
    enrollmentId: e.id,
    client: e.client,
    sequence: e.sequence,
    sequenceName: def?.name ?? e.sequence,
    file: `sequences/${e.sequence}.md`,
    step: e.step,
    steps: e.steps,
    lastStep: e.step === e.steps,
    dueAt: e.nextDueAt,
    anchorAt: e.anchorAt,
    replyTo: e.last ? { subject: e.last.subject, mailRef: e.last.mailRef, sentMessageId: e.last.sentMessageId, sentAt: e.last.at } : null,
    stepRow: row,
    optOut: e.step >= 2 ? (def?.optOut ?? null) : null,
    languages: def?.languages ?? [],
    changedSinceEnrolment: def ? def.hash !== e.sequenceHash : true,
  };
}

export function runSequencesList(slug: string, asJson: boolean, d: SequencesDeps): number {
  const out = d.out ?? console.log;
  const all = loadSequences(folderOf(d, slug));
  if (asJson) {
    out(json({ project: slug, sequences: all.map((s) => ({ id: s.id, name: s.name, description: s.description, status: s.status, appliesTo: s.appliesTo, mailClasses: s.mailClasses, steps: s.steps.length, usable: isUsable(s) })) }));
    return 0;
  }
  if (!all.length) {
    out(`${slug}: no sequences (one file per sequence in ${slug}/sequences/; the starter pack is app/projects/_template/sequences/)`);
    return 0;
  }
  for (const s of all) out(`${(s.status ?? "?").padEnd(8)} ${String(s.steps.length).padStart(2)} steps  ${s.id}  ${s.name}${isUsable(s) ? "" : "  (not usable: run `hub sequences check`)"}`);
  return 0;
}

/** Every file parses, and its mail classes are classes of the project's kind. Exit 1 on an error; warnings do not fail. */
export function runSequencesCheck(slug: string, d: SequencesDeps): number {
  const out = d.out ?? console.log;
  const p = loadProject(d.projectsDir, slug);
  const all = loadSequences(p.folder);
  const kind = kindOf(p.parsed.config.kind);
  let extra = 0;
  for (const s of all) {
    for (const i of s.issues) out(`${i.severity} sequences/${s.file}: ${i.message}`);
    for (const c of s.mailClasses) {
      if (kind && !kind.mailClasses.some((m) => m.id === c)) {
        out(`error sequences/${s.file}: mail class "${c}" is not a class of kind ${kind.id}`);
        extra++;
      }
    }
  }
  const errors = sequenceErrors(all) + extra;
  out(errors ? `${slug}: ${errors} error(s) in ${all.length} sequence(s)` : `${slug}: ${all.length} sequence(s) ok`);
  return errors ? 1 : 0;
}

export async function runSequencesDue(slug: string, asJson: boolean, d: SequencesDeps): Promise<number> {
  const out = d.out ?? console.log;
  const all = loadSequences(folderOf(d, slug));
  const rows = await withRepos(d, (r) => r.enrollments.list(slug, "due", d.now?.() ?? new Date()));
  if (asJson) {
    out(json({ project: slug, due: rows.map((e) => dueRow(e, all)) }));
    return 0;
  }
  if (!rows.length) out(`${slug}: no follow-up is due`);
  for (const e of rows) out(`#${e.id}  ${e.client.email}  ${e.sequence} step ${e.step} of ${e.steps}  due ${e.nextDueAt ?? "-"}`);
  return 0;
}

export async function runSequencesCandidates(slug: string, asJson: boolean, d: SequencesDeps): Promise<number> {
  const out = d.out ?? console.log;
  const usable = loadSequences(folderOf(d, slug)).filter(isUsable);
  const rows = usable.length ? await withRepos(d, (r) => r.enrollments.candidates(slug, { now: d.now?.() ?? new Date(), afterDays: Math.min(...usable.map((s) => s.enrolAfterDays)), businessDays: usable.every((s) => s.businessDays) })) : [];
  const list = rows.map((c) => ({ ...c, sequence: pickSequence(usable, { mailClass: c.last.mailClass, notionKind: c.last.notionKind })?.id ?? null }));
  if (asJson) out(json({ project: slug, candidates: list }));
  else if (!list.length) out(`${slug}: no candidate${usable.length ? "" : " (no usable sequence)"}`);
  else for (const c of list) out(`${c.client.email}  wrote last ${c.lastInboundAt ?? "never"}, ours ${c.last.at}  -> ${c.sequence ?? "(no sequence fits)"}`);
  return 0;
}

async function target(r: Repos, slug: string, t: Target): Promise<EnrollmentItem> {
  if (t.id !== undefined) {
    if (!/^\d+$/.test(t.id)) throw new RepoError("not_found", `--id takes a number, got "${t.id}"`);
    const e = await r.enrollments.get(slug, Number(t.id));
    if (!e) throw new RepoError("not_found", `no enrollment ${t.id} in ${slug}`);
    return e;
  }
  if (!t.client) throw new RepoError("not_found", "name the enrollment: --id <n> or --client <email>");
  const e = await r.enrollments.openFor(slug, t.client);
  if (!e) throw new RepoError("not_found", `${t.client} has no open follow-ups in ${slug}`);
  return e;
}

/** One JSON line and an exit code: 0 ok, 1 a refusal of the database (wrong state, not found), 2 a bad call. */
async function move(d: SequencesDeps, fn: (r: Repos) => Promise<unknown>): Promise<number> {
  const out = d.out ?? console.log;
  try {
    const r = await withRepos(d, fn);
    out(json({ ok: true, ...(r && typeof r === "object" ? r : {}) }));
    return 0;
  } catch (e) {
    out(json({ ok: false, error: e instanceof Error ? e.message : String(e), ...(e instanceof RepoError ? { code: e.code } : {}) }));
    return e instanceof RepoError ? 1 : 2;
  }
}
const brief = (e: { id: number; state: string; step: number; nextDueAt: string | null; finishReason: string | null }) => ({ enrollmentId: e.id, state: e.state, step: e.step, nextDueAt: e.nextDueAt, finishReason: e.finishReason });
const refuseAgent = (d: SequencesDeps, what: string): number | null => {
  if (!inAgentSession(d.env ?? process.env)) return null;
  (d.out ?? console.log)(json({ ok: false, error: `hub sequences ${what} ${OWNER_ONLY}` }));
  return 2;
};

/** The owner enrols one client (`--not-now`: decline this silence). Owner only. */
export async function runSequencesEnrol(slug: string, o: { client: string; sequence?: string; notNow?: boolean }, d: SequencesDeps): Promise<number> {
  const refused = refuseAgent(d, "enrol");
  if (refused !== null) return refused;
  const all = loadSequences(folderOf(d, slug));
  return move(d, async (r) => {
    const c = await r.clients.idByEmail(slug, o.client.trim().toLowerCase());
    if (c === undefined) throw new RepoError("not_found", `${o.client} has no draft in ${slug}, so there is nothing to follow up`);
    const last = await r.enrollments.lastOutbound(slug, c);
    const def = o.sequence ? findSequence(all, o.sequence) : pickSequence(all, { mailClass: last?.mailClass ?? null, notionKind: last?.notionKind ?? null });
    if (!def) throw new RepoError("not_found", o.sequence ? `no sequence "${o.sequence}" in ${slug}/sequences/` : "no usable sequence fits this client: name one with --sequence");
    if (!isUsable(def)) throw new RepoError("wrong_state", `sequence ${def.id} is not usable: run hub sequences check ${slug}`);
    const input = { project: slug, clientId: c, sequence: def.id, sequenceHash: def.hash, schedule: scheduleOf(def), by: "owner", ...(d.now ? { now: d.now() } : {}) };
    return brief(o.notNow ? await r.enrollments.notNow(input) : await r.enrollments.enrol(input));
  });
}

export async function runSequencesStop(slug: string, t: Target & { reason?: string }, d: SequencesDeps): Promise<number> {
  const reason = STOP_REASONS.find((x) => x === (t.reason ?? "stopped"));
  if (!reason) {
    (d.out ?? console.log)(json({ ok: false, error: `--reason must be one of ${STOP_REASONS.join(", ")}` }));
    return 2;
  }
  return move(d, async (r) => brief(await r.enrollments.stop(slug, (await target(r, slug, t)).id, reason, d.now?.())));
}

export async function runSequencesDelay(slug: string, t: Target & { until: string }, d: SequencesDeps): Promise<number> {
  return move(d, async (r) => brief(await r.enrollments.delay(slug, (await target(r, slug, t)).id, t.until, d.now?.())));
}

export async function runSequencesPauseResume(slug: string, t: Target, what: "pause" | "resume", d: SequencesDeps): Promise<number> {
  const refused = refuseAgent(d, what);
  if (refused !== null) return refused;
  return move(d, async (r) => {
    const id = (await target(r, slug, t)).id;
    return brief(what === "pause" ? await r.enrollments.pause(slug, id, d.now?.()) : await r.enrollments.resume(slug, id, d.now?.()));
  });
}

const factsSchema = z
  .object({
    optedOut: z.boolean().optional(),
    bounced: z.boolean().optional(),
    lastInboundAt: z.string().nullish(),
    outOfOfficeUntil: z.string().nullish(),
    doNotContact: z.boolean().optional(),
    doNotFollowUp: z.boolean().optional(),
    relationship: z.string().max(100).nullish(),
    leadStatus: z.string().max(100).nullish(),
  })
  .strict();

/** `judge`: the facts a session read (JSON on stdin) through the stop rule of `@hub/sequences`; a finish or a delay is applied, never an enrolment. */
export async function runSequencesJudge(slug: string, t: Target, stdin: string, d: SequencesDeps): Promise<number> {
  const out = d.out ?? console.log;
  let raw: unknown;
  try { raw = JSON.parse(stdin); } catch { out(json({ ok: false, error: "stdin is not JSON" })); return 2; }
  const parsed = factsSchema.safeParse(raw);
  if (!parsed.success) { out(json({ ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".") || "facts"}: ${i.message}`).join("; ") })); return 2; }
  const facts: StopFacts = parsed.data;
  const all = loadSequences(folderOf(d, slug));
  return move(d, async (r) => {
    const e = await target(r, slug, t);
    const def = findSequence(all, e.sequence) ?? { appliesTo: ["Lead" as const, "Client" as const], stopOn: [...CORE_STOP_ON] };
    const decision = decideStop(facts, def, e.anchorAt);
    if (decision.action === "finish") return { decision, ...brief(await r.enrollments.stop(slug, e.id, decision.reason satisfies StopReason, d.now?.())) };
    if (decision.action === "delay") return { decision, ...brief(await r.enrollments.delay(slug, e.id, decision.until, d.now?.())) };
    return { decision, ...brief(e) };
  });
}

/** Adds `hub sequences list|check|due|candidates|enrol|stop|delay|pause|resume|judge`. */
export function registerSequencesCommands(program: Command, deps: () => SequencesDeps): Command {
  const seq = program.command("sequences").description("Follow-ups (P47): the project's sequence files and its enrollments. enrol, pause and resume are the owner's; stop, delay and judge only ever reduce mail. Nothing here sends.");
  const done = (code: number) => { process.exitCode = code; };
  const t = (o: { id?: string; client?: string }): Target => ({ ...(o.id !== undefined ? { id: o.id } : {}), ...(o.client !== undefined ? { client: o.client } : {}) });
  seq.command("list").description("The project's sequences, with their status and step count. --json for a session.").argument("<slug>").option("--json", "as JSON")
    .action((slug: string, o: { json?: boolean }) => done(runSequencesList(slug, !!o.json, deps())));
  seq.command("check").description("Check every sequence file of a project (front matter, Steps table, stop list, mail classes of the kind). Exit 1 on an error.").argument("<slug>")
    .action((slug: string) => done(runSequencesCheck(slug, deps())));
  seq.command("due").description("The follow-ups due now: active, the date has come, no open draft. --json is what the sequence-drafts skill reads.").argument("<slug>").option("--json", "as JSON")
    .action(async (slug: string, o: { json?: boolean }) => done(await runSequencesDue(slug, !!o.json, deps())));
  seq.command("candidates").description("Clients the owner might enrol: we wrote last, long enough ago, nothing open. Read only.").argument("<slug>").option("--json", "as JSON")
    .action(async (slug: string, o: { json?: boolean }) => done(await runSequencesCandidates(slug, !!o.json, deps())));
  seq.command("enrol").alias("enroll").description("OWNER ONLY: enrol one client (--not-now declines this silence). Refused in an agent session.").argument("<slug>").requiredOption("--client <email>", "the client").option("--sequence <id>", "the sequence file id (default: the one that fits)").option("--not-now", "decline: do not offer this client again until we write again")
    .action(async (slug: string, o: { client: string; sequence?: string; notNow?: boolean }) => done(await runSequencesEnrol(slug, o, deps())));
  seq.command("stop").description("Finish one enrollment (and skip its open step draft). --reason replied|bounced|opted_out|closed|excluded|stopped.").argument("<slug>").option("--id <n>", "the enrollment").option("--client <email>", "or the client").option("--reason <reason>", "why", "stopped")
    .action(async (slug: string, o: { id?: string; client?: string; reason?: string }) => done(await runSequencesStop(slug, { ...t(o), ...(o.reason ? { reason: o.reason } : {}) }, deps())));
  seq.command("delay").description("An out-of-office: the next step waits until the business day after --until. The enrollment stays active.").argument("<slug>").option("--id <n>", "the enrollment").option("--client <email>", "or the client").requiredOption("--until <date>", "the return date")
    .action(async (slug: string, o: { id?: string; client?: string; until: string }) => done(await runSequencesDelay(slug, { ...t(o), until: o.until }, deps())));
  seq.command("pause").description("OWNER ONLY: pause one enrollment. Refused in an agent session.").argument("<slug>").option("--id <n>", "the enrollment").option("--client <email>", "or the client")
    .action(async (slug: string, o: { id?: string; client?: string }) => done(await runSequencesPauseResume(slug, t(o), "pause", deps())));
  seq.command("resume").description("OWNER ONLY: resume a paused enrollment. Refused in an agent session.").argument("<slug>").option("--id <n>", "the enrollment").option("--client <email>", "or the client")
    .action(async (slug: string, o: { id?: string; client?: string }) => done(await runSequencesPauseResume(slug, t(o), "resume", deps())));
  seq.command("judge").description("The facts a session read for one enrolled client (JSON on stdin) through the stop rule: finish, delay, or carry on.").argument("<slug>").option("--id <n>", "the enrollment").option("--client <email>", "or the client")
    .action(async (slug: string, o: { id?: string; client?: string }) => done(await runSequencesJudge(slug, t(o), readFileSync(0, "utf8"), deps())));
  return seq;
}

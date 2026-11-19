import { mailAppDraftWriter, reviseDraft, versionHash, type DraftWriter } from "@hub/agent/mail-drafts";
import { writeLogOf } from "@hub/agent/write-record";
import { markedDraft } from "@hub/config";
import { createRepos, defaultDbPath, openDb, openDbReadOnly, textKey, type Db, type MailVersionRow, type Repos } from "@hub/db";
import { loadProjects } from "@hub/projects";
import { bareId, mailAppDraftsCleaner, type DraftsCleaner, type MailDraft } from "@hub/send";

// `hub drafts unmark` (P65 S3, decision 0031 point 6): the one-time migration of the Mail drafts written before 0031,
// whose first line is `[hub-draft thread=<id>]`. For each open hub draft whose thread draft in the project's accounts
// carries this thread's marker, the dry run (default) prints account, Mail id, Message-ID, subject and draft row; it
// opens the database read-only and reads Mail only. `--apply` (the owner's, denied to a session) adopts the marked
// version as a Hub version (a `mail_versions` row), rewrites it through the one writer in keep mode without the marker
// line and the blank line under it, and the writer's replace moves the marked one to Trash (recoverable). Nothing is
// sent. P65 S4 deletes this command once both instances read 0.
// A rerun is safe (P65 S5, decision 0031 addendum point 6): a marked draft whose thread already holds its rewrite (an
// unmarked draft with the same text, adopted when the Hub had not recorded it, as when Mail saved it in the From's
// account) or a newer recorded version is not rewritten again; only the marked one goes to Trash, retried once Mail refuses.

export interface UnmarkCommandEnv {
  projectsDir: string;
  policyDir: string;
  dbPath?: string;
  mailer?: Pick<DraftsCleaner, "findDrafts" | "trashDrafts">;
  /** Pause between two tries of Mail's delete (tests pass 0). */
  retryMs?: number;
  writer?: DraftWriter;
  out?: (l: string) => void;
}

export interface UnmarkRow {
  project: string;
  draftId: number;
  mailRef: string;
  account: string;
  mail: MailDraft;
  /** The other drafts of this thread in the project's accounts (In-Reply-To = mailRef): where an earlier rewrite is found. */
  thread: MailDraft[];
}

/** The text without the leading blank lines, the marker line and one blank line under it. */
export const withoutMarker = (text: string): string => text.replace(/^(?:[ \t]*\r?\n)*[ \t]*\[hub-draft thread=[^\]\n]*\][ \t]*\r?\n(?:[ \t]*\r?\n)?/i, "");

type OpenDraft = { id: number; subject: string; mailRef: string | null };

/**
 * The open hub drafts of a project, by a plain read of the four columns every schema since 0000 has: the dry run runs on
 * a database a pinned older server still holds (realty at 0019 on 2026-11-19), so it names no newer column.
 */
export function openDrafts(db: Db, project: string): OpenDraft[] {
  const rows: unknown[] = db.$client.prepare("SELECT id, subject, mail_ref FROM drafts WHERE project = ? AND status IN ('ready', 'hold') ORDER BY id").all(project);
  return rows.flatMap((r) => (typeof r === "object" && r !== null && "id" in r && "subject" in r && "mail_ref" in r && typeof r.id === "number" && typeof r.subject === "string" ? [{ id: r.id, subject: r.subject, mailRef: typeof r.mail_ref === "string" ? r.mail_ref : null }] : []));
}

/** The marked thread drafts of a project's open hub drafts. Read-only (database and Mail). */
export async function planUnmark(db: Db, mailer: Pick<DraftsCleaner, "findDrafts">, project: string, accounts: readonly string[]): Promise<UnmarkRow[]> {
  const own = new Set(accounts.map((a) => a.trim().toLowerCase()));
  const rows: UnmarkRow[] = [];
  const open = openDrafts(db, project).filter((d) => bareId(d.mailRef));
  for (const d of open) {
    const ref = bareId(d.mailRef);
    const found = (await mailer.findDrafts({ mailRef: d.mailRef, subject: d.subject })).filter((m) => own.has((m.account ?? "").trim().toLowerCase()));
    for (const m of found) {
      if (markedDraft(m.body)?.thread !== ref) continue;
      const thread = found.filter((x) => x !== m && x.inReplyTo === ref && markedDraft(x.body) === null);
      rows.push({ project, draftId: d.id, mailRef: d.mailRef ?? "", account: m.account ?? "", mail: m, thread });
    }
  }
  return rows;
}

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const isVersion = (m: MailDraft, versions: readonly Pick<MailVersionRow, "account" | "messageId" | "trashedAt">[]) => versions.some((v) => !v.trashedAt && lower(v.account) === lower(m.account) && bareId(v.messageId) === bareId(m.messageId));

/**
 * What already stands for the marked draft in its thread, if anything: its rewrite (an unmarked draft whose text,
 * whitespace collapsed, is the marked text without its line) or a newer version the Hub recorded. Then it is not rewritten again.
 */
export function rewriteOf(r: UnmarkRow, versions: readonly Pick<MailVersionRow, "account" | "messageId" | "trashedAt">[]): { mail: MailDraft; why: "same_text" | "newer" } | null {
  const want = textKey(withoutMarker(r.mail.body)).hash;
  const twin = r.thread.find((m) => textKey(m.body).hash === want);
  if (twin) return { mail: twin, why: "same_text" };
  const newer = r.thread.filter((m) => (Number(m.ref) || 0) > (Number(r.mail.ref) || 0) && isVersion(m, versions)).sort((a, b) => (Number(b.ref) || 0) - (Number(a.ref) || 0))[0];
  return newer ? { mail: newer, why: "newer" } : null;
}

const line = (r: UnmarkRow, plan: string) => `${r.project.padEnd(10)} draft ${String(r.draftId).padStart(4)}  ${r.account.padEnd(34)} Mail id ${r.mail.ref.padStart(7)}  ${r.mail.messageId ?? "?"}  "${r.mail.subject}"  ${plan}`;

/** Moves one recorded draft to Trash, trying again when Mail refuses (a slow Mail drops a delete now and then: 139333, 2026-11-19). */
async function trashRetrying(mailer: Pick<DraftsCleaner, "trashDrafts">, item: { account: string; messageId: string }, pauseMs: number, why: string[], tries = 3): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (i > 0 && pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
    const r = await mailer.trashDrafts([item]).catch((e: Error) => ({ moved: [] as string[], refused: [item.messageId], why: [`${item.messageId}: ${e.message}`] }));
    if (r.moved.some((x) => bareId(x) === bareId(item.messageId))) return true;
    // Mail's own words for the last refusal, so a failing delete is never silent again (v0.12.15).
    if (i === tries - 1) why.push(...(r.why ?? []));
  }
  return false;
}

/** The adopted version row of a draft (the marked one, or its earlier rewrite), recorded once. */
async function adopt(repos: Repos, r: UnmarkRow, m: MailDraft): Promise<number> {
  const mid = bareId(m.messageId);
  const known = (await repos.mailVersions.ofDraft(r.draftId)).find((v) => v.trashedAt === null && lower(v.account) === lower(m.account) && bareId(v.messageId) === mid);
  return known?.id ?? (await repos.mailVersions.add({ project: r.project, mailRef: r.mailRef, draftId: r.draftId, account: m.account ?? r.account, mailId: Number(m.ref) || 0, messageId: m.messageId ?? "", hash: versionHash(m.body), source: "migration" }));
}

/** Exit code: 0 ok (dry run, or every listed draft rewritten), 1 Mail refused one or could not be read, 2 bad input. */
const versionsOf = (repos: Repos, draftId: number) => repos.mailVersions.ofDraft(draftId).catch(() => []);

export async function runDraftsUnmark(o: { project?: string; apply?: boolean }, env: UnmarkCommandEnv): Promise<number> {
  const out = env.out ?? console.log;
  const projects = loadProjects(env.projectsDir, { policyDir: env.policyDir }).filter((p) => !o.project || p.slug === o.project);
  if (projects.length === 0) {
    out(JSON.stringify({ ok: false, error: o.project ? `no project ${o.project}` : "no projects" }));
    return 2;
  }
  // The dry run never writes, so it never migrates the database either (a pinned older server may hold it).
  const handle = o.apply ? openDb(env.dbPath ?? defaultDbPath()) : openDbReadOnly(env.dbPath ?? defaultDbPath());
  try {
    const mailer = env.mailer ?? mailAppDraftsCleaner();
    const rows: UnmarkRow[] = [];
    for (const p of projects) rows.push(...(await planUnmark(handle.db, mailer, p.slug, p.parsed.config.mail.accounts)));
    out(`${o.apply ? "Rewriting without the marker" : "Dry run, nothing written"}: ${rows.length} Mail draft${rows.length === 1 ? " still carries" : "s still carry"} a hub marker line.`);
    const read = createRepos(handle.db);
    const plans = new Map<UnmarkRow, ReturnType<typeof rewriteOf>>();
    for (const r of rows) plans.set(r, rewriteOf(r, await versionsOf(read, r.draftId)));
    for (const r of rows) {
      const p = plans.get(r);
      out(line(r, p ? `already rewritten as Mail id ${p.mail.ref} (${p.mail.account ?? "?"}${p.why === "newer" ? ", a newer recorded version" : ""}): only the marked one goes to Trash` : "rewrite without the line"));
    }
    if (!o.apply || rows.length === 0) {
      out(JSON.stringify({ ok: true, dryRun: !o.apply, listed: rows.length }));
      return 0;
    }
    const repos = createRepos(handle.db);
    const writer = env.writer ?? mailAppDraftWriter();
    const done: Array<{ draftId: number; from: string; to: number; trashed: boolean; rewritten: boolean }> = [];
    const pause = env.retryMs ?? 2000;
    const why: string[] = [];
    const failed: Array<{ draftId: number; ref: string; error: string }> = [];
    for (const r of rows) {
      const p = projects.find((x) => x.slug === r.project);
      const accounts = p?.parsed.config.mail.accounts ?? [];
      try {
        // A run that failed after the adoption (2026-11-19, v0.12.12: the writer's script did not compile) left the row:
        // reuse it, so a rerun records the marked version once.
        const mid = bareId(r.mail.messageId);
        const adopted = await adopt(repos, r, r.mail);
        const item = { account: r.account, messageId: r.mail.messageId ?? "" };
        const earlier = plans.get(r);
        if (earlier) {
          // P65 S5: the rewrite is already in the thread (a run whose writer looked in the wrong account, or a late save).
          await adopt(repos, r, earlier.mail);
          const trashed = await trashRetrying(mailer, item, pause, why);
          if (trashed) await repos.mailVersions.markTrashed([adopted]);
          await repos.drafts.setChecked(r.draftId, false, null);
          done.push({ draftId: r.draftId, from: r.mail.ref, to: Number(earlier.mail.ref) || 0, trashed, rewritten: false });
          continue;
        }
        const w = await reviseDraft(writer, { accounts, sender: p?.parsed.config.mail.sender ?? null, mailRef: r.mailRef, body: withoutMarker(r.mail.body), quote: "keep", versions: [item], log: writeLogOf((fn) => fn(repos), r.project, r.draftId, r.mailRef) });
        await repos.mailVersions.add({ project: r.project, mailRef: r.mailRef, draftId: r.draftId, account: w.account, mailId: w.draftId, messageId: w.messageId, hash: versionHash(w.text), source: "migration" });
        // Mail refused the replace's delete: try the marked one again on its own.
        const trashed = w.replaced.some((x) => bareId(x) === mid) || (await trashRetrying(mailer, item, pause, why));
        if (trashed) await repos.mailVersions.markTrashed([adopted]);
        await repos.drafts.setChecked(r.draftId, false, null);
        done.push({ draftId: r.draftId, from: r.mail.ref, to: w.draftId, trashed, rewritten: true });
      } catch (e) {
        failed.push({ draftId: r.draftId, ref: r.mail.ref, error: (e as Error).message.slice(0, 200) });
      }
    }
    // The writer moves the marked version to Trash only after the new one is saved and found, so a failed row's marked
    // draft is still in Drafts, unchanged. The note says only what happened.
    const inTrash = done.filter((d) => d.trashed).length;
    const kept = done.length - inTrash;
    const notes = [
      ...(inTrash ? [`${inTrash === 1 ? "the marked version is" : `${inTrash} marked versions are`} in the account's Trash, recoverable`] : []),
      ...(kept ? [`${kept === 1 ? "1 marked version" : `${kept} marked versions`} Mail would not delete after three tries ${kept === 1 ? "is" : "are"} still in Drafts beside the rewrite, recorded as the Hub's: \`hub drafts sweep\` lists ${kept === 1 ? "it" : "them"}, and a rerun of this command tries again without rewriting`] : []),
      ...(failed.length ? [`${failed.length === 1 ? "the failed draft is" : `the ${failed.length} failed drafts are`} still in Drafts, untouched`] : []),
      "nothing was sent",
    ];
    out(JSON.stringify({ ok: failed.length === 0 && kept === 0, dryRun: false, listed: rows.length, rewritten: done, failed, ...(why.length ? { why } : {}), note: notes.join("; ") }));
    return failed.length || kept ? 1 : 0;
  } catch (e) {
    out(JSON.stringify({ ok: false, error: `Mail could not be read: ${(e as Error).message}` }));
    return 1;
  } finally {
    handle.close();
  }
}

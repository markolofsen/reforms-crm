import { createRepos, defaultDbPath, openDb } from "@hub/db";
import { loadProjects } from "@hub/projects";
import { closedThreads, mailAppDraftsCleaner, planSweep, type DraftsCleaner, type SweepRow } from "@hub/send";

// `hub drafts sweep` (P56 S0): the hub's own leftovers in Mail's Drafts go to Trash, recoverable; the owner's drafts are
// never listed (authorship by text only, `hubAuthorship`). Dry run unless `--apply`. One run per project of the instance
// (or the one `--project`); the legacy class (the run line) is judged in every account, so a draft found by two projects
// is listed once and moved once.

export interface SweepCommandEnv {
  projectsDir: string;
  policyDir: string;
  dbPath?: string;
  mailer?: DraftsCleaner;
  out?: (l: string) => void;
}

const row = (r: SweepRow) => `${r.kind.padEnd(10)} ${r.account.padEnd(34)} ${r.ref.padStart(7)}  "${r.subject}"  (${r.why})`;

/** Exit code: 0 ok (dry run or every listed draft moved), 1 Mail refused some or could not be read, 2 bad input. */
export async function runDraftsSweep(o: { project?: string; apply?: boolean }, env: SweepCommandEnv): Promise<number> {
  const out = env.out ?? console.log;
  const projects = loadProjects(env.projectsDir, { policyDir: env.policyDir }).filter((p) => !o.project || p.slug === o.project);
  if (projects.length === 0) {
    out(JSON.stringify({ ok: false, error: o.project ? `no project ${o.project}` : "no projects" }));
    return 2;
  }
  const handle = openDb(env.dbPath ?? defaultDbPath());
  try {
    const repos = createRepos(handle.db);
    const mailer = env.mailer ?? mailAppDraftsCleaner();
    const seen = new Set<string>();
    const rows: SweepRow[] = [];
    // One read of Mail (it takes minutes over every account), judged per project.
    const drafts = await mailer.listHubDrafts();
    for (const p of projects) {
      for (const x of planSweep(drafts, { accounts: p.parsed.config.mail.accounts, closed: await closedThreads(repos, p.slug) })) {
        if (seen.has(x.ref)) continue;
        seen.add(x.ref);
        rows.push(x);
      }
    }
    out(`${o.apply ? "Moving to Trash" : "Dry run, nothing moved"}: ${rows.length} draft${rows.length === 1 ? "" : "s"} the Hub wrote (drafts without a hub line are never listed).`);
    for (const r of rows) out(row(r));
    if (!o.apply || rows.length === 0) {
      out(JSON.stringify({ ok: true, dryRun: !o.apply, listed: rows.length }));
      return 0;
    }
    const done = await mailer.trashDrafts(rows.map((r) => ({ ref: r.ref, line: r.line })));
    out(JSON.stringify({ ok: done.refused.length === 0, dryRun: false, listed: rows.length, moved: done.moved, refused: done.refused, note: done.refused.length ? "refused: the text no longer starts with its hub line, or the draft is gone; nothing else was touched" : "moved to each account's Trash: recoverable there" }));
    return done.refused.length ? 1 : 0;
  } catch (e) {
    out(JSON.stringify({ ok: false, error: `Mail could not be read: ${(e as Error).message}` }));
    return 1;
  } finally {
    handle.close();
  }
}

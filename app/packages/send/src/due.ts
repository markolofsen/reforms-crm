import { RepoError } from "@hub/db";
import { projectStore } from "@hub/projects";
import { assess, type SendDeps } from "./assess";
import { deliver } from "./deliver";
import { DAY_MS } from "./recipients";

// `hub send --due`: the autosend run (queued rows whose window is over, then new ones under the daily cap).

export interface DueReport {
  /** Rows sent (or that would be, in a dry run) because their window is over. */
  sent: Array<{ sendId: number; draftId: number }>;
  /** Drafts queued now (or that would be). */
  queued: Array<{ draftId: number; dueAt: string }>;
  /** Queued rows cancelled because a check no longer held. */
  cancelled: Array<{ sendId: number; draftId: number | null; reasons: string[] }>;
  /** Drafts looked at and left alone, with why. */
  skipped: Array<{ draftId: number; reasons: string[] }>;
  failed: Array<{ sendId: number; error: string }>;
  stopped: string[];
}

/**
 * `hub send --due`. Off unless a project has `send.mode: auto` and is active. Phase 1 sends the queued rows whose
 * window is over, after re-reading Mail and re-running every check (a changed draft, a hold, a Stop all or a changed
 * project setting cancels the row). Phase 2 queues the ready drafts of the listed classes under the daily cap, each
 * due after `send.delay_minutes`. A dry run reads and decides but writes nothing and sends nothing.
 */
export async function runDue(deps: SendDeps, o: { apply: boolean; project?: string; actor?: string }): Promise<{ code: 0 | 1; report: DueReport }> {
  const now = deps.now?.() ?? new Date();
  const actor = o.actor ?? "auto";
  const report: DueReport = { sent: [], queued: [], cancelled: [], skipped: [], failed: [], stopped: await deps.repos.sends.stoppedScopes() };
  let code: 0 | 1 = 0;

  // Phase 1: rows whose window is over.
  for (const row of await deps.repos.sends.due(now.toISOString(), o.project)) {
    const a = await assess(deps, row.draftId ?? -1, { mode: "auto", queued: row });
    if (!a.ok || !a.mail) {
      if (o.apply) await deps.repos.sends.cancel(row.id, `checks failed at send time: ${a.reasons.join("; ")}`.slice(0, 1000));
      report.cancelled.push({ sendId: row.id, draftId: row.draftId, reasons: a.reasons });
      continue;
    }
    if (!o.apply) {
      report.sent.push({ sendId: row.id, draftId: row.draftId as number });
      continue;
    }
    const claimed = await deps.repos.sends.claim(row.id);
    if (!claimed) continue; // cancelled meanwhile, or another runner has it
    const d = await deps.repos.drafts.get(row.draftId as number);
    const r = await deliver(deps, { draftId: row.draftId as number, project: row.project, mode: "auto", actor, mail: a.mail, queued: claimed, mailRef: d?.mailRef ?? null });
    if (r.code === 0) report.sent.push({ sendId: row.id, draftId: row.draftId as number });
    else {
      code = 1;
      report.failed.push({ sendId: row.id, error: (JSON.parse(r.line) as { error?: string }).error ?? "failed" });
    }
  }

  // Phase 2: queue new ones.
  for (const p of projectStore({ projects: deps.projectsDir, stateProjects: deps.policyDir }).list()) {
    const c = p.parsed.config;
    if (o.project && p.slug !== o.project) continue;
    if (c.send.mode !== "auto" || c.status !== "active" || c.send.classes.length === 0) continue;
    if (await deps.repos.sends.isStopped(p.slug)) continue;
    let room = c.send.dailyCap - (await deps.repos.sends.autoCountSince(p.slug, new Date(now.getTime() - DAY_MS).toISOString()));
    const ready = await deps.repos.sends.readyOfClasses(p.slug, c.send.classes);
    for (const d of ready) {
      if (room <= 0) break;
      const a = await assess(deps, d.id, { mode: "auto", checkCap: false });
      if (!a.ok || !a.mail) {
        // Not eligible: say why only when something other than "already queued/sent" is in the way.
        if (!a.reasons.every((r) => /^(already (queued|sent)|an earlier autosend)/.test(r))) report.skipped.push({ draftId: d.id, reasons: a.reasons });
        continue;
      }
      const dueAt = new Date(now.getTime() + c.send.delayMinutes * 60_000).toISOString();
      if (o.apply) {
        try {
          const m = a.mail;
          await deps.repos.sends.begin({ project: p.slug, draftId: d.id, mode: "auto", status: "queued", actor, at: now.toISOString(), dueAt, sender: m.sender, to: m.to.join(", "), cc: m.cc.join(", ") || null, bcc: null, subject: m.subject, body: m.body, mailRef: m.messageId });
        } catch (e) {
          if (e instanceof RepoError) continue;
          throw e;
        }
      }
      room--;
      report.queued.push({ draftId: d.id, dueAt });
    }
  }
  return { code, report };
}

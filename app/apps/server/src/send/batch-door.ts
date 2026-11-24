import { BATCH_LIMITS, runBatch, type BatchItem, type BatchLimits, type BatchOutcome } from "@hub/send/batch";
import { type SendDeps } from "@hub/send/assess";
import type { BatchRunDto } from "@hub/contract/sending";
import { errFields, ops } from "@hub/log/ops";

// The runs of Send all Checked (P85b, decision 0011 amendment of 2026-11-20 point 4). A run lives in this process only: the
// person's click starts it, it sends one Checked draft of one batch at a time through the door (`runBatch`), with the spacing
// between two mails, and the admin reads its progress and may Stop it. One run per project at a time, so two runs never share
// the cap and the spacing out of step. A restart of the server ends a run between two mails: the drafts not yet sent stay
// Checked and wait for a new click; every mail already sent has its `send_log` row.

type Run = BatchRunDto & { stop: () => void; stopRequested: boolean };

export interface BatchRuns {
  /** Starts a run of exactly these confirmed items; refuses when this project already runs one. */
  start(deps: SendDeps, o: { project: string; batchId: number; items: readonly BatchItem[] }): { run: BatchRunDto } | { refused: string };
  get(project: string, batchId: number): BatchRunDto | null;
  /** Stop between two mails: the mail being sent finishes, the rest are left. False when no run is going. */
  stop(project: string, batchId: number): boolean;
}

const view = ({ stop: _s, stopRequested: _r, ...dto }: Run): BatchRunDto => ({ ...dto, items: dto.items.map((i) => ({ ...i })) });

/**
 * `limits` (tests, and the fake-Mailer e2e) may shorten the spacing; the server passes the defaults of `@hub/config`.
 * `onChange` is told each change (the server bumps the live topic `drafts` so every open tab reads the batch again).
 */
export function batchRuns(o: { limits?: BatchLimits; onChange?: (project: string) => void; now?: () => Date } = {}): BatchRuns {
  const runs = new Map<string, Run>();
  const key = (project: string) => project;
  const now = () => (o.now?.() ?? new Date()).toISOString();
  const changed = (project: string) => {
    try {
      o.onChange?.(project);
    } catch {
      // only the other tabs' refresh is lost
    }
  };
  return {
    start(deps, s) {
      const cur = runs.get(key(s.project));
      if (cur && cur.state === "running") return { refused: `a batch send of this project is already running (batch ${cur.batchId}): wait for it or stop it` };
      let wake: (() => void) | null = null;
      const run: Run = {
        project: s.project,
        batchId: s.batchId,
        state: "running",
        startedAt: now(),
        finishedAt: null,
        spacingSeconds: (o.limits ?? BATCH_LIMITS).spacingSeconds,
        items: s.items.map((i) => ({ draftId: i.draftId, name: i.name, to: i.to, subject: i.subject, status: "waiting", reasons: [], sendId: null, at: null })),
        stopRequested: false,
        stop: () => {
          run.stopRequested = true;
          wake?.();
        },
      };
      runs.set(key(s.project), run);
      const update = (u: BatchOutcome) => {
        const item = run.items.find((i) => i.draftId === u.draftId);
        if (item) Object.assign(item, { status: u.status, reasons: u.reasons, sendId: u.sendId, at: u.at });
        // P137 L2: each draft's outcome in the run is one line (sent, held with its reasons, failed).
        if (u.status === "sent") ops("send").info("batch item sent", { project: s.project, batch: s.batchId, draft: u.draftId, send: u.sendId });
        else if (u.status === "failed") ops("send").error("batch item failed", { project: s.project, batch: s.batchId, draft: u.draftId, reasons: u.reasons });
        else if (u.status !== "sending" && u.status !== "waiting") ops("send").warn(`batch item ${u.status}`, { project: s.project, batch: s.batchId, draft: u.draftId, reasons: u.reasons });
        changed(s.project);
      };
      const wait = (ms: number) =>
        new Promise<void>((resolve) => {
          const t = setTimeout(() => {
            wake = null;
            resolve();
          }, ms);
          wake = () => {
            clearTimeout(t);
            wake = null;
            resolve();
          };
        });
      void runBatch(deps, { project: s.project, batchId: s.batchId, items: s.items, ...(o.limits ? { limits: o.limits } : {}), control: { stopped: () => run.stopRequested, wait, update } })
        .catch((e: unknown) => {
          ops("send").error("a batch run stopped on an error; the drafts not tried are left", { project: s.project, batch: s.batchId, ...errFields(e, true) });
          // A throw of the database or Mail between two mails: what was not tried is left, with the reason.
          for (const i of run.items) if (i.status === "waiting" || i.status === "sending") Object.assign(i, { status: i.status === "sending" ? "failed" : "stopped", reasons: [`the run stopped: ${e instanceof Error ? e.message : String(e)}`], at: now() });
        })
        .finally(() => {
          run.state = run.stopRequested ? "stopped" : "finished";
          run.finishedAt = now();
          ops("send").info(`batch run ${run.state}`, { project: s.project, batch: s.batchId, sent: run.items.filter((i) => i.status === "sent").length, items: run.items.length });
          changed(s.project);
        });
      return { run: view(run) };
    },
    get(project, batchId) {
      const r = runs.get(key(project));
      return r && r.batchId === batchId ? view(r) : null;
    },
    stop(project, batchId) {
      const r = runs.get(key(project));
      if (!r || r.batchId !== batchId || r.state !== "running") return false;
      r.stop();
      return true;
    },
  };
}

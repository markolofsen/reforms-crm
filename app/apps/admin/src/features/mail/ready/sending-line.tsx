"use client";

import type { BatchRunDto, BatchRunStateDto } from "@hub/contract/sending";
import { ActionButton } from "@hub/ui/product/action-button";
import { AppLink } from "@/components/app-link";
import { useRefreshTopics } from "@/lib/cache/topics";
import { useClock } from "@/lib/clock";
import { useBatchRun, useBatchStop } from "@/lib/data/drafts";
import { dest } from "@/routes/paths";
import { useEffect, useRef } from "react";

// P147 3m item 5 (owner 2026-11-25): the run of today's replies. Its progress lives at the top of Mail ▸ Sent (`SendingPanel`,
// rows and Stop); every other list keeps one line, "Sending 3 of 11 · Open", that leads there. Both only show the run: opening or
// reloading a page never starts or resumes a send. What a run confirmed and did not send is read from the database (`notSent`),
// so it stays after a restart: "1 not sent · Send again", the owner's click that opens the sheet with only those (never an
// automatic resume: a restart mid-send could send a mail twice).

/** A finished run stays this long after it ended, then leaves (what it did not send stays, from the database). */
const SHOWN_AFTER_MS = 30 * 60_000;
const STATUS: Record<BatchRunDto["items"][number]["status"], string> = { waiting: "Waiting", sending: "Sending", sent: "Sent", refused: "Not sent", failed: "Failed", stopped: "Stopped" };

type NotSent = BatchRunStateDto["notSent"];

/** The run while it goes or just ended, and what did not go out; each mail sent reads the drafts, the history and Mail again. */
function useShownRun(project: string, batchId: number): { run: BatchRunDto | null; notSent: NotSent } {
  const data = useBatchRun(project, batchId).data;
  const run = data?.run ?? null;
  const now = useClock()();
  const refresh = useRefreshTopics(project);
  const done = run ? run.items.filter((i) => i.status !== "waiting" && i.status !== "sending").length : 0;
  const seen = useRef(-1);
  useEffect(() => {
    if (seen.current !== -1 && seen.current !== done) void refresh(["sends", "mail", "drafts", "inbox"]);
    seen.current = done;
  }, [done, refresh]);
  const gone = run && run.state !== "running" && run.finishedAt !== null && now - Date.parse(run.finishedAt) > SHOWN_AFTER_MS;
  return { run: gone ? null : run, notSent: data?.notSent ?? [] };
}

/** Pure: "Sending 3 of 11", "Sent 11 of 11", "10 sent, 1 not sent (reason)", "Stopped: 4 sent, 7 not sent"; no run: "1 not sent". */
export function runTitle(run: Pick<BatchRunDto, "state" | "items"> | null, notSent: readonly Pick<NotSent[number], "reason">[] = []): string {
  const why = notSent.length === 1 ? ` (${notSent[0]?.reason})` : "";
  if (!run) return `${notSent.length} not sent${why}`;
  const sent = run.items.filter((i) => i.status === "sent").length;
  const total = run.items.length;
  if (run.state === "running") return `Sending ${sent} of ${total}`;
  const missed = notSent.length;
  if (run.state === "stopped") return `Stopped: ${sent} sent, ${missed} not sent${why}`;
  return missed ? `${sent} sent, ${missed} not sent${why}` : `Sent ${sent} of ${total}`;
}

/** Pure: a row's who, the name once when it is the address. */
export const whoOf = (i: { name: string; to: readonly string[] }): string => {
  const to = i.to.join(", ");
  return !i.name || i.name.trim().toLowerCase() === to.trim().toLowerCase() ? to : `${i.name} · ${to}`;
};

/** The one line on other lists: "Sending 3 of 11 · Open", or "1 not sent · Open" (Mail ▸ Sent shows the run). */
export function SendingLine({ project, batchId, bare = false }: { project: string; batchId: number; bare?: boolean }) {
  const { run, notSent } = useShownRun(project, batchId);
  if (!run && notSent.length === 0) return null;
  return (
    <p aria-live="polite" className={`flex min-w-0 flex-wrap items-center gap-2 text-sm tabular-nums ${bare ? "" : "py-2"}`} data-testid="sending-line">
      <span>{run?.state === "running" ? runTitle(run) : runTitle(run, notSent).replace(/ \(.*\)$/, "")}</span>
      <AppLink to={dest("mail.sent")}>Open</AppLink>
    </p>
  );
}

/**
 * The top of Mail ▸ Sent: the run's rows (Sent, Waiting, Failed) and Stop while the server remembers it, and what was confirmed
 * and not sent, with Send again (`onSendAgain`, the sheet with only those drafts). Nothing when neither is there.
 */
export function SendingPanel({ project, batchId, onSendAgain }: { project: string; batchId: number; onSendAgain?: ((ids: readonly number[]) => void) | undefined }) {
  const { run, notSent } = useShownRun(project, batchId);
  const stop = useBatchStop(project, batchId);
  if (!run && notSent.length === 0) return null;
  const running = run?.state === "running";
  const missed = running ? [] : notSent;
  const inRun = new Set(run?.items.map((i) => i.draftId) ?? []);
  return (
    <section aria-label="Sending now" aria-live="polite" className="flex flex-col gap-2 rounded-lg border p-3" data-testid="sending-panel">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold text-sm tabular-nums">{runTitle(run, missed)}</h2>
        {run && <span className="text-muted-foreground text-xs">one every {run.spacingSeconds} s</span>}
        {running && (
          <ActionButton className="ms-auto" disabled={stop.isPending} onClick={() => stop.mutate()} size="s" variant="secondary">
            {stop.isPending ? "Stopping" : "Stop"}
          </ActionButton>
        )}
        {missed.length > 0 && onSendAgain && (
          <ActionButton className="ms-auto" data-testid="send-again" onClick={() => onSendAgain(missed.map((m) => m.draftId))} size="s" variant="primary">
            Send again ({missed.length})
          </ActionButton>
        )}
      </div>
      <ul aria-label="The run's mails" className="flex flex-col divide-y text-sm">
        {run?.items.map((i) => {
          const left = missed.find((m) => m.draftId === i.draftId);
          // One still confirmed and unsent reads Not sent with its reason, whatever the run called it.
          const status = left ? "Not sent" : STATUS[i.status];
          const reasons = left ? [left.reason] : i.reasons;
          return (
            <li className="flex min-w-0 flex-wrap gap-x-2 py-1.5" key={i.draftId}>
              <span className="w-16 shrink-0 font-medium">{status}</span>
              <span className="min-w-0 flex-1 truncate">{whoOf(i)}</span>
              {reasons.length > 0 && <span className="w-full text-muted-foreground text-xs">{reasons.join("; ")}</span>}
            </li>
          );
        })}
        {missed
          .filter((m) => !inRun.has(m.draftId))
          .map((m) => (
            <li className="flex min-w-0 flex-wrap gap-x-2 py-1.5" key={m.draftId}>
              <span className="w-16 shrink-0 font-medium">Not sent</span>
              <span className="min-w-0 flex-1 truncate">{whoOf(m)}</span>
              <span className="w-full text-muted-foreground text-xs">{m.reason}</span>
            </li>
          ))}
      </ul>
    </section>
  );
}

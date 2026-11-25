"use client";

import type { BatchRunDto } from "@hub/contract/sending";
import { ActionButton } from "@hub/ui/product/action-button";
import { AppLink } from "@/components/app-link";
import { useRefreshTopics } from "@/lib/cache/topics";
import { useClock } from "@/lib/clock";
import { useBatchRun, useBatchStop } from "@/lib/data/drafts";
import { dest } from "@/routes/paths";
import { useEffect, useRef } from "react";

// P147 3m item 5 (owner 2026-11-25): the run of today's replies. Its progress lives at the top of Mail ▸ Sent (`SendingPanel`,
// rows and Stop); every other list keeps one line, "Sending 3 of 11 · Open", that leads there. Both only show the run: opening or
// reloading a page never starts or resumes a send. After a restart the run is gone from the server's memory, and both hide: the
// sends that went out are Sent's own list below.

/** A finished run stays this long after it ended, then leaves. */
const SHOWN_AFTER_MS = 30 * 60_000;
const STATUS: Record<BatchRunDto["items"][number]["status"], string> = { waiting: "Waiting", sending: "Sending", sent: "Sent", refused: "Not sent", failed: "Failed", stopped: "Stopped" };

/** The run while it goes or just ended; each mail sent reads the drafts, the history and Mail again (the rows turn Sent). */
function useShownRun(project: string, batchId: number): BatchRunDto | null {
  const run = useBatchRun(project, batchId).data?.run ?? null;
  const now = useClock()();
  const refresh = useRefreshTopics(project);
  const done = run ? run.items.filter((i) => i.status !== "waiting" && i.status !== "sending").length : 0;
  const seen = useRef(-1);
  useEffect(() => {
    if (seen.current !== -1 && seen.current !== done) void refresh(["sends", "mail", "drafts", "inbox"]);
    seen.current = done;
  }, [done, refresh]);
  if (!run || (run.state !== "running" && run.finishedAt !== null && now - Date.parse(run.finishedAt) > SHOWN_AFTER_MS)) return null;
  return run;
}

/** Pure: "Sending 3 of 11", "Sent 11 of 11", "Stopped: sent 4 of 11". */
export function runTitle(run: Pick<BatchRunDto, "state" | "items">): string {
  const sent = run.items.filter((i) => i.status === "sent").length;
  const total = run.items.length;
  return run.state === "running" ? `Sending ${sent} of ${total}` : `${run.state === "stopped" ? "Stopped: sent" : "Sent"} ${sent} of ${total}`;
}

/** Pure: a row's who, the name once when it is the address. */
export const whoOf = (i: { name: string; to: readonly string[] }): string => {
  const to = i.to.join(", ");
  return !i.name || i.name.trim().toLowerCase() === to.trim().toLowerCase() ? to : `${i.name} · ${to}`;
};

/** The one line on other lists: "Sending 3 of 11 · Open" (Mail ▸ Sent shows the run). */
export function SendingLine({ project, batchId, bare = false }: { project: string; batchId: number; bare?: boolean }) {
  const run = useShownRun(project, batchId);
  if (!run) return null;
  const missed = run.items.filter((i) => i.status === "refused" || i.status === "failed").length;
  return (
    <p aria-live="polite" className={`flex min-w-0 flex-wrap items-center gap-2 text-sm tabular-nums ${bare ? "" : "py-2"}`} data-testid="sending-line">
      <span>{runTitle(run)}</span>
      {missed > 0 && <span className="text-muted-foreground">· {missed} not sent</span>}
      <AppLink to={dest("mail.sent")}>Open</AppLink>
    </p>
  );
}

/** The top of Mail ▸ Sent: the run's rows (Sent, Waiting, Failed) and Stop. Nothing when no run is in the server's memory. */
export function SendingPanel({ project, batchId }: { project: string; batchId: number }) {
  const run = useShownRun(project, batchId);
  const stop = useBatchStop(project, batchId);
  if (!run) return null;
  return (
    <section aria-label="Sending now" aria-live="polite" className="flex flex-col gap-2 rounded-lg border p-3" data-testid="sending-panel">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold text-sm tabular-nums">{runTitle(run)}</h2>
        <span className="text-muted-foreground text-xs">one every {run.spacingSeconds} s</span>
        {run.state === "running" && (
          <ActionButton className="ms-auto" disabled={stop.isPending} onClick={() => stop.mutate()} size="s" variant="secondary">
            {stop.isPending ? "Stopping" : "Stop"}
          </ActionButton>
        )}
      </div>
      <ul aria-label="The run's mails" className="flex flex-col divide-y text-sm">
        {run.items.map((i) => (
          <li className="flex min-w-0 flex-wrap gap-x-2 py-1.5" key={i.draftId}>
            <span className="w-16 shrink-0 font-medium">{STATUS[i.status]}</span>
            <span className="min-w-0 flex-1 truncate">{whoOf(i)}</span>
            {i.reasons.length > 0 && <span className="w-full text-muted-foreground text-xs">{i.reasons.join("; ")}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

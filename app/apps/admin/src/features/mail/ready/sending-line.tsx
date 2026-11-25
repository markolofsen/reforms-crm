"use client";

import { ActionButton } from "@hub/ui/product/action-button";
import { useRefreshTopics } from "@/lib/cache/topics";
import { useClock } from "@/lib/clock";
import { useBatchRun, useBatchStop } from "@/lib/data/drafts";
import { useEffect, useRef } from "react";

// P147 3m item 5: the run of today's replies as one line on top of the list (Needs you, Leads, the review page).

/** A finished run's line stays this long after it ended, then leaves the list header. */
const SHOWN_AFTER_MS = 30 * 60_000;

/**
 * "Sending 12 of 35 · Stop" while the run goes, "Sent 35 of 35" (and what did not go) once it ended. Each mail sent reads the
 * drafts, the history and Mail again, so the rows turn Sent as it goes.
 */
export function SendingLine({ project, batchId, bare = false }: { project: string; batchId: number; bare?: boolean }) {
  const run = useBatchRun(project, batchId).data?.run ?? null;
  const now = useClock()();
  const stop = useBatchStop(project, batchId);
  const refresh = useRefreshTopics(project);
  const done = run ? run.items.filter((i) => i.status !== "waiting" && i.status !== "sending").length : 0;
  const seen = useRef(-1);
  useEffect(() => {
    if (seen.current !== -1 && seen.current !== done) void refresh(["sends", "mail", "drafts", "inbox"]);
    seen.current = done;
  }, [done, refresh]);
  if (!run || (run.state !== "running" && run.finishedAt !== null && now - Date.parse(run.finishedAt) > SHOWN_AFTER_MS)) return null;
  const sent = run.items.filter((i) => i.status === "sent").length;
  const missed = run.items.filter((i) => i.status === "refused" || i.status === "failed");
  const total = run.items.length;
  const text = run.state === "running" ? `Sending ${sent} of ${total}` : `${run.state === "stopped" ? "Stopped: sent" : "Sent"} ${sent} of ${total}`;
  return (
    <p aria-live="polite" className={`flex min-w-0 flex-wrap items-center gap-2 text-sm tabular-nums ${bare ? "" : "py-2"}`} data-testid="sending-line">
      <span>{text}</span>
      {missed.length > 0 && <span className="text-muted-foreground">· {missed.length} not sent: {missed.map((m) => `${m.name} (${m.reasons.join("; ") || m.status})`).join(", ")}</span>}
      {run.state === "running" && (
        <ActionButton disabled={stop.isPending} onClick={() => stop.mutate()} size="s" variant="quiet">
          {stop.isPending ? "Stopping" : "Stop"}
        </ActionButton>
      )}
    </p>
  );
}

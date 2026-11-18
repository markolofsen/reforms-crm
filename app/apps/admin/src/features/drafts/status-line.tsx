"use client";

import { ChevronRightIcon } from "lucide-react";
import type { StatusDto, StatusLevel } from "@hub/contract/overview";
import { ActionButton } from "@hub/ui/product/action-button";
import { Skeleton } from "@hub/ui/skeleton";
import { cn } from "@hub/ui/cn";
import { AppLink } from "@/components/app-link";
import { useClock } from "@/lib/clock";
import { ago, plural } from "@/lib/format";
import { useLiveState, type LiveState } from "@/lib/cache/live";
import { usePulse } from "@/lib/cache/pulse";
import { useProjectRow } from "@/lib/status";
import { paths, type Dest } from "@/routes/paths";

const LIVE_WORD: Record<Exclude<LiveState, "connecting">, string> = { live: "Live", reconnecting: "Reconnecting, data may be old" };

type Line = { level: StatusLevel; sentence: string; numbers: string[]; to: Dest | null; kind: string };

const DOT: Record<StatusLevel, string> = { clear: "bg-success", attention: "bg-warning", blocked: "bg-destructive" };
const NEXT: Record<NonNullable<StatusDto["next"]>, { to: () => Dest; label: string }> = {
  project: { to: () => paths.project.page(), label: "Open Project" },
  connections: { to: () => paths.connections.page(), label: "Open Connections" },
};

/** The words of the line: the worst fact once, then the two numbers the list does not show (the to-review count is the View menu's). */
export function lineOf(s: StatusDto, now: number, shell: { stale: boolean; serverOlder: boolean; serverNewer: boolean }): Line {
  const numbers = [s.numbers.lastTriageAt ? `triage ${ago(s.numbers.lastTriageAt, now)}` : "never triaged", ...(s.numbers.owed > 0 ? [`${plural(s.numbers.owed, "reply", "replies")} owed`] : [])];
  // What only the page can know outranks the server's own sentence: its data may be old, or the two do not match.
  if (shell.stale) return { level: "blocked", kind: "server-silent", sentence: "Server not answering: data may be old", numbers: [], to: null };
  if (shell.serverOlder) return { level: "attention", kind: "server-older", sentence: "Server older than this page: restart it with hub up", numbers: [], to: null };
  if (shell.serverNewer) return { level: "attention", kind: "server-newer", sentence: "Server newer than this page: reload it", numbers: [], to: null };
  return { level: s.level, kind: s.kind, sentence: s.sentence, numbers, to: s.next ? NEXT[s.next].to() : null };
}

/**
 * One status line at the top of the Drafts list (P48 W3): the project's worst fact said once, at most one link to where it
 * is fixed, and the reply-owed and last-triage numbers. Replaces the Overview of a one-project instance, the "still a
 * draft" paragraph and the Inbox block. It never repeats a count the View menu or the nav shows.
 */
export function StatusLine({ project }: { project: string }) {
  const { row, isError, refetch } = useProjectRow(project);
  const pulse = usePulse();
  const live = useLiveState();
  const now = useClock()();
  if (!row) {
    return isError ? (
      <div className="flex min-h-10 items-center gap-2 border-b px-3 text-sm" data-testid="status-line" role="status">
        <span className="min-w-0 flex-1 text-muted-foreground">Status unknown</span>
        <ActionButton onClick={refetch} size="s" variant="quiet">
          Retry
        </ActionButton>
      </div>
    ) : (
      <div className="flex min-h-10 items-center border-b px-3" data-testid="status-line-loading">
        <Skeleton className="h-4 w-2/3" />
        <span className="sr-only" role="status">Checking status</span>
      </div>
    );
  }
  const l = lineOf(row.status, now, pulse);
  const text = (
    <>
      <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", DOT[l.level])} />
      <span className="min-w-0 flex-1">
        <span className={cn(l.level === "clear" ? "text-muted-foreground" : "font-medium")}>{l.sentence}</span>
        {l.numbers.length > 0 && <span className="text-muted-foreground"> · {l.numbers.join(" · ")}</span>}
      </span>
      {live !== "connecting" && (
        <span className="shrink-0 text-xs text-muted-foreground" data-state={live} data-testid="live-state" title={live === "live" ? "Updates arrive as the agent writes" : "Live updates stopped; the page checks the server every 10 s"}>
          {LIVE_WORD[live]}
        </span>
      )}
    </>
  );
  return (
    <div className="border-b text-sm" data-kind={l.kind} data-level={l.level} data-testid="status-line" role="status">
      {l.to ? (
        <AppLink bare className="flex min-h-10 items-center gap-2 px-3 py-2 outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset" to={l.to}>
          {text}
          <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </AppLink>
      ) : (
        <div className="flex min-h-10 items-center gap-2 px-3 py-2">{text}</div>
      )}
    </div>
  );
}

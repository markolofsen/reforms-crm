"use client";

import { ChevronRightIcon } from "lucide-react";
import { MAIL_READ_RETRYABLE } from "@hub/contract/inbound";
import type { StatusDto, StatusLevel } from "@hub/contract/overview";
import { ActionButton } from "@hub/ui/product/action-button";
import { Skeleton } from "@hub/ui/skeleton";
import { cn } from "@hub/ui/cn";
import { AppLink } from "@/components/app-link";
import { useClock } from "@/lib/clock";
import { plural } from "@/lib/format";
import { useLiveState, type LiveState } from "@/lib/cache/live";
import { usePulse } from "@/lib/cache/pulse";
import { useProjectRow } from "@/lib/status";
import { paths, routeDest, type Dest } from "@/routes/paths";
import { NEXT_ROUTE } from "@/routes/sections";
import { CheckNow, mailReadText } from "./inbox/mail-read";

const LIVE_WORD: Record<Exclude<LiveState, "connecting">, string> = { live: "Live", reconnecting: "Reconnecting, data may be old" };

type Line = { level: StatusLevel; sentence: string; numbers: string[]; to: Dest | null; kind: string; /** P96: "1 client wrote" (a link to Inbox), or null. */ wrote: string | null; /** P96: the Mail reader's words, or null when the page itself is in doubt. */ read: string | null; /** P96: Check now belongs on the line (Mail closed, a failed read or a late one, and the line has no link of its own). */ check: boolean };

/** The reader's idle pass is every 15 minutes: a read older than that is late, and Check now comes to the line. */
const READ_STALE_MS = 15 * 60_000;
const DOT: Record<StatusLevel, string> = { clear: "bg-success", attention: "bg-warning", blocked: "bg-destructive" };
/** The page that fixes the fact (P70: Overview, Knowledge or a Settings pane). */
const nextDest = (next: NonNullable<StatusDto["next"]>): Dest => routeDest(NEXT_ROUTE[next]);

/**
 * The words of the line: the worst fact once, then what the list does not show (the to-review count is the View menu's). P96
 * verdict 5: "N clients wrote" (the Mail reader's Inbox, a link to it), "K replies owed" (the clients the agent left to the owner
 * and not already counted as wrote: one client once), and the reader's own line ("Mail read 2 min ago", or why not), which
 * replaced "triage 6 min ago": that was the newest agent record, not a read of Mail.
 */
export function lineOf(s: StatusDto, now: number, shell: { stale: boolean; serverOlder: boolean; serverNewer: boolean }): Line {
  const n = s.numbers;
  const owedOnly = Math.max(0, n.owed - n.wrote);
  const wrote = n.wrote > 0 ? `${plural(n.wrote, "client")} wrote` : null;
  const numbers = owedOnly > 0 ? [`${plural(owedOnly, "reply", "replies")} owed`] : [];
  // What only the page can know outranks the server's own sentence: its data may be old, or the two do not match.
  const doubt = { numbers: [], to: null, wrote: null, read: null, check: false };
  if (shell.stale) return { level: "blocked", kind: "server-silent", sentence: "Server not answering: data may be old", ...doubt };
  if (shell.serverOlder) return { level: "attention", kind: "server-older", sentence: "Server older than this page: restart it with hub up", ...doubt };
  if (shell.serverNewer) return { level: "attention", kind: "server-newer", sentence: "Server newer than this page: reload it", ...doubt };
  const r = n.mailRead;
  // Show less (ui-specifications 4a): a fresh read needs no button here; Inbox always has Check now.
  const stale = !r.reading && (r.reason !== null ? MAIL_READ_RETRYABLE.includes(r.reason) : r.at !== null && now - Date.parse(r.at) > READ_STALE_MS);
  return { level: s.level, kind: s.kind, sentence: s.sentence, numbers, to: s.next ? nextDest(s.next) : null, wrote, read: mailReadText(r, now), check: stale && !s.next };
}

/**
 * One status line at the top of the Mail list (P48 W3, P96): the project's worst fact said once, at most one link to where it
 * is fixed, the clients who wrote (a link to Inbox), the replies owed, and when Mail was read, with Check now. Replaces the Overview of a one-project instance, the "still a
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
      <span className={cn("min-w-0", l.level === "clear" ? "text-muted-foreground" : "font-medium")}>{l.sentence}</span>
      {l.to && <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
    </>
  );
  const ring = "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-1.5 text-sm" data-kind={l.kind} data-level={l.level} data-testid="status-line" role="status">
      {l.to ? (
        <AppLink bare className={cn("-mx-1 flex min-h-11 items-center lg:min-h-8 gap-2 rounded-sm px-1 hover:bg-accent/50", ring)} data-testid="status-next" to={l.to}>
          {text}
        </AppLink>
      ) : (
        <span className="flex min-h-11 items-center gap-2 lg:min-h-8">{text}</span>
      )}
      {l.wrote && (
        <span className="text-muted-foreground">
          {"· "}
          <AppLink className="font-medium text-foreground" data-testid="status-wrote" to={paths.mail.list({ filter: "inbox" })}>
            {l.wrote}
          </AppLink>
        </span>
      )}
      {l.numbers.length > 0 && <span className="text-muted-foreground">· {l.numbers.join(" · ")}</span>}
      {/* Show less (ui-specifications 4a): on a phone the reader's words live in Inbox; Check now comes here only when the read is late or failed and the line has no link of its own. Inbox always has both. */}
      {l.read && (
        <span className="hidden min-w-0 items-center gap-1 text-muted-foreground sm:flex" data-testid="mail-read">
          · {l.read}
          {l.check && <CheckNow project={project} />}
        </span>
      )}
      {live !== "connecting" && (
        <span className="ms-auto shrink-0 text-xs text-muted-foreground" data-state={live} data-testid="live-state" title={live === "live" ? "Updates arrive as the agent writes" : "Live updates stopped; the page checks the server every 10 s"}>
          {LIVE_WORD[live]}
        </span>
      )}
    </div>
  );
}

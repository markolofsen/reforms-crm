"use client";

import type { LeadRowDto, LeadsReadDto } from "@hub/contract/inbound";
import { cn } from "@hub/ui/cn";
import { ConversationList } from "@hub/ui/product/conversation";
import { AppLink } from "@/components/app-link";
import { ago, plural } from "@/lib/format";
import type { Dest } from "@/routes/paths";

/** The Leads line: when Notion Leads were last read, or why not (no token, a failed read, demo mode). */
export function leadsReadText(r: LeadsReadDto, now: number): string {
  if (r.reading) return "Reading Notion Leads…";
  if (r.reason) return r.reason;
  return r.at ? `Leads read ${ago(r.at, now)}` : "Leads not read yet";
}

function LeadRow({ r, open, now, to }: { r: LeadRowDto; open: boolean; now: number; to: Dest }) {
  return (
    <li className={cn("relative border-b", open && "bg-accent")} data-open={open} data-testid="lead-row">
      {open && <span aria-hidden="true" className="absolute inset-y-0 start-0 w-[3px] bg-primary" />}
      <AppLink
        aria-current={open ? "true" : undefined}
        bare
        className="flex min-h-16 min-w-0 flex-col gap-0.5 px-3 py-2 text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        to={to}
      >
        <span className="flex w-full min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
          <span className="shrink-0 text-muted-foreground text-xs tabular-nums">{ago(r.receivedAt, now)}</span>
        </span>
        <span className="w-full min-w-0 truncate">
          {r.email ?? "No email: reply on the channel they gave"}
          {r.brand ? ` · ${r.brand}` : ""}
        </span>
        {(r.preview || r.requests > 1) && (
          <span className="w-full min-w-0 truncate text-muted-foreground text-xs" data-testid="lead-preview">
            {r.requests > 1 ? `${r.requests} requests · ` : ""}
            {r.preview}
          </span>
        )}
      </AppLink>
    </li>
  );
}

/**
 * The rows of one view of Mail ▸ Leads (P97 S2, decision 0044; P134 verdict 6): one row per person, newest first, each opening
 * the lead's card (`/mail/leads/<page id>`). Every lead of the view, paged by the host: no "30 of 43" cut.
 */
export function LeadRows({ rows, openPageId, now, rowTo }: { rows: readonly LeadRowDto[]; openPageId: string | null; now: number; rowTo: (pageId: string) => Dest }) {
  return (
    <ConversationList ariaLabel="Leads">
      {rows.map((r) => (
        <LeadRow key={r.pageId} now={now} open={r.pageId === openPageId} r={r} to={rowTo(r.pageId)} />
      ))}
    </ConversationList>
  );
}

/** Under the rows of New: the older New leads (outside the window, one muted count: the Hub never writes them) and the read line. */
export function LeadsReadLine({ read, now, older }: { read: LeadsReadDto; now: number; older: boolean }) {
  return (
    <div className="flex flex-col gap-1 px-3 py-2 text-muted-foreground text-xs">
      {older && read.older > 0 && (
        <p className="measure" data-testid="leads-older">
          {plural(read.older, "older lead")} still New (before the last {read.windowDays} days) · open them in Notion
        </p>
      )}
      <p data-testid="leads-read" role="status">
        {leadsReadText(read, now)}
      </p>
    </div>
  );
}

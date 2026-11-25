"use client";

import type { LeadRowDto, LeadsReadDto } from "@hub/contract/inbound";
import { Badge } from "@hub/ui/badge";
import { cn } from "@hub/ui/cn";
import { ConversationList } from "@hub/ui/product/conversation";
import { AppLink } from "@/components/app-link";
import { ago, plural } from "@/lib/format";
import type { Dest } from "@/routes/paths";
import { factChips, isNewSince, leadDays } from "./groups";
import { PassChip } from "./review/pass";

/** The Leads line: when Notion Leads were last read, or why not (no token, a failed read, demo mode). */
export function leadsReadText(r: LeadsReadDto, now: number): string {
  if (r.reading) return "Reading Notion Leads…";
  if (r.reason) return r.reason;
  return r.at ? `Leads read ${ago(r.at, now)}` : "Leads not read yet";
}

function LeadRow({ r, open, now, to, fresh }: { r: LeadRowDto; open: boolean; now: number; to: Dest; fresh: boolean }) {
  const chips = factChips(r.facts);
  return (
    <li className={cn("relative border-b", open && "bg-accent")} data-lead={r.pageId} data-new={fresh || undefined} data-open={open} data-testid="lead-row">
      {open && <span aria-hidden="true" className="absolute inset-y-0 start-0 w-[3px] bg-primary" />}
      <AppLink
        aria-current={open ? "true" : undefined}
        bare
        className="flex min-h-16 min-w-0 flex-col gap-1 px-3 py-2 text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        to={to}
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          {fresh && (
            <span className="size-2 shrink-0 rounded-full bg-primary" data-testid="lead-new-dot">
              <span className="sr-only">New since your last visit: </span>
            </span>
          )}
          <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
          {r.brand && <span className="max-w-[40%] shrink-0 truncate text-muted-foreground text-xs">{r.brand}</span>}
          <span className="shrink-0 text-muted-foreground text-xs tabular-nums">{ago(r.receivedAt, now)}</span>
        </span>
        <span className="w-full min-w-0 truncate" data-testid="lead-site">
          {r.facts.site ?? r.email ?? "No email: reply on the channel they gave"}
        </span>
        {(chips.length > 0 || r.requests > 1 || r.pass) && (
          <span className="flex w-full min-w-0 flex-wrap gap-1" data-testid="lead-chips">
            <PassChip pass={r.pass} />
            {chips.map((c) => (
              <Badge key={c} variant="secondary">
                {c}
              </Badge>
            ))}
            {r.requests > 1 && <Badge variant="outline">{r.requests} requests</Badge>}
          </span>
        )}
        {chips.length === 0 && r.preview && (
          <span className="w-full min-w-0 truncate text-muted-foreground text-xs" data-testid="lead-preview">
            {r.preview}
          </span>
        )}
      </AppLink>
    </li>
  );
}

/**
 * The rows of one view of Mail ▸ Leads (P97 S2; P134 verdict 6; P138 verdict 6): one row per person, newest first, under a heading
 * per local day (Today, Yesterday, the date). A row: name, brand, time; the company website or the first site they named; chips
 * of country, segment and volume; a dot when it arrived after the last visit. Each opens the lead's card.
 */
export function LeadRows({ rows, openPageId, now, rowTo, seen }: { rows: readonly LeadRowDto[]; openPageId: string | null; now: number; rowTo: (pageId: string) => Dest; seen: string | null }) {
  return (
    <div className="flex min-w-0 flex-col" data-testid="lead-days">
      {leadDays(rows, now).map((d) => (
        <section aria-labelledby={`lead-day-${d.day}`} key={d.day}>
          <h4 className="border-b bg-muted/30 px-3 py-1.5 font-medium text-muted-foreground text-xs" data-testid="lead-day" id={`lead-day-${d.day}`}>
            {d.label}
          </h4>
          <ConversationList ariaLabel={`Leads of ${d.label}`}>
            {d.rows.map((r) => (
              <LeadRow fresh={isNewSince(r, seen)} key={r.pageId} now={now} open={r.pageId === openPageId} r={r} to={rowTo(r.pageId)} />
            ))}
          </ConversationList>
        </section>
      ))}
    </div>
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

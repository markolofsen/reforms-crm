"use client";

import type { LeadRowDto, LeadsGroupDto } from "@hub/contract/inbound";
import { cn } from "@hub/ui/cn";
import { AppLink } from "@/components/app-link";
import { ago, plural } from "@/lib/format";
import { paths } from "@/routes/paths";

/** The Leads line: when Notion Leads were last read, or why not (no token, a failed read, demo mode). */
export function leadsReadText(r: LeadsGroupDto["read"], now: number): string {
  if (r.reading) return "Reading Notion Leads…";
  if (r.reason) return r.reason;
  return r.at ? `Leads read ${ago(r.at, now)}` : "Leads not read yet";
}

function LeadRow({ r, open, now }: { r: LeadRowDto; open: boolean; now: number }) {
  return (
    <li className={cn("relative border-b", open && "bg-accent")} data-open={open} data-testid="lead-row">
      {open && <span aria-hidden="true" className="absolute inset-y-0 start-0 w-[3px] bg-primary" />}
      <AppLink
        aria-current={open ? "true" : undefined}
        bare
        className="flex min-h-16 min-w-0 flex-col gap-0.5 px-3 py-2 text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        to={paths.mail.lead(r.pageId, { filter: "inbox" })}
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
 * Mail ▸ Inbox's Leads group (P97 S2, decision 0044): the project's Notion Leads still New, received in the last
 * `leads.window_days`, one row per person, above the clients who wrote. A row opens the lead's card (`/mail/lead/<page id>`).
 * The older New leads are one muted count: the Hub never writes them. A notice mail of the site is never a row here.
 */
export function LeadsGroup({ group, openPageId, now }: { group: LeadsGroupDto; openPageId: string | null; now: number }) {
  const { rows, total, read } = group;
  if (rows.length === 0 && read.older === 0 && !read.reason) return null;
  return (
    <section aria-label="New leads" className="flex flex-col border-b" data-testid="leads-group">
      {rows.length > 0 && (
        <>
          <h3 className="px-3 pt-2 pb-1 font-medium text-muted-foreground text-xs">
            New leads ({total > rows.length ? `${rows.length} of ${total}` : total})
          </h3>
          <ul aria-label="New leads" className="flex flex-col">
            {rows.map((r) => (
              <LeadRow key={r.pageId} now={now} open={r.pageId === openPageId} r={r} />
            ))}
          </ul>
        </>
      )}
      <div className="flex flex-col gap-1 px-3 py-2 text-muted-foreground text-xs">
        {read.older > 0 && (
          <p className="measure" data-testid="leads-older">
            {plural(read.older, "older lead")} still New (before the last {read.windowDays} days) · open them in Notion
          </p>
        )}
        <p data-testid="leads-read" role="status">
          {leadsReadText(read, now)}
        </p>
      </div>
    </section>
  );
}

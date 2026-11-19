import type { KnowledgeEntryDto } from "@hub/contract/knowledge";
import { Badge } from "@hub/ui/badge";
import { cn } from "@hub/ui/cn";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/data-table";
import { LocalActionButton } from "@/components/local-action";
import { STATUS_LOOK, forText, type Facets } from "./labels";

type Props = { project: string; entries: readonly KnowledgeEntryDto[]; facets: Facets };

/** A status that is not the normal one, as a badge; nothing for an approved entry. */
function Status({ e }: { e: KnowledgeEntryDto }) {
  const look = STATUS_LOOK[e.status];
  return look.badge ? <Badge variant={look.badge}>{look.word}</Badge> : null;
}

/** The entry's Open (P61): the file in its own app, at the row's end; it renders nothing where this machine cannot open. */
function Open({ project, e }: { project: string; e: KnowledgeEntryDto }) {
  return (
    <LocalActionButton action="file.open" args={{ project, key: e.key }}>
      <span>
        Open<span className="sr-only"> {e.title}</span>
      </span>
    </LocalActionButton>
  );
}

const day = (v: string | null): string => (v ? v.slice(0, 10) : "");
/** The date is quiet; it speaks up only when the entry has run out or is about to. */
const dayTone = (e: KnowledgeEntryDto): string => (e.status === "expired" ? "text-destructive-foreground" : e.status === "expiring" ? "text-warning-foreground" : "text-muted-foreground");

/**
 * Every entry of the knowledge base, one row each (P70): its title, who can find it, its status, the day it is valid until, and
 * its Open. A column whose value is the same on every entry is left out and said once above the table (UX pass 2026-11-20:
 * "Client, lead" and "Approved" on all 57 rows were noise): For only when the audiences differ (brands only when they differ),
 * Status only when an entry is not approved, and then only on that row. From 640px a table; below it two lines a row (the title
 * and Open; then the rest), so no column hides behind a click (`admin-principles.md` rule 5).
 */
export function EntryTable({ project, entries, facets }: Props) {
  const showFor = facets.sameAudiences === null || facets.brandsDiffer;
  const showStatus = !facets.allApproved;
  const meta = (e: KnowledgeEntryDto) => [showFor ? forText(e, facets.brandsDiffer) : null, e.validUntil ? `until ${day(e.validUntil)}` : null].filter(Boolean).join(" · ");
  return (
    <>
      <DataTable aria-label="Knowledge entries" className="max-md:hidden" data-testid="knowledge-table">
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            {showFor && <TableHead className="w-1/5">For</TableHead>}
            {showStatus && <TableHead className="w-3/20">Status</TableHead>}
            <TableHead className="w-1/8">Valid until</TableHead>
            <TableHead className="w-1/10">
              <span className="sr-only">Open</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((e) => (
            <TableRow data-entry={e.key} data-status={e.status} key={e.key}>
              <TableCell className="break-words font-medium">{e.title}</TableCell>
              {showFor && <TableCell className={cn("break-words", e.audiences.length === 0 ? "text-warning-foreground" : "text-muted-foreground")}>{forText(e, facets.brandsDiffer)}</TableCell>}
              {showStatus && (
                <TableCell>
                  <Status e={e} />
                </TableCell>
              )}
              <TableCell className={cn("tabular-nums", dayTone(e))}>
                {/* The table's cells wrap by design; a date never splits at its dashes. */}
                <span className="whitespace-nowrap">{day(e.validUntil)}</span>
              </TableCell>
              <TableCell className="text-end">
                <Open e={e} project={project} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </DataTable>
      <ul aria-label="Knowledge entries" className="flex flex-col divide-y md:hidden">
        {entries.map((e) => (
          <li className="flex min-w-0 flex-col gap-1 py-2 text-sm" data-entry={e.key} data-status={e.status} key={e.key}>
            <p className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 break-words font-medium">{e.title}</span>
              <Open e={e} project={project} />
            </p>
            {(meta(e) || STATUS_LOOK[e.status].badge) && (
              <p className={cn("flex flex-wrap items-center gap-x-2 break-words text-xs", dayTone(e))}>
                <Status e={e} />
                <span className="tabular-nums">{meta(e)}</span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

import type { KnowledgeEntryDto } from "@hub/contract/knowledge";
import { cn } from "@hub/ui/cn";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/data-table";
import { LocalActionButton } from "@/components/local-action";
import { STATUS_LOOK, forText } from "./labels";

type Props = { project: string; entries: readonly KnowledgeEntryDto[]; byBrand: boolean };

function Status({ e }: { e: KnowledgeEntryDto }) {
  const look = STATUS_LOOK[e.status];
  return <span className={look.problem ? "text-warning-foreground" : "text-muted-foreground"}>{look.word}</span>;
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

/**
 * Every entry of the knowledge base, one row each (P70): its title, who can find it (audiences, and brands in a by-brand
 * project), its status in words, the day it is valid until, and its Open. From 640px a table; below it two lines a row (the
 * title and Open; then who, status and the date), so no column hides behind a click (`admin-principles.md` rule 5).
 */
export function EntryTable({ project, entries, byBrand }: Props) {
  return (
    <>
      <DataTable aria-label="Knowledge entries" className="max-md:hidden" data-testid="knowledge-table">
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead className="w-1/5">For</TableHead>
            <TableHead className="w-3/20">Status</TableHead>
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
              <TableCell className={cn("break-words", e.audiences.length === 0 ? "text-warning-foreground" : "text-muted-foreground")}>{forText(e, byBrand)}</TableCell>
              <TableCell>
                <Status e={e} />
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">{day(e.validUntil)}</TableCell>
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
            <p className="break-words text-muted-foreground text-xs">
              {forText(e, byBrand)} · <Status e={e} />
              {e.validUntil && <span className="tabular-nums"> · until {day(e.validUntil)}</span>}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

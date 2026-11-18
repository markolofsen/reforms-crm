import type { ActivityRowDto, ActivitySessionDto } from "@hub/contract/activity";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/data-table";
import { AppLink } from "@/components/app-link";
import { hhmm } from "@/lib/format";
import { paths } from "@/routes/paths";
import type { RunFilter } from "@/routes/search";
import { rowCells, sessionHeading } from "./labels";

type Props = { sessions: readonly ActivitySessionDto[]; filter: RunFilter; open: number | null };

/** The client's name; when the row made or points at a draft, a link into that draft's card. */
function Who({ row, name }: { row: ActivityRowDto; name: string }) {
  if (row.draftId === null || name === "") return <>{name}</>;
  return (
    <AppLink className="text-foreground text-sm" to={paths.drafts.item(row.draftId)}>
      {name}
      <span className="sr-only"> (open the draft)</span>
    </AppLink>
  );
}

/** A session heading opens the session in the detail (`?run=`): a real link, so Back closes it again. */
function Heading({ s, filter, open }: { s: ActivitySessionDto; filter: RunFilter; open: number | null }) {
  return (
    <AppLink aria-current={open === s.runId ? "true" : undefined} className="font-medium text-foreground text-sm aria-[current=true]:underline" to={paths.log.list({ filter, run: s.runId })}>
      {sessionHeading(s)}
    </AppLink>
  );
}

/**
 * From the split width of the list-detail (`@4xl`): one table, newest session first, a heading row per session and one row per thing the agent did, with the
 * outcome and the reason in the row (nothing behind a click). Each session is its own `tbody`.
 */
export function SessionTable({ sessions, filter, open }: Props) {
  return (
    <DataTable aria-label="Activity" className="@max-4xl:hidden">
      <TableHeader>
        <TableRow>
          <TableHead className="w-1/12">When</TableHead>
          <TableHead className="w-1/6">Client</TableHead>
          <TableHead className="w-1/6">What happened</TableHead>
          <TableHead>Why</TableHead>
          <TableHead className="w-1/8">Skill</TableHead>
        </TableRow>
      </TableHeader>
      {sessions.map((s) => (
        <TableBody data-run={s.runId} key={s.runId}>
          <TableRow data-session-head="">
            <TableHead className="whitespace-normal bg-muted/40" colSpan={5} scope="colgroup">
              <Heading filter={filter} open={open} s={s} />
            </TableHead>
          </TableRow>
          {s.rows.map((r) => {
            const { who, what, why } = rowCells(r);
            return (
              <TableRow data-row="" key={r.id}>
                <TableCell className="text-muted-foreground tabular-nums">{hhmm(r.at)}</TableCell>
                <TableCell>
                  <Who name={who} row={r} />
                </TableCell>
                <TableCell>{what}</TableCell>
                <TableCell>{why}</TableCell>
                <TableCell className="text-muted-foreground">{s.skill ?? ""}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      ))}
    </DataTable>
  );
}

/** Narrower than the split: the same rows as two lines each (client and what happened; when and why), so no column hides behind a click. */
export function SessionRows({ sessions, filter, open }: Props) {
  return (
    <div className="flex flex-col gap-4 @4xl:hidden">
      {sessions.map((s) => (
        <section aria-label={sessionHeading(s)} data-run={s.runId} key={s.runId}>
          <h3 className="border-b pb-1">
            <Heading filter={filter} open={open} s={s} />
          </h3>
          <ul aria-label={`What the agent did, ${sessionHeading(s)}`} className="flex flex-col divide-y">
            {s.rows.map((r) => {
              const { who, what, why } = rowCells(r);
              return (
                <li className="flex min-w-0 flex-col gap-0.5 py-2 text-sm" data-row="" key={r.id}>
                  <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    {who && (
                      <span className="font-medium">
                        <Who name={who} row={r} />
                      </span>
                    )}
                    <span>{what}</span>
                  </p>
                  <p className="break-words text-muted-foreground text-xs">
                    <span className="tabular-nums">{hhmm(r.at)}</span>
                    {why && ` · ${why}`}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

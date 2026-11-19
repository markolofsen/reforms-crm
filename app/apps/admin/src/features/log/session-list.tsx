import { ChevronDownIcon } from "lucide-react";
import { useId, useState } from "react";
import type { ActivitySessionDto } from "@hub/contract/activity";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@hub/ui/collapsible";
import { ActionButton } from "@hub/ui/product/action-button";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/data-table";
import { AppLink } from "@/components/app-link";
import { paths } from "@/routes/paths";
import type { RunFilter } from "@/routes/search";
import { entryTime, groupCells, groupRows, reasonParts, type RowGroup, sessionHeading } from "./labels";

type Props = { sessions: readonly ActivitySessionDto[]; filter: RunFilter; open: number | null };

/** The client's name; when the line points at one draft, a link into that draft's card. */
function Who({ draftId, name }: { draftId: number | null; name: string }) {
  if (draftId === null || name === "") return <>{name}</>;
  return (
    <AppLink className="text-foreground text-sm" to={paths.drafts.item(draftId)}>
      {name}
      <span className="sr-only"> (open the draft)</span>
    </AppLink>
  );
}

/** An entry's time; when it made or points at a draft, a link into that card. */
function EntryTime({ at, headingAt, draftId }: { at: string; headingAt: string; draftId: number | null }) {
  const when = entryTime(at, headingAt);
  if (draftId === null) return <>{when}</>;
  return (
    <AppLink to={paths.drafts.item(draftId)}>
      {when}
      <span className="sr-only"> (open the draft)</span>
    </AppLink>
  );
}

/** The phrase, and under it the agent's own words, muted. */
function Why({ why, detail }: { why: string; detail: string | null }) {
  return (
    <>
      {why}
      {detail && <span className="block break-words text-muted-foreground text-xs">{detail}</span>}
    </>
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

/** One line of the table; a folded line (same client, same outcome, in a row) opens its entries as rows under it. */
function GroupRow({ g, s }: { g: RowGroup; s: ActivitySessionDto }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const c = groupCells(g, s.startedAt);
  return (
    <>
      <TableRow data-count={c.count > 1 ? c.count : undefined} data-row="">
        <TableCell className="text-muted-foreground tabular-nums">{c.when}</TableCell>
        <TableCell>
          <Who draftId={c.draftId} name={c.who} />
        </TableCell>
        <TableCell>
          {c.what}
          {c.count > 1 && (
            <ActionButton aria-controls={open ? id : undefined} aria-expanded={open} className="group ms-1 gap-1 px-2 tabular-nums" onClick={() => setOpen((v) => !v)} size="s" variant="quiet">
              ×{c.count}
              <span className="sr-only"> times, each time</span>
              <ChevronDownIcon aria-hidden="true" className="transition-transform group-aria-expanded:rotate-180 motion-reduce:transition-none" />
            </ActionButton>
          )}
        </TableCell>
        <TableCell>
          <Why detail={c.detail} why={c.why} />
        </TableCell>
        <TableCell className="text-muted-foreground">{s.skill ?? ""}</TableCell>
      </TableRow>
      {c.count > 1 &&
        open &&
        g.rows.map((r, i) => {
          const p = reasonParts(r);
          return (
            <TableRow data-entry="" id={i === 0 ? id : undefined} key={r.id}>
              <TableCell className="ps-6 text-muted-foreground tabular-nums">
                <EntryTime at={r.at} draftId={r.draftId} headingAt={s.startedAt} />
              </TableCell>
              <TableCell colSpan={2} />
              <TableCell>
                <Why detail={c.detail === null ? p.detail : null} why={c.why === "" ? p.why : ""} />
              </TableCell>
              <TableCell />
            </TableRow>
          );
        })}
    </>
  );
}

/**
 * From the split width of the list-detail (`@4xl`): one table, newest session first, a heading row per session and one row per thing the agent did, with the
 * outcome and the reason in the row (nothing behind a click). The same client with the same outcome in a row is one line with its count ("Drafted ×6"),
 * whose entries open under it. Each session is its own `tbody`.
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
          {groupRows(s.rows).map((g) => (
            <GroupRow g={g} key={g.rows[0].id} s={s} />
          ))}
        </TableBody>
      ))}
    </DataTable>
  );
}

/** A line of the narrow list: client and what happened; when and why; a folded line's entries behind its count. */
function GroupItem({ g, s }: { g: RowGroup; s: ActivitySessionDto }) {
  const c = groupCells(g, s.startedAt);
  const line = (
    <p className="break-words text-muted-foreground text-xs">
      <span className="tabular-nums">{c.when}</span>
      {c.why && ` · ${c.why}`}
      {c.detail && <span className="block">{c.detail}</span>}
    </p>
  );
  return (
    <li className="flex min-w-0 flex-col gap-0.5 py-2 text-sm" data-count={c.count > 1 ? c.count : undefined} data-row="">
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        {c.who && (
          <span className="font-medium">
            <Who draftId={c.draftId} name={c.who} />
          </span>
        )}
        <span>{c.what}</span>
      </p>
      {c.count === 1 ? (
        line
      ) : (
        <Collapsible>
          {line}
          <CollapsibleTrigger className="group -ms-2 gap-1 px-2 tabular-nums" render={<ActionButton size="s" variant="quiet" />}>
            ×{c.count}
            <span className="sr-only"> times, each time</span>
            <ChevronDownIcon aria-hidden="true" className="transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none" />
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <ul aria-label={`Each time, ${c.who}`} className="flex flex-col gap-1 ps-2 text-muted-foreground text-xs">
              {g.rows.map((r) => {
                const p = reasonParts(r);
                const why = [c.why === "" ? p.why : "", c.detail === null ? p.detail : ""].filter(Boolean).join(" · ");
                return (
                  <li className="break-words" data-entry="" key={r.id}>
                    <span className="tabular-nums">
                      <EntryTime at={r.at} draftId={r.draftId} headingAt={s.startedAt} />
                    </span>
                    {why && ` · ${why}`}
                  </li>
                );
              })}
            </ul>
          </CollapsiblePanel>
        </Collapsible>
      )}
    </li>
  );
}

/** Narrower than the split: the same lines as two lines each (client and what happened; when and why), so no column hides behind a click. */
export function SessionRows({ sessions, filter, open }: Props) {
  return (
    <div className="flex flex-col gap-4 @4xl:hidden">
      {sessions.map((s) => (
        <section aria-label={sessionHeading(s)} data-run={s.runId} key={s.runId}>
          <h3 className="border-b pb-1">
            <Heading filter={filter} open={open} s={s} />
          </h3>
          <ul aria-label={`What the agent did, ${sessionHeading(s)}`} className="flex flex-col divide-y">
            {groupRows(s.rows).map((g) => (
              <GroupItem g={g} key={g.rows[0].id} s={s} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

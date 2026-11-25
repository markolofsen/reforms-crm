"use client";

import { useRef, useState } from "react";
import { clientKey } from "@hub/contract/client-key";
import type { FollowUpDto } from "@hub/contract/follow-ups";
import { ActionButton } from "@hub/ui/product/action-button";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/list/data-table";
import { AppLink } from "@/components/app-link";
import { ChangeDate, useFollowUpMoves } from "@/components/follow-up/moves";
import { channelWord, moves as movesOf, nextWord, sentWord, stateWord } from "@/components/follow-up/words";
import { EmptyState, ListSkeleton, QueryView } from "@/components/state-views";
import { useFollowUps } from "@/lib/data/project";
import { dest } from "@/routes/paths";

type Moves = ReturnType<typeof useFollowUpMoves>;

/** The client's name, leading into the conversation (Open conversation: an Open lives on the thing it opens). */
function Name({ r }: { r: FollowUpDto }) {
  return (
    <AppLink aria-label={`Open conversation with ${r.name}`} className="font-medium text-foreground" to={dest("mail.conversation", { key: clientKey({ id: r.clientId }) }, { filter: "all" })}>
      {r.name}
    </AppLink>
  );
}

/** Change date, Stop and Resume of one plan; the date field opens anchored to its button. */
function Controls({ r, m }: { r: FollowUpDto; m: Moves }) {
  const [dating, setDating] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const can = movesOf(r);
  return (
    <span className="flex flex-wrap items-center gap-1">
      <ActionButton aria-label={`Change the follow-up date for ${r.name}`} disabled={m.pending} onClick={() => setDating(true)} ref={anchor} size="s" variant="secondary">
        Change date
      </ActionButton>
      {can.stop && (
        <ActionButton aria-label={`Stop follow-ups for ${r.name}`} disabled={m.pending} onClick={() => m.stop(r)} size="s" variant="danger">
          Stop
        </ActionButton>
      )}
      {can.resume && (
        <ActionButton aria-label={`Resume follow-ups for ${r.name}`} disabled={m.pending} onClick={() => m.resume(r)} size="s" variant="secondary">
          Resume
        </ActionButton>
      )}
      {dating && <ChangeDate anchor={anchor} moves={m} onOpenChange={setDating} open={dating} r={r} />}
    </span>
  );
}

/** From 768px a table (client, channel, state, next, why, sent, moves); below it each plan is three lines. */
function FollowUpsTable({ rows, m }: { rows: readonly FollowUpDto[]; m: Moves }) {
  return (
    <>
      <DataTable aria-label="Follow-up plans" className="max-md:hidden">
        <TableHeader>
          <TableRow>
            <TableHead className="w-1/6">Client</TableHead>
            <TableHead className="w-1/12">Channel</TableHead>
            <TableHead className="w-1/8">State</TableHead>
            <TableHead className="w-1/12">Next</TableHead>
            <TableHead>Why</TableHead>
            <TableHead className="w-1/12">Sent</TableHead>
            <TableHead className="w-1/5">Change</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow data-follow-up={r.clientId} data-state={r.display} key={r.clientId}>
              <TableCell>
                <Name r={r} />
              </TableCell>
              <TableCell>{channelWord(r)}</TableCell>
              <TableCell>{stateWord(r)}</TableCell>
              <TableCell className="tabular-nums">{nextWord(r)}</TableCell>
              <TableCell className="text-muted-foreground">{r.reason ?? ""}</TableCell>
              <TableCell className="tabular-nums">{sentWord(r)}</TableCell>
              <TableCell>
                <Controls m={m} r={r} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </DataTable>
      <ul aria-label="Follow-up plans" className="flex flex-col divide-y md:hidden">
        {rows.map((r) => (
          <li className="flex min-w-0 flex-col gap-1 py-2 text-sm" data-follow-up={r.clientId} key={r.clientId}>
            <p className="flex flex-wrap items-baseline gap-x-2">
              <Name r={r} />
              <span className="text-muted-foreground text-xs">
                {stateWord(r)} · {channelWord(r)} · next {nextWord(r)} · {sentWord(r)}
              </span>
            </p>
            {r.reason && <p className="break-words text-muted-foreground text-xs">{r.reason}</p>}
            <Controls m={m} r={r} />
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Activity ▸ Follow-ups (P142 F6, verdict 15; the precedent is Sends with Cancel): one row per client with a plan of the daily
 * sweep, in the server's order, with the owner's moves (Change date, Stop with Undo, Resume) and the name leading into the
 * conversation. The agent decides; the owner only delays or stops (`admin-principles.md` rule 1). Nothing here sends.
 */
export function FollowUpsView({ project }: { project: string }) {
  const q = useFollowUps(project);
  const m = useFollowUpMoves(project);
  return (
    <div className="flex flex-col gap-2" data-testid="follow-ups-view">
      <QueryView loading={<ListSkeleton label="Loading the follow-ups" />} query={q} what="the follow-ups">
        {(d) =>
          d.rows.length === 0 ? (
            <EmptyState title="No follow-up plans yet">The daily sweep writes one for each client whose last message is ours: Run follow-ups now on Overview, or wait for {d.sweep.at}.</EmptyState>
          ) : (
            <FollowUpsTable m={m} rows={d.rows} />
          )
        }
      </QueryView>
      <p className="text-destructive-foreground text-sm" role="alert">
        {m.error ?? ""}
      </p>
    </div>
  );
}

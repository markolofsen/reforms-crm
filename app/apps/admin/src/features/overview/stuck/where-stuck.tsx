"use client";

import { CircleSlashIcon, HourglassIcon } from "lucide-react";
import { clientKey } from "@hub/contract/client-key";
import type { StuckClientsDto } from "@hub/contract/client-map";
import { SectionTitle } from "@hub/ui/product/shell/page";
import { AppLink } from "@/components/app-link";
import { ListSkeleton, QueryView } from "@/components/state-views";
import { useStuckClients } from "@/lib/data/conversations";
import { dest } from "@/routes/paths";
import { stuckWord, stuckTotal } from "./model";

/**
 * P136 Q7 (verdict 7f): Overview's "Where we are stuck": per project, the clients whose map has a `blocked` node or a `waiting`
 * one of 7 days or more, most stuck first (the server's order), each node with its word ("Blocked", "Waiting 9 days") beside its
 * icon, the client's name leading into his conversation. One read per project (`GET .../client-maps/stuck`), each with its own
 * loading and error; nobody stuck says so in one line. Refetched when a map moves (the `clients` topic, under `drafts`).
 */
function ProjectStuck({ data, multi, now }: { data: StuckClientsDto; multi: boolean; now: number }) {
  if (data.clients.length === 0) return multi ? null : <p className="text-muted-foreground text-sm">No client is stuck: nothing blocked, nothing waiting {data.waitingDays} days.</p>;
  return (
    <ul aria-label={multi ? `Stuck in ${data.project}` : "Stuck clients"} className="flex flex-col divide-y border-y" data-testid="stuck-clients">
      {data.clients.map((c) => (
        <li className="flex min-w-0 flex-col gap-1 py-3 text-sm" key={c.clientId}>
          <p className="flex flex-wrap items-baseline gap-x-2">
            <AppLink className="font-medium text-foreground" inProject={data.project} to={dest("mail.conversation", { key: clientKey({ id: c.clientId, email: c.email }) }, { filter: "all" })}>
              {c.name}
            </AppLink>
            {multi && <span className="text-muted-foreground text-xs">{data.project}</span>}
          </p>
          <ul className="flex flex-col gap-0.5">
            {c.nodes.map((n) => (
              <li className="flex min-w-0 items-start gap-2" key={n.id}>
                {n.state === "blocked" ? <CircleSlashIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive-foreground" /> : <HourglassIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-foreground" />}
                <span className="min-w-0 break-words">
                  <span className="font-medium">{stuckWord(n, now)}:</span> {n.label}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

export function WhereStuck({ projects, multi, now }: { projects: readonly string[]; multi: boolean; now: number }) {
  const qs = useStuckClients(projects);
  if (projects.length === 0) return null;
  const total = stuckTotal(qs.map((q) => q.data));
  const allRead = qs.every((q) => q.data !== undefined);
  return (
    <section aria-labelledby="where-stuck-title" className="flex flex-col gap-1" data-testid="where-stuck">
      <SectionTitle id="where-stuck-title">
        Where we are stuck {total > 0 && <span className="font-normal text-muted-foreground tabular-nums">{total}</span>}
      </SectionTitle>
      {multi && allRead && total === 0 && <p className="text-muted-foreground text-sm">No client is stuck in any project: nothing blocked, nothing waiting a week.</p>}
      {qs.map((q, i) => (
        <QueryView key={projects[i]} loading={<ListSkeleton label="Loading the stuck clients" rows={1} />} query={q} what={`the stuck clients of ${projects[i] ?? "the project"}`}>
          {(d) => <ProjectStuck data={d} multi={multi} now={now} />}
        </QueryView>
      ))}
    </section>
  );
}

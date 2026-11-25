"use client";

import { CalendarClockIcon, CircleAlertIcon, HandIcon } from "lucide-react";
import { clientKey } from "@hub/contract/client-key";
import type { FollowUpsDto } from "@hub/contract/follow-ups";
import { ActionButton } from "@hub/ui/product/action-button";
import { SectionTitle } from "@hub/ui/product/shell/page";
import { AppLink } from "@/components/app-link";
import { ListSkeleton, QueryView } from "@/components/state-views";
import { runNowOff, stoppedLine, sweepLine, todayLine } from "@/components/follow-up/words";
import { sentence } from "@/lib/api/client";
import { useFollowUpsOf, useRunFollowUps } from "@/lib/data/project";
import { dest, type Dest } from "@/routes/paths";

/** Run follow-ups now: off with the server's reason (three a day, no model here); a click while a sweep runs joins it. */
function RunNow({ project, d }: { project: string; d: FollowUpsDto }) {
  const run = useRunFollowUps(project);
  const off = runNowOff(d.sweep);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <ActionButton disabled={off !== null || run.isPending} onClick={() => run.mutate()} size="s" tooltip={off ?? undefined} variant="secondary">
        {run.isPending ? "Starting" : "Run follow-ups now"}
      </ActionButton>
      <span className="text-destructive-foreground text-xs" role="alert">
        {run.isError ? sentence(run.error) : ""}
      </span>
    </span>
  );
}

function ProjectToday({ project, d, multi, now }: { project: string; d: FollowUpsDto; multi: boolean; now: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 py-3 text-sm" data-project={project} data-testid="follow-ups-today">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <CalendarClockIcon aria-hidden="true" className="size-4 shrink-0 self-center text-muted-foreground" />
        <AppLink className="font-medium text-foreground" inProject={project} to={dest("log.list", { kind: "follow-ups", client: null })}>
          {todayLine(d.today)}
        </AppLink>
        {multi && <span className="text-muted-foreground text-xs">{project}</span>}
      </p>
      <p className="text-muted-foreground tabular-nums">{sweepLine(d.sweep, new Date(now))}</p>
      <RunNow d={d} project={project} />
    </div>
  );
}

/**
 * Overview's follow-ups part (P142 F6, verdict 15), per project: "Follow-ups today: 3 ready · 5 waiting · 1 stopped · 1 for you"
 * leading into Activity ▸ Follow-ups, "swept 09:02 · next tomorrow 09:00", and Run follow-ups now. One read per project, each with
 * its own loading and error; the live `follow-ups` topic refreshes them. The clients handed over and a stopped sweep are Needs you
 * items (`followUpNeeds`), not repeated here.
 */
export function FollowUpsToday({ projects, multi, now }: { projects: readonly string[]; multi: boolean; now: number }) {
  const qs = useFollowUpsOf(projects);
  if (projects.length === 0) return null;
  return (
    <section aria-labelledby="follow-ups-today-title" className="flex flex-col gap-1">
      <SectionTitle id="follow-ups-today-title">Follow-ups</SectionTitle>
      <div className="flex flex-col divide-y border-y">
        {qs.map((q, i) => {
          const project = projects[i] ?? "";
          return (
            <QueryView key={project} loading={<ListSkeleton label="Loading the follow-ups" rows={1} />} query={q} what={`the follow-ups of ${project}`}>
              {(d) => <ProjectToday d={d} multi={multi} now={now} project={project} />}
            </QueryView>
          );
        })}
      </div>
    </section>
  );
}

/** One Needs you item of the sweep: a client handed over to the owner, or a sweep that stopped early. */
export type FollowUpNeed = { id: string; project: string; kind: "for_you" | "stopped"; title: string; detail: string | null; clientId: number | null; /** P147: where the item leads when not a client or the sweep (the lead pass). */ to?: Dest };

/** The Needs you items of every project's sweep (verdict 15): each handed-over client, then a stopped sweep's reason. */
export function useFollowUpNeeds(projects: readonly string[]): FollowUpNeed[] {
  const qs = useFollowUpsOf(projects);
  return qs.flatMap((q, i) => {
    const project = projects[i] ?? "";
    const d = q.data;
    if (!d) return [];
    const forYou: FollowUpNeed[] = d.rows.filter((r) => r.state === "handed_over").map((r) => ({ id: `fu:${project}:${r.clientId}`, project, kind: "for_you", title: `Follow-up for you: ${r.name}`, detail: r.reason, clientId: r.clientId }));
    const stopped = stoppedLine(d.sweep);
    return stopped ? [...forYou, { id: `fu:${project}:stopped`, project, kind: "stopped", title: stopped, detail: null, clientId: null }] : forYou;
  });
}

/** A Needs you item of the sweep: the client's name leads into the conversation; a stopped sweep into Activity ▸ Follow-ups. */
export function FollowUpNeedItem({ n, multi }: { n: FollowUpNeed; multi: boolean }) {
  const Icon = n.kind === "for_you" ? HandIcon : CircleAlertIcon;
  const to = n.to ?? (n.clientId !== null ? dest("mail.conversation", { key: clientKey({ id: n.clientId }) }, { filter: "all" }) : dest("log.list", { kind: "follow-ups", client: null }));
  return (
    <li className="flex min-w-0 gap-3 py-3" data-part={n.kind === "for_you" ? "follow-up-for-you" : "follow-ups-stopped"}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <AppLink className="font-medium text-foreground" inProject={n.project} to={to}>
            {n.title}
          </AppLink>
          {multi && <span className="text-muted-foreground text-xs">{n.project}</span>}
        </p>
        {n.detail && <p className="measure break-words text-muted-foreground">{n.detail}</p>}
      </div>
    </li>
  );
}

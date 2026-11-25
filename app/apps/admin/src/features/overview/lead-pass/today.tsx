"use client";

import { InboxIcon } from "lucide-react";
import type { LeadPassDto } from "@hub/contract/lead-pass";
import { SectionTitle } from "@hub/ui/product/shell/page";
import { AppLink } from "@/components/app-link";
import { ListSkeleton, QueryView } from "@/components/state-views";
import { passLine } from "@/features/mail/leads/review/pass";
import { useLeadPassOf } from "@/lib/data/inbound";
import { dest } from "@/routes/paths";
import type { FollowUpNeed } from "../follow-ups/today";

// Overview's lead pass part (P147 L6, decision 0055): per project with a pass, "Leads today: 4 drafted · 2 proposed · 1 for you"
// leading into the review (or Mail ▸ Leads), and the pass line. The leads handed over and a stopped pass are Needs you items.

/** "Leads today: 4 drafted · 2 proposed · 1 for you · 3 sent", or "Leads today: nothing decided yet". */
export function leadsTodayLine(d: LeadPassDto): string {
  const t = d.today;
  const parts = [t.drafted && `${t.drafted} drafted`, t.spam + t.notNow && `${t.spam + t.notNow} proposed`, t.forYou && `${t.forYou} for you`, t.sent && `${t.sent} sent`].filter(Boolean);
  return `Leads today: ${parts.length ? parts.join(" · ") : "nothing decided yet"}`;
}

/** A project shows the part once its pass is on or has run. */
const shown = (d: LeadPassDto) => d.pass.schedule !== "off" || d.pass.last !== null;

export function LeadPassToday({ projects, multi }: { projects: readonly string[]; multi: boolean }) {
  const qs = useLeadPassOf(projects);
  const on = qs.map((q, i) => ({ q, project: projects[i] ?? "" })).filter(({ q }) => !q.data || shown(q.data));
  if (on.length === 0 || qs.every((q) => q.data && !shown(q.data))) return null;
  return (
    <section aria-labelledby="lead-pass-today-title" className="flex flex-col gap-1">
      <SectionTitle id="lead-pass-today-title">Leads</SectionTitle>
      <div className="flex flex-col divide-y border-y">
        {on.map(({ q, project }) => (
          <QueryView key={project} loading={<ListSkeleton label="Loading the lead pass" rows={1} />} query={q} what={`the lead pass of ${project}`}>
            {(d) => (
              <div className="flex min-w-0 flex-col gap-1 py-3 text-sm" data-project={project} data-testid="lead-pass-today">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <InboxIcon aria-hidden="true" className="size-4 shrink-0 self-center text-muted-foreground" />
                  <AppLink className="font-medium text-foreground" inProject={project} to={d.review.batchId !== null && d.review.drafts + d.review.proposals > 0 ? dest("mail.lead-review", { batch: d.review.batchId }) : dest("mail.leads", { view: "drafted", brand: null })}>
                    {leadsTodayLine(d)}
                  </AppLink>
                  {multi && <span className="text-muted-foreground text-xs">{project}</span>}
                </p>
                <p className="text-muted-foreground tabular-nums">{passLine(d)}</p>
              </div>
            )}
          </QueryView>
        ))}
      </div>
    </section>
  );
}

/** The Needs you items of every project's lead pass: the leads handed over (one item per project), then a stopped pass. */
export function useLeadPassNeeds(projects: readonly string[]): FollowUpNeed[] {
  const qs = useLeadPassOf(projects);
  return qs.flatMap((q, i) => {
    const project = projects[i] ?? "";
    const d = q.data;
    if (!d) return [];
    const out: FollowUpNeed[] = [];
    if (d.today.forYou > 0) out.push({ id: `lp:${project}:for_you`, project, kind: "for_you", title: `${d.today.forYou === 1 ? "1 lead" : `${d.today.forYou} leads`} for you`, detail: "The lead pass handed them over: open each and decide.", clientId: null, to: dest("mail.leads", { view: "for_you", brand: null }) });
    if (d.pass.stopped) out.push({ id: `lp:${project}:stopped`, project, kind: "stopped", title: "The lead pass stopped early", detail: d.pass.stopped, clientId: null, to: dest("mail.leads", { view: "new", brand: null }) });
    return out;
  });
}

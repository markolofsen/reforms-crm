import type { ReactNode } from "react";
import type { WatchDto, WatchView as View } from "@hub/contract/watch";
import { ActionButton } from "@hub/ui/product/action-button";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/list/data-table";
import { Page } from "@hub/ui/product/shell/page";
import { SectionLayout } from "@hub/ui/product/shell/section-layout";
import { SectionNav, type SectionNavItem } from "@hub/ui/product/shell/section-nav";
import { AppLink } from "@/components/app-link";
import { EmptyState, ListSkeleton, QueryView } from "@/components/state-views";
import { ApiFailure, isNotFound, sentence } from "@/lib/api/client";
import { useJoinWatchGroup, useWatch } from "@/lib/data/project";
import { OpenLinkButton } from "@/components/links/open-link";
import { formatDay, formatTime, plural } from "@/lib/format";
import { dest, type Dest } from "@/routes/paths";
import { WATCH_DAYS } from "@/routes/search";
import { microUsd, spendLine, STATE_WORD, triggerLabel, VIEW_LABEL, VIEW_ORDER } from "./labels";

type Q = { view: View; days: number; trigger: string | null; group: string | null };
const to = (q: Q, patch: Partial<Q>): Dest => {
  const n = { ...q, ...patch };
  return dest("watch.page", { view: n.view, days: WATCH_DAYS.find((d) => Number(d) === n.days) ?? "30", trigger: n.trigger ?? "", group: n.group ?? "" });
};

/** The menu column: the six views, then the period. A link keeps the other choices. */
function WatchNav({ q }: { q: Q }) {
  const link = (target: Dest, current: boolean) =>
    function NavLink(content: ReactNode, className: string) {
      return (
        <AppLink aria-current={current ? "page" : undefined} bare className={className} to={target}>
          {content}
        </AppLink>
      );
    };
  const views: SectionNavItem[] = VIEW_ORDER.map((v) => ({ id: `view-${v}`, label: VIEW_LABEL[v], current: v === q.view, group: "Show", render: link(to(q, { view: v }), v === q.view) }));
  const days: SectionNavItem[] = WATCH_DAYS.map((d) => ({ id: `days-${d}`, label: `Last ${d} days`, current: Number(d) === q.days, group: "Period", render: link(to(q, { days: Number(d) }), Number(d) === q.days) }));
  return <SectionNav items={[...views, ...days]} label="Watch views" />;
}

/** One trigger's days as a strip of bars (the height is the day's share of the strip's busiest day). */
function DayBars({ counts, label }: { counts: readonly number[]; label: string }) {
  const top = Math.max(1, ...counts);
  return (
    <span aria-label={`${label}: ${counts.reduce((a, b) => a + b, 0)} over ${counts.length} days`} className="flex h-6 items-end gap-px" role="img">
      {counts.map((c, i) => (
        <span className="w-1 rounded-sm bg-foreground/60" key={i} style={{ height: `${Math.max(c > 0 ? 12 : 4, Math.round((c / top) * 100))}%`, opacity: c > 0 ? 1 : 0.25 }} />
      ))}
    </span>
  );
}

function Triggers({ d, q }: { d: WatchDto; q: Q }) {
  if (d.triggers.length === 0) return <EmptyState title="No moment in this period">Moments appear after the first analysis of a group.</EmptyState>;
  return (
    <DataTable>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[34%]">Trigger</TableHead>
          <TableHead className="w-[12%]">Moments</TableHead>
          <TableHead className="w-[12%]">Avg intensity</TableHead>
          <TableHead className="w-[12%]">Strong (4+)</TableHead>
          <TableHead className="w-[30%]">By day</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {d.triggers.map((t) => (
          <TableRow key={`${t.trigger}-${t.triggerOther}`}>
            <TableCell>
              <AppLink to={to(q, { view: "moments", trigger: t.trigger })}>{triggerLabel(d, t.trigger, t.triggerOther)}</AppLink>
            </TableCell>
            <TableCell>{t.moments}</TableCell>
            <TableCell>{t.avgIntensity.toFixed(1)}</TableCell>
            <TableCell>{t.strong}</TableCell>
            <TableCell>
              <DayBars counts={t.daily} label={triggerLabel(d, t.trigger, t.triggerOther)} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </DataTable>
  );
}

function Topics({ d }: { d: WatchDto }) {
  return (
    <div className="flex flex-col gap-6">
      {d.topics.length === 0 ? (
        <EmptyState title="No topic in this period" />
      ) : (
        <DataTable>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[70%]">Topic</TableHead>
              <TableHead className="w-[30%]">Windows</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.topics.map((t) => (
              <TableRow key={t.topic}>
                <TableCell>{t.topic}</TableCell>
                <TableCell>{t.windows}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </DataTable>
      )}
      {d.moods.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-medium text-sm">Mood, last analysis</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {d.moods.map((m) => (
              <li key={m.group}>
                <span className="text-muted-foreground">@{m.group}:</span> {m.mood}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Moments({ d, q }: { d: WatchDto; q: Q }) {
  const narrowed = q.trigger !== null || q.group !== null;
  return (
    <div className="flex flex-col gap-3">
      {narrowed && (
        <p className="text-muted-foreground text-sm">
          {q.trigger !== null && <>Trigger {triggerLabel(d, q.trigger)}. </>}
          {q.group !== null && <>Group @{q.group}. </>}
          <AppLink to={to(q, { trigger: null, group: null })}>Show every moment</AppLink>
        </p>
      )}
      {d.moments.length === 0 ? (
        <EmptyState title="No moment here" />
      ) : (
        <ul className="flex flex-col">
          {d.moments.map((m) => {
            return (
              <li className="flex flex-col gap-1 border-b py-3" key={`${m.group}-${m.messageId}-${m.trigger}`}>
                <span className="flex flex-wrap items-center gap-x-3 text-muted-foreground text-xs">
                  <span className="font-medium text-foreground">{triggerLabel(d, m.trigger, m.triggerOther)}</span>
                  <span>intensity {m.intensity}</span>
                  <span>@{m.group}</span>
                  {m.author && <span>{m.author}</span>}
                  {m.reactors > 0 && <span>{plural(m.reactors, "reply", "replies")} around it</span>}
                  <span>{formatTime(m.at)}</span>
                  <OpenLinkButton to={m.link} />
                </span>
                <q className="text-sm">{m.quote}</q>
                {m.why && <span className="text-muted-foreground text-xs">{m.why}</span>}
                {m.context && <span className="text-muted-foreground text-xs">Thread: {m.context}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function People({ d }: { d: WatchDto }) {
  if (d.people.length === 0) return <EmptyState title="No one in this period" />;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">Public group members are not clients: read only, never contacted from the Hub. Handles are blanked after 180 days.</p>
      <DataTable>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[22%]">Person</TableHead>
            <TableHead className="w-[10%]">Moments</TableHead>
            <TableHead className="w-[10%]">Intensity</TableHead>
            <TableHead className="w-[28%]">Triggers</TableHead>
            <TableHead className="w-[18%]">Groups</TableHead>
            <TableHead className="w-[12%]">Last</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {d.people.map((p) => (
            <TableRow key={p.author}>
              <TableCell>{p.author}</TableCell>
              <TableCell>{p.moments}</TableCell>
              <TableCell>{p.intensitySum}</TableCell>
              <TableCell>{p.triggers.map((t) => triggerLabel(d, t)).join(", ")}</TableCell>
              <TableCell>{p.groups.map((g) => `@${g}`).join(", ")}</TableCell>
              <TableCell>{formatDay(p.lastAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </DataTable>
    </div>
  );
}

function Groups({ d, q, project }: { d: WatchDto; q: Q; project: string }) {
  const join = useJoinWatchGroup(project);
  if (d.groups.length === 0) return <EmptyState title="No group listed">The groups are the list in the project&apos;s watch.md.</EmptyState>;
  return (
    <div className="flex flex-col gap-3">
      {join.error !== null && <p className="text-destructive-foreground text-sm">{sentence(join.error)}</p>}
      <DataTable>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[22%]">Group</TableHead>
            <TableHead className="w-[26%]">Access</TableHead>
            <TableHead className="w-[9%]">Per day</TableHead>
            <TableHead className="w-[11%]">Per 100</TableHead>
            <TableHead className="w-[9%]">Moments</TableHead>
            <TableHead className="w-[9%]">Cost</TableHead>
            <TableHead className="w-[14%]">Read</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {d.groups.map((g) => (
            <TableRow key={g.username}>
              <TableCell>
                <AppLink to={to(q, { view: "moments", group: g.username })}>@{g.username}</AppLink>
                {g.title && <span className="block text-muted-foreground text-xs">{g.title}</span>}
              </TableCell>
              <TableCell>
                {g.accessLine}
                {g.canJoin && (
                  <ActionButton className="ms-2" disabled={join.isPending} onClick={() => join.mutate(g.username)} size="s" tooltip="Asks Telegram to add your account to this public group. Nothing is posted." variant="secondary">
                    Join
                  </ActionButton>
                )}
              </TableCell>
              <TableCell>{g.perDay}</TableCell>
              <TableCell>{g.density}</TableCell>
              <TableCell>{g.moments}</TableCell>
              <TableCell>{microUsd(g.costMicroUsd)}</TableCell>
              <TableCell>{g.lastPolledAt ? formatTime(g.lastPolledAt) : "Not yet"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </DataTable>
    </div>
  );
}

function Trend({ d }: { d: WatchDto }) {
  if (d.trend.series.length === 0) return <EmptyState title="No moment in this period" />;
  const first = d.trend.days[0];
  const last = d.trend.days.at(-1);
  return (
    <div className="flex flex-col gap-3">
      {first && last && (
        <p className="text-muted-foreground text-sm">
          Moments per day, {formatDay(first)} to {formatDay(last)}.
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {d.trend.series.map((s) => (
          <li className="grid grid-cols-[minmax(8rem,14rem)_1fr] items-end gap-3" key={s.trigger}>
            <span className="text-sm">{triggerLabel(d, s.trigger)}</span>
            <DayBars counts={s.counts} label={triggerLabel(d, s.trigger)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The standing, the spend and the next analysis: one line under the header. */
function Standing({ d }: { d: WatchDto }) {
  return (
    <p className="text-muted-foreground text-sm" data-testid="watch-standing">
      <span className="font-medium text-foreground">{STATE_WORD[d.standing.state]}</span>
      {d.standing.reason && <> · {d.standing.reason}</>}
      {d.standing.until && <> · until {formatTime(d.standing.until)}</>}
      {d.lens && <> · lens {d.lens.title}</>}
      <> · {spendLine(d.spend)}</>
      {d.nextAnalysis && <> · next analysis {formatTime(d.nextAnalysis)}</>}
    </p>
  );
}

/**
 * Watch (P144, `/watch`): what the public groups of one project talk about. The menu column holds the six views and the period;
 * the body one view of the project's watch store: Triggers (counts and days), Topics (with each group's last mood), Moments
 * (the quotes, narrowed by a trigger or a group), People, Groups (access, rate, cost, Join) and Trend. Read only, but Join.
 */
export function WatchView({ project, view, days, trigger, group }: { project: string; view: View; days: number; trigger: string | null; group: string | null }) {
  const q: Q = { view, days, trigger, group };
  const watch = useWatch(project, days, view === "moments" ? trigger : null, view === "moments" ? group : null);
  return (
    <SectionLayout nav={<WatchNav q={q} />} navButton="Views" navLabel="Watch views">
      <Page label="Watch">
        <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
          {watch.data === undefined && isNotFound(watch.error) ? (
            <EmptyState title="This project watches no public groups">A watch list is a watch.md in the project folder (a lens, the switch, the groups): ask the agent to write one.</EmptyState>
          ) : watch.data === undefined && watch.error instanceof ApiFailure && watch.error.code === "unavailable" ? (
            <EmptyState title="The watch list is parked">{sentence(watch.error)}</EmptyState>
          ) : (
          <QueryView loading={<ListSkeleton label="Loading the watch" rows={4} />} query={watch} what="the watch">
            {(d) => (
              <>
                <Standing d={d} />
                {view === "triggers" && <Triggers d={d} q={q} />}
                {view === "topics" && <Topics d={d} />}
                {view === "moments" && <Moments d={d} q={q} />}
                {view === "people" && <People d={d} />}
                {view === "groups" && <Groups d={d} project={project} q={q} />}
                {view === "trend" && <Trend d={d} />}
              </>
            )}
          </QueryView>
          )}
        </div>
      </Page>
    </SectionLayout>
  );
}

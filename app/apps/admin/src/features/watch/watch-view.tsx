import type { WatchDto, WatchView as View } from "@hub/contract/watch";
import { ActionButton } from "@hub/ui/product/action-button";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/list/data-table";
import { Page } from "@hub/ui/product/shell/page";
import { FilterChips, type Chip } from "@hub/ui/product/list/filter-chips";
import { ListFilterMenu } from "@hub/ui/product/list/toolbar";
import { AppLink } from "@/components/app-link";
import { EmptyState, ListSkeleton, QueryView } from "@/components/state-views";
import { ApiFailure, isNotFound, sentence } from "@/lib/api/client";
import { useJoinWatchGroup, useWatch } from "@/lib/data/project";
import { OpenLinkButton } from "@/components/links/open-link";
import { formatDay, formatTime, plural } from "@/lib/format";
import { useGo } from "@/hooks/use-go";
import { dest, type Dest } from "@/routes/paths";
import { WATCH_DAYS } from "@/routes/search";
import { microUsd, triggerLabel, VIEW_LABEL, VIEW_ORDER } from "./labels";
import { Notice, Standing } from "./standing";
import { DayBars, Trend } from "./trend";

type Q = { view: View; days: number; trigger: string | null; group: string | null };
type WatchDays = (typeof WATCH_DAYS)[number];
const daysKey = (n: number): WatchDays => WATCH_DAYS.find((d) => Number(d) === n) ?? "30";
const to = (q: Q, patch: Partial<Q>): Dest => {
  const n = { ...q, ...patch };
  return dest("watch.page", { view: n.view, days: daysKey(n.days), trigger: n.trigger ?? "", group: n.group ?? "" });
};

/**
 * The page header (owner 2026-11-25: tabs, not a drawer): the six views as one segmented row, which scrolls inside its own strip at
 * phone width, and the period as a compact one beside it. A choice replaces the history entry (`?view=`, `?days=`), like any filter.
 */
function WatchHeader({ q }: { q: Q }) {
  const go = useGo();
  const views: Chip<View>[] = VIEW_ORDER.filter((v) => v === "triggers" || v === "moments" || v === "groups").map((v) => ({ value: v, label: VIEW_LABEL[v], count: null }));
  const days: Chip<WatchDays>[] = WATCH_DAYS.map((d) => ({ value: d, label: `${d} days`, count: null }));
  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
      <div className="min-w-0 flex-1 basis-80">
        <FilterChips chips={views} label="Watch views" onChange={(v) => go(to(q, { view: v }), { replace: true })} value={q.view} />
      </div>
      <ListFilterMenu name="Analysis" options={VIEW_ORDER.map((v) => ({ value: v, label: VIEW_LABEL[v] }))} value={q.view} onChange={(v) => go(to(q, { view: VIEW_ORDER.find((x) => x === v) ?? "triggers" }), { replace: true })} />
      <div className="w-48 shrink-0">
        <FilterChips chips={days} label="Period" onChange={(d) => go(to(q, { days: Number(d) }), { replace: true })} value={daysKey(q.days)} />
      </div>
    </div>
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

/**
 * Watch (P144, `/watch`): what the public groups of one project talk about. The header holds the six views and the period;
 * the body one view of the project's watch store: Triggers (counts and days), Topics (with each group's last mood), Moments
 * (the quotes, narrowed by a trigger or a group), People, Groups (access, rate, cost, Join) and Trend. Read only, but Join.
 */
export function WatchView({ project, view, days, trigger, group }: { project: string; view: View; days: number; trigger: string | null; group: string | null }) {
  const q: Q = { view, days, trigger, group };
  const watch = useWatch(project, days, view === "moments" ? trigger : null, view === "moments" ? group : null);
  return (
    <Page label="Watch" nav={<WatchHeader q={q} />}>
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
                <Notice d={d} />
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
  );
}

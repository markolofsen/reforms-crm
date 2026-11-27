import type { WatchDto } from "@hub/contract/watch";
import { ActionButton } from "@hub/ui/product/action-button";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/list/data-table";
import { Page } from "@hub/ui/product/shell/page";
import { AppLink } from "@/components/app-link";
import { EmptyState, ListSkeleton, QueryView } from "@/components/state-views";
import { isNotFound, sentence } from "@/lib/api/client";
import { useJoinWatchGroup, useWatch } from "@/lib/data/project";
import { formatDay, formatTime } from "@/lib/format";
import { MEMBERSHIP_WORD, membershipNext, membershipQueueLine, membershipTime, microUsd, triggerLabel, watchDest, type WatchSearch } from "./labels";
import { WatchHeader } from "./header";
import { Moments } from "./moments";
import { Notice, Standing } from "./standing";
import { DayBars, Trend } from "./trend";

function Triggers({ d, q }: { d: WatchDto; q: WatchSearch }) {
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
              <AppLink to={watchDest(q, { view: "moments", trigger: t.trigger })}>{triggerLabel(d, t.trigger, t.triggerOther)}</AppLink>
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

function People({ d }: { d: WatchDto }) {
  if (d.people.length === 0) return <EmptyState title="No one in this period" />;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">Public group members are not clients. Public replies stay in their source discussion; this list does not start private conversations. Handles are blanked after 180 days.</p>
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

function Membership({ group }: { group: WatchDto["groups"][number] }) {
  const membership = group.membership;
  const time = membershipTime(membership);
  return (
    <div className="flex flex-col gap-1">
      <span>{MEMBERSHIP_WORD[membership?.state ?? "unknown"]}</span>
      <span className="text-muted-foreground text-xs">{membershipNext(group)}</span>
      {membership?.reason && <span className="text-muted-foreground text-xs">{membership.reason}</span>}
      {time && <span className="text-muted-foreground text-xs">{time}</span>}
    </div>
  );
}

function Groups({ d, q, project }: { d: WatchDto; q: WatchSearch; project: string }) {
  const join = useJoinWatchGroup(project);
  const queue = membershipQueueLine(d.membership);
  if (d.groups.length === 0) return <EmptyState title="No group listed">The groups are the list in the project&apos;s watch.md.</EmptyState>;
  return (
    <div className="flex flex-col gap-3">
      {join.error !== null && <p className="text-destructive-foreground text-sm" role="alert">{sentence(join.error)}</p>}
      <DataTable>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[28%]">Group</TableHead>
            <TableHead className="w-[32%]">Reading access</TableHead>
            <TableHead className="w-[40%]">Membership</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {d.groups.map((g) => (
            <TableRow key={g.username}>
              <TableCell>
                <AppLink to={watchDest(q, { view: "moments", group: g.username })}>@{g.username}</AppLink>
                {g.title && <span className="block text-muted-foreground text-xs">{g.title}</span>}
                <span className="mt-1 block text-muted-foreground text-xs">{g.perDay}/day · {g.density} moments/100 messages · {g.moments} moments · {microUsd(g.costMicroUsd)}</span>
              </TableCell>
              <TableCell>
                {g.accessLine}
                <span className="mt-1 block text-muted-foreground text-xs">Last read: {g.lastPolledAt ? formatTime(g.lastPolledAt) : "Not yet"}</span>
              </TableCell>
              <TableCell>
                <Membership group={g} />
                {g.canJoin && (
                  <ActionButton aria-label={`Join @${g.username}`} className="mt-2" disabled={join.isPending} onClick={() => join.mutate(g.username)} size="s" tooltip="Asks Telegram to add your account to this public group. Nothing is posted." variant="secondary">
                    {join.isPending && join.variables === g.username ? "Joining…" : "Join"}
                  </ActionButton>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </DataTable>
      {queue && <p className="text-muted-foreground text-sm" role="status">{queue}</p>}
    </div>
  );
}

/**
 * Watch (P144, `/watch`): what the public groups of one project talk about. The header holds the six views and the period;
 * the body one view of the project's watch store: Triggers (counts and days), Topics (with each group's last mood), Moments
 * (the quotes, narrowed by a trigger or a group), People, Groups (reading access, membership, queue, rate and cost) and Trend. Join uses the owner door.
 */
export function WatchView({ project, q }: { project: string; q: WatchSearch }) {
  const watch = useWatch(project, q.direction, Number(q.days), q.view === "moments" ? q.trigger || null : null, q.view === "moments" ? q.group || null : null);
  return (
    <Page label="Watch" nav={<WatchHeader data={watch.data} q={q} />}>
      <div className="flex min-w-0 flex-col gap-4">
        {watch.data === undefined && watch.isError && q.direction && (
          <AppLink replace to={watchDest(q, { direction: "" })}>Show the default direction</AppLink>
        )}
        {watch.data === undefined && isNotFound(watch.error) && !q.direction ? (
          <EmptyState title="This project watches no public groups">A watch list is a watch.md in the project folder (a lens, the switch, the groups): ask the agent to write one.</EmptyState>
        ) : (
          <QueryView loading={<ListSkeleton label="Loading the watch" rows={4} />} query={watch} what="the watch">
            {(d) => (
              <>
                <Standing d={d} />
                <Notice d={d} />
                {q.view === "triggers" && <Triggers d={d} q={q} />}
                {q.view === "topics" && <Topics d={d} />}
                {q.view === "moments" && <Moments d={d} project={project} q={q} />}
                {q.view === "people" && <People d={d} />}
                {q.view === "groups" && <Groups d={d} project={project} q={q} />}
                {q.view === "trend" && <Trend d={d} />}
              </>
            )}
          </QueryView>
        )}
      </div>
    </Page>
  );
}

import type { WatchDto } from "@hub/contract/watch";
import { ActionButton } from "@hub/ui/product/action-button";
import { AppLink } from "@/components/app-link";
import { OpenLinkButton } from "@/components/links/open-link";
import { EmptyState } from "@/components/state-views";
import { formatTime, plural } from "@/lib/format";
import { MomentContext } from "./context";
import { triggerLabel, watchDest, type WatchSearch } from "./labels";

export function Moments({ d, q, project }: { d: WatchDto; q: WatchSearch; project: string }) {
  const narrowed = q.trigger !== "" || q.group !== "";
  const scoped = { ...q, direction: d.direction ?? q.direction };
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {narrowed && (
        <p className="text-muted-foreground text-sm">
          {q.trigger && <>Trigger {triggerLabel(d, q.trigger)}. </>}
          {q.group && <>Group @{q.group}. </>}
          <AppLink replace to={watchDest(scoped, { trigger: "", group: "" })}>Show every moment</AppLink>
        </p>
      )}
      {q.contextGroup && q.messageId !== null && (
        <MomentContext
          project={project}
          direction={scoped.direction}
          group={q.contextGroup}
          messageId={q.messageId}
          close={watchDest(scoped, { contextGroup: "", messageId: null })}
        />
      )}
      {d.moments.length === 0 ? (
        <EmptyState title="No moment here" />
      ) : (
        <ul className="flex flex-col">
          {d.moments.map((moment) => (
            <li className="flex min-w-0 flex-col gap-1 border-b py-3" key={`${moment.group}-${moment.messageId}-${moment.trigger}`}>
              <span className="flex flex-wrap items-center gap-x-3 text-muted-foreground text-xs">
                <span className="font-medium text-foreground">{triggerLabel(d, moment.trigger, moment.triggerOther)}</span>
                <span>intensity {moment.intensity}</span>
                <span>@{moment.group}</span>
                {moment.author && <span>{moment.author}</span>}
                {moment.reactors > 0 && <span>{plural(moment.reactors, "response")} identified</span>}
                <span>{formatTime(moment.at)}</span>
                <ActionButton
                  render={<AppLink to={watchDest(scoped, { contextGroup: moment.group, messageId: moment.messageId })} />}
                  size="s"
                  variant="secondary"
                >
                  Read context
                </ActionButton>
                <OpenLinkButton to={moment.link} />
              </span>
              <q className="whitespace-pre-wrap break-words text-sm">{moment.quote}</q>
              {moment.why && <span className="break-words text-muted-foreground text-xs">{moment.why}</span>}
              {moment.context && <span className="break-words text-muted-foreground text-xs">Analysis context: {moment.context}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

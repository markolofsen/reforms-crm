import { useEffect, useRef } from "react";
import type { WatchContextDto } from "@hub/contract/watch";
import { ActionButton } from "@hub/ui/product/action-button";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/list/data-table";
import { SectionTitle } from "@hub/ui/product/shell/page";
import { AppLink } from "@/components/app-link";
import { OpenLinkButton } from "@/components/links/open-link";
import { EmptyState, ListSkeleton, QueryView } from "@/components/state-views";
import { useWatchContext } from "@/lib/data/project";
import { formatTime } from "@/lib/format";
import type { Dest } from "@/routes/paths";
import { PublicReplyReview } from "./review/panel";

/** Source ids describe relationships without pretending the bounded neighbourhood is a complete thread. */
export function ContextMessages({ data }: { data: WatchContextDto }) {
  return (
    <DataTable>
      <TableHeader><TableRow><TableHead>Stored messages in time order</TableHead></TableRow></TableHeader>
      <TableBody>
        {data.messages.map((message) => (
          <TableRow key={message.messageId} data-source-message={message.messageId === data.messageId || undefined}>
            <TableCell>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap gap-x-3 text-muted-foreground text-xs">
                  <span>#{message.messageId}</span>
                  <span>{message.author ?? "Author unavailable"}</span>
                  <span>{formatTime(message.sentAt)}</span>
                  {message.messageId === data.messageId && <span className="font-medium text-foreground">Source message</span>}
                  {message.replyToMessageId !== null && <span>Reply to #{message.replyToMessageId}</span>}
                  {message.threadId !== null && <span>Thread marker #{message.threadId}</span>}
                </span>
                <p className="whitespace-pre-wrap break-words text-sm">{message.text || "No text stored"}</p>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </DataTable>
  );
}

/** An inline read, with its own key and retry, on the existing Moments page. */
export function MomentContext({ project, direction, group, messageId, close }: { project: string; direction: string; group: string; messageId: number; close: Dest }) {
  const context = useWatchContext(project, direction, group, messageId);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.focus(); }, [direction, group, messageId]);
  return (
    <section ref={panel} tabIndex={-1} aria-labelledby="watch-context" className="flex min-w-0 flex-col gap-3 rounded-lg border p-3" data-testid="watch-context">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle id="watch-context">Chronological context</SectionTitle>
        <ActionButton render={<AppLink replace to={close} />} size="s" variant="quiet">Close context</ActionButton>
      </div>
      <QueryView
        query={context}
        what="the stored context"
        loading={<ListSkeleton label="Loading chronological context" rows={3} />}
        isEmpty={(data) => data.messages.length === 0}
        empty={<EmptyState title="No stored context">The source history may be unavailable or expired.</EmptyState>}
      >
        {(data) => (
          <>
            <p className="text-muted-foreground text-sm">
              Nearby messages in @{data.group}, in time order. Reply chains may be incomplete.
            </p>
            <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
              <span>Source last read: {data.lastPolledAt ? formatTime(data.lastPolledAt) : "not yet recorded"}</span>
              <OpenLinkButton to={data.sourceLink} />
            </div>
            <ContextMessages data={data} />
            <PublicReplyReview key={`${project}:${direction}:${group}:${messageId}`} direction={direction} group={group} messageId={messageId} project={project} />
          </>
        )}
      </QueryView>
    </section>
  );
}

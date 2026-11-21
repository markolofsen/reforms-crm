"use client";

import { useQuery } from "@tanstack/react-query";
import { phrase, PREPARE_MAX } from "@hub/contract/help";
import type { InboundListDto, InboundRowDto } from "@hub/contract/inbound";
import { ActionButton } from "@hub/ui/product/action-button";
import { cn } from "@hub/ui/cn";
import { AppLink } from "@/components/app-link";
import { EmptyState, ListSkeleton, LoadFailed } from "@/components/state-views";
import { inboundApi } from "@/lib/api/inbox";
import { keys } from "@/lib/cache/keys";
import { useClock } from "@/lib/clock";
import { ago, plural } from "@/lib/format";
import { paths } from "@/routes/paths";
import { LeadsGroup } from "./leads-group";
import { CheckNow, mailReadText } from "./mail-read";
import { usePrepare } from "./use-prepare";

/** The Inbox list (the server's Mail reader): read by the View menu's count, the sidebar count and the list itself. */
export function useInbound(project: string) {
  return useQuery({ queryKey: keys.inbound(project), queryFn: () => inboundApi.list(project) });
}

function Row({ r, open, now }: { r: InboundRowDto; open: boolean; now: number }) {
  return (
    <li className={cn("relative border-b", open && "bg-accent")} data-open={open} data-testid="inbound-row">
      {open && <span aria-hidden="true" className="absolute inset-y-0 start-0 w-[3px] bg-primary" />}
      <AppLink
        aria-current={open ? "true" : undefined}
        bare
        className="flex min-h-16 min-w-0 flex-col gap-0.5 px-3 py-2 text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        to={paths.mail.inbound(r.id, { filter: "inbox" })}
      >
        <span className="flex w-full min-w-0 items-baseline gap-2">
          <span className={cn("min-w-0 flex-1 truncate", r.read ? "font-medium" : "font-semibold")}>{r.name}</span>
          <span className="shrink-0 text-muted-foreground text-xs tabular-nums">{ago(r.receivedAt, now)}</span>
        </span>
        <span className="w-full min-w-0 truncate">{r.subject || "(no subject)"}</span>
        {(r.preview || r.messages > 1) && (
          <span className="w-full min-w-0 truncate text-muted-foreground text-xs" data-testid="inbound-preview">
            {r.messages > 1 ? `${r.messages} messages · ` : ""}
            {r.preview}
          </span>
        )}
      </AppLink>
    </li>
  );
}

/** The one muted line under the list: senders the Hub does not know stay triage's job (verdict 3), and the reader's line with Check now. */
function Footer({ project, data, now }: { project: string; data: InboundListDto; now: number }) {
  const unknown = data.read.unknown;
  const notices = data.read.notices ?? 0;
  return (
    <div className="flex flex-col gap-1 px-3 py-2 text-muted-foreground text-xs">
      {notices > 0 && (
        <p className="measure" data-testid="inbound-notices">
          {plural(notices, "lead notice")} from the site’s robot: not a client writing, the lead is read from Notion Leads
        </p>
      )}
      {unknown > 0 && (
        <p className="measure" data-testid="inbound-unknown">
          {plural(unknown, "message")} from senders the Hub does not know · Say: “{phrase("triage-mail", project)}”
        </p>
      )}
      <p className="flex flex-wrap items-center gap-x-2" data-testid="inbound-read" role="status">
        <span>{mailReadText(data.read, now)}</span>
        <CheckNow project={project} />
      </p>
    </div>
  );
}

/**
 * Mail ▸ Inbox (P96 S1): the clients who wrote and have no draft yet, as the server's Mail reader found them (strict rules, no
 * model: a reply in a thread of ours, a known client, the test address in test mode). One row per client, unread in bold; a
 * row opens the client's message (`/mail/in/<id>`). Prepare all pastes one request naming every row into the agent's dock,
 * without Enter (S2). A row leaves by work: a draft or an agent record after it, or No reply needed on its card.
 */
export function InboxView({ project, openId, openPageId = null }: { project: string; openId: number | null; openPageId?: string | null }) {
  const q = useInbound(project);
  const now = useClock()();
  const prepare = usePrepare(project);
  if (q.isPending) return <ListSkeleton label="Loading the clients who wrote" />;
  if (!q.data)
    return (
      <div className="p-3">
        <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the clients who wrote" />
      </div>
    );
  const { rows, total, leads } = q.data;
  const leadRows = leads?.rows.length ?? 0;
  return (
    <section aria-label="Inbox" className="flex flex-col" data-testid="inbox">
      {leads && <LeadsGroup group={leads} now={now} openPageId={openPageId} />}
      {rows.length === 0 && leadRows > 0 ? null : rows.length === 0 ? (
        <EmptyState title="No client is waiting">When a client writes, they appear here with their message. Mail is read every few minutes while the Hub is open.</EmptyState>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <span className="min-w-0 flex-1 text-muted-foreground text-sm">{total > rows.length ? `${rows.length} of ${total} clients` : plural(total, "client")}</span>
            <ActionButton data-testid="prepare-all" onClick={() => prepare(rows.slice(0, PREPARE_MAX))} size="s" variant="secondary">
              Prepare all
            </ActionButton>
          </div>
          <ul aria-label="Clients who wrote" className="flex flex-col">
            {rows.map((r) => (
              <Row key={r.id} now={now} open={r.id === openId} r={r} />
            ))}
          </ul>
        </>
      )}
      <Footer data={q.data} now={now} project={project} />
    </section>
  );
}

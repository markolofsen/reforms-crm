"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { INBOX_ACTION_LABELS, INBOX_FILTER_LABELS, INBOX_FILTERS, type InboxFilter } from "@hub/config";
import type { InboxRowDto } from "@hub/contract/responses";
import { ActionButton } from "@/components/action-button";
import { AppLink } from "@/components/app-link";
import { HealthStrip } from "./health-strip";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/components/ui/link";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible";
import { sentence } from "@/lib/api/client";
import { inboxApi } from "@/lib/api/inbox";
import { formatTime } from "@/lib/format";
import { notionOf } from "@/lib/notion";
import { paths } from "@/routes/paths";

function Row({ r }: { r: InboxRowDto }) {
  const notion = notionOf(r);
  return (
    <li className="flex min-w-0 flex-col gap-0.5 border-t px-3 py-2 text-sm" data-testid="inbox-row">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
        <Badge variant={r.action === "injection_suspected" ? "error" : r.owed ? "warning" : "outline"}>{INBOX_ACTION_LABELS[r.action]}</Badge>
      </div>
      <p className="truncate text-muted-foreground">{r.subject ?? r.email}</p>
      {r.reason && <p className="text-muted-foreground">{r.reason}</p>}
      <p className="flex flex-wrap items-center gap-x-3 text-muted-foreground text-xs">
        {r.lastInboundAt && <span>Wrote {formatTime(r.lastInboundAt)}</span>}
        {r.openDraftId !== null && (
          <AppLink className="text-xs" to={paths.drafts.item(r.openDraftId)}>
            Open the draft
          </AppLink>
        )}
        {notion.web && (
          <Link className="gap-1 text-xs" href={notion.web} target="_blank">
            {notion.label}
            <ExternalLinkIcon aria-hidden="true" className="size-3" />
          </Link>
        )}
      </p>
    </li>
  );
}

/**
 * Who the agent touched in its triage, above the draft list: the replies still owed (no open draft), the clients new since the
 * last triage, and the plain statement that nothing was ever recorded, which is what an empty Drafts screen means on a new project.
 */
export function InboxQueue({ project }: { project: string }) {
  const [filter, setFilter] = useState<InboxFilter>("owed");
  const q = useQuery({ queryKey: ["inbox", project, filter], queryFn: () => inboxApi.list(project, filter), placeholderData: keepPreviousData, refetchInterval: 15_000 });
  if (q.isPending) return null;
  if (!q.data) return <p className="px-3 pt-3 text-destructive-foreground text-sm" role="alert">Could not load the inbox: {sentence(q.error)}</p>;
  const { counts, lastTriageAt, rows } = q.data;
  if (lastTriageAt === null) {
    return (
      <>
        <HealthStrip lastTriageAt={null} project={project} />
        <p className="mx-3 mt-3 rounded-lg border p-3 text-muted-foreground text-sm" data-testid="inbox-never" role="note">
          No triage has been recorded for this project yet. Drafts and the clients the agent skipped appear here after it processes the mail.
        </p>
      </>
    );
  }
  return (
    <>
    <HealthStrip lastTriageAt={lastTriageAt} project={project} />
    <Collapsible className="mx-3 mt-3 rounded-lg border" data-testid="inbox">
      <CollapsibleTrigger className="flex min-h-(--control-m) w-full items-center gap-2 px-3 py-2 text-start text-sm">
        <span className="min-w-0 flex-1">
          <span className="font-medium">Inbox</span>{" "}
          <span className="text-muted-foreground">{(counts.owed ?? 0) === 1 ? "1 reply" : `${counts.owed ?? 0} replies`} owed, {counts.new ?? 0} new since the last triage</span>
        </span>
        <ChevronDownIcon aria-hidden="true" className="size-4" />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="flex gap-1 px-3 pb-2" role="group" aria-label="Inbox view">
          {INBOX_FILTERS.map((f) => (
            <ActionButton aria-pressed={filter === f} key={f} onClick={() => setFilter(f)} size="s" variant={filter === f ? "secondary" : "quiet"}>
              {INBOX_FILTER_LABELS[f]} {counts[f] ?? 0}
            </ActionButton>
          ))}
        </div>
        {rows.length === 0 ? <p className="border-t px-3 py-2 text-muted-foreground text-sm">Nothing here.</p> : <ul>{rows.map((r) => <Row key={r.id} r={r} />)}</ul>}
      </CollapsiblePanel>
    </Collapsible>
    </>
  );
}

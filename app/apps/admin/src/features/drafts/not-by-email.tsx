"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { INBOX_KIND_HINTS, INBOX_KIND_LABELS, INBOX_KINDS, type InboxKind } from "@hub/config";
import type { InboxRowDto } from "@hub/contract/responses";
import { Badge } from "@hub/ui/badge";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@hub/ui/collapsible";
import { ActionButton } from "@hub/ui/product/action-button";
import { notByEmailApi } from "@/lib/api/not-by-email";
import { formatTime } from "@/lib/format";

function Row({ r }: { r: InboxRowDto }) {
  return (
    <li className="flex min-w-0 flex-col gap-0.5 border-t px-3 py-2 text-sm" data-testid="not-by-email-row">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
        {r.kind && <Badge variant="outline">{INBOX_KIND_LABELS[r.kind]}</Badge>}
      </div>
      {r.phone && <p>{r.phone}</p>}
      {r.reason && <p className="text-muted-foreground">{r.reason}</p>}
      <p className="text-muted-foreground text-xs">
        {r.email} · recorded {formatTime(r.recordedAt)}
      </p>
    </li>
  );
}

/**
 * The clients the agent did not answer by email, grouped by why. Read-only and collapsed: the owner opens it to see who to call
 * or who was set aside. A phone is text the agent copied from the mail, shown as written, never a link and never dialled.
 */
export function NotByEmail({ project }: { project: string }) {
  const [kind, setKind] = useState<InboxKind | null>(null);
  const q = useQuery({ queryKey: ["not-by-email", project, kind], queryFn: () => notByEmailApi.list(project, kind), placeholderData: keepPreviousData });
  if (!q.data) return q.isError ? <p className="mx-3 my-3 text-muted-foreground text-sm" role="status">Could not load the clients who are not answered by email.</p> : null;
  const { counts, rows } = q.data;
  const all = INBOX_KINDS.reduce((n, k) => n + counts[k], 0);
  return (
    <Collapsible className="mx-3 my-3 rounded-lg border" data-testid="not-by-email">
      <CollapsibleTrigger className="flex min-h-(--control-m) w-full items-center gap-2 px-3 py-2 text-start text-sm">
        <span className="min-w-0 flex-1 font-medium">Not by email ({all})</span>
        <ChevronDownIcon aria-hidden="true" className="size-4" />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div aria-label="Not by email, group" className="flex flex-wrap gap-1 px-3 pb-2" role="group">
          <ActionButton aria-pressed={kind === null} onClick={() => setKind(null)} size="s" variant={kind === null ? "secondary" : "quiet"}>
            All {all}
          </ActionButton>
          {INBOX_KINDS.map((k) => (
            <ActionButton aria-pressed={kind === k} key={k} onClick={() => setKind(k)} size="s" variant={kind === k ? "secondary" : "quiet"}>
              {INBOX_KIND_LABELS[k]} {counts[k]}
            </ActionButton>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="border-t px-3 py-2 text-muted-foreground text-sm" data-testid="not-by-email-empty">
            {kind ? INBOX_KIND_HINTS[kind] : "Nobody yet. Tell the agent \"call him\" about a client, and it appears here."}
          </p>
        ) : (
          <ul aria-label="Not answered by email">{rows.map((r) => <Row key={r.id} r={r} />)}</ul>
        )}
      </CollapsiblePanel>
    </Collapsible>
  );
}

"use client";

import { useState } from "react";
import { INBOX_KIND_HINTS, INBOX_KIND_LABELS, INBOX_KINDS, type InboxKind } from "@hub/config";
import type { InboxRowDto, NotByEmailDto } from "@hub/contract/responses";
import { Badge } from "@hub/ui/badge";
import { ActionButton } from "@hub/ui/product/action-button";
import { ConversationList, ConversationListIdentity, ConversationListItem } from "@hub/ui/product/conversation";
import { ListSkeleton, ListState, QueryView } from "@/components/state-views";
import { useNotByEmail } from "@/lib/data/inbound";
import { formatTime } from "@/lib/format";

function Row({ r }: { r: InboxRowDto }) {
  return (
    <ConversationListItem className="flex min-w-0 flex-col gap-0.5 px-3 py-2 text-sm" dataAttributes={{ "data-testid": "not-by-email-row" }}>
      <ConversationListIdentity name={r.name} time={r.kind ? <Badge variant="outline">{INBOX_KIND_LABELS[r.kind]}</Badge> : undefined} />
      {r.phone && <p>{r.phone}</p>}
      {r.reason && <p className="text-muted-foreground">{r.reason}</p>}
      <p className="text-muted-foreground text-xs">
        {r.email} · recorded {formatTime(r.recordedAt)}
      </p>
    </ConversationListItem>
  );
}

/**
 * The Not by email view of Mail (P48): the clients the agent did not answer by email, grouped by why. Read-only: the owner
 * sees who to call or who was set aside. A phone is text the agent copied from the mail, shown as written, never a link and
 * never dialled. Its count is the View menu's (`useNotByEmailTotal`).
 */
export function NotByEmail({ project }: { project: string }) {
  const [kind, setKind] = useState<InboxKind | null>(null);
  const q = useNotByEmail(project, kind, { keep: true });
  return (
    <QueryView frame={(note) => <ListState>{note}</ListState>} loading={<ListSkeleton label="Loading the clients not answered by email" />} query={q} what="the clients not answered by email">
      {(d) => <NotByEmailList d={d} kind={kind} setKind={setKind} />}
    </QueryView>
  );
}

/** The groups and their rows, once read; a failed refetch's stale note sits above them (`QueryView`, state rule 5). */
function NotByEmailList({ d, kind, setKind }: { d: NotByEmailDto; kind: InboxKind | null; setKind: (k: InboxKind | null) => void }) {
  const { counts, rows } = d;
  const all = INBOX_KINDS.reduce((n, k) => n + counts[k], 0);
  return (
    <section aria-label="Not by email" className="flex flex-col" data-testid="not-by-email">
      <div aria-label="Not by email, group" className="scroll-strip flex gap-1 px-3 py-2" role="group">
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
        <p className="measure border-t px-3 py-3 text-muted-foreground text-sm" data-testid="not-by-email-empty">
          {kind ? INBOX_KIND_HINTS[kind] : "Nobody yet. Tell the agent \"call him\" about a client, and it appears here."}
        </p>
      ) : (
        <ConversationList ariaLabel="Not answered by email">{rows.map((r) => <Row key={r.id} r={r} />)}</ConversationList>
      )}
    </section>
  );
}

/** The number beside "Not by email" in the View menu. */
export function useNotByEmailTotal(project: string): number | undefined {
  const q = useNotByEmail(project, null);
  return q.data ? INBOX_KINDS.reduce((n, k) => n + q.data.counts[k], 0) : undefined;
}

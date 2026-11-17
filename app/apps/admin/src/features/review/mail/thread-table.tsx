import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import type { DraftThreadDto } from "@hub/contract/responses";
import { Badge } from "@hub/ui/badge";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@hub/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/table";
import { LoadFailed, Loading } from "@/components/state-views";
import { sendApi } from "@/lib/api/send";
import { formatTime } from "@/lib/format";
import type { ReviewDraft } from "../source";

type Row = { key: string; at: string; who: string; direction: "in" | "out" | null; subject: string; excerpt: string; last: boolean };
type Stored = NonNullable<NonNullable<ReviewDraft["basedOn"]>["context"]["thread"]>["rows"];

const fromLive = (t: DraftThreadDto): Row[] => t.messages.map((m) => ({ key: `${m.at}-${m.who}`, at: m.at, who: m.who, direction: m.direction, subject: m.subject, excerpt: m.excerpt, last: m.last }));
const fromStored = (rows: NonNullable<Stored>): Row[] => rows.map((r, i) => ({ key: `${r.date}-${r.subject}`, at: r.date, who: r.who, direction: null, subject: r.subject, excerpt: r.excerpt, last: i === 0 }));

function RowsTable({ rows }: { rows: Row[] }) {
  return (
    <Table aria-label="Thread">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[24%]">Date</TableHead>
          <TableHead className="w-[26%]">Who</TableHead>
          <TableHead className="w-[50%]">Message</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.key}>
            <TableCell className="whitespace-normal align-top">{r.at.length > 10 ? formatTime(r.at) : r.at}</TableCell>
            <TableCell className="whitespace-normal break-words align-top">
              {r.who}
              {r.direction && <span className="block text-muted-foreground text-xs">{r.direction === "in" ? "wrote to us" : "we wrote"}</span>}
            </TableCell>
            <TableCell className="whitespace-normal break-words align-top">
              {r.last && <Badge className="me-1.5" variant="outline">Latest</Badge>}
              <span className="font-medium">{r.subject}</span>
              <span className="block text-muted-foreground">{r.excerpt}</span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * The thread of a draft: the last five messages read from Mail when the person opens it, never stored (decision 0013,
 * `Mailer.thread`). When Mail cannot be read, the 120-character excerpts stored when the draft was written are shown
 * instead, under a plain label that says they are old. Nothing is read until the block is opened.
 */
export function ThreadTable({ project, d }: { project: string; d: ReviewDraft }) {
  const [open, setOpen] = useState(false);
  const stored = d.basedOn?.context.thread?.rows;
  const live = d.batchId === null && d.status === "ready";
  const q = useQuery({ queryKey: ["draft-thread", project, d.id], queryFn: () => sendApi.thread(project, d.id), enabled: open && live, staleTime: 0, refetchOnWindowFocus: false });
  if (!live && !stored?.length) return null;
  const rows = q.data?.read ? fromLive(q.data) : null;
  return (
    <Collapsible className="rounded-lg border" data-testid="mail-thread" onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger className="flex min-h-(--control-m) w-full items-center gap-2 px-3 py-2 text-start text-sm">
        <span className="font-medium">Thread</span>
        <span className="min-w-0 flex-1 text-muted-foreground">{live ? "The last five messages, read from Mail" : "Excerpts stored with the draft"}</span>
        <ChevronDownIcon aria-hidden="true" className="size-4" />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="flex flex-col gap-2 border-t px-3 py-3">
          {live && q.isPending && <Loading what="the thread from Mail" />}
          {live && q.isError && <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the thread" />}
          {rows && (rows.length > 0 ? <><p className="text-muted-foreground text-xs">Read from Mail just now, newest first. Not stored.</p><RowsTable rows={rows} /></> : <p className="text-muted-foreground text-sm">Mail holds no other message with this subject for this client.</p>)}
          {live && q.data && !q.data.read && <p className="text-sm text-warning-foreground">{q.data.reason ?? "Mail could not be read."}</p>}
          {!rows && stored && stored.length > 0 && (!live || q.data || q.isError) && (
            <>
              <p className="text-muted-foreground text-xs">Stored excerpts of what the client wrote, saved when the draft was written (about 120 characters each). Not the live thread.</p>
              <RowsTable rows={fromStored(stored)} />
            </>
          )}
          {!rows && !stored?.length && q.data && !q.data.read && <p className="text-muted-foreground text-sm">No stored excerpts either.</p>}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

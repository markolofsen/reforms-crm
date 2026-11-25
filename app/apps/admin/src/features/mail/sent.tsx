"use client";

import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { clientKey } from "@hub/contract/client-key";
import type { SendRowDto } from "@hub/contract/sending";
import { Badge } from "@hub/ui/badge";
import { Page } from "@hub/ui/product/shell/page";
import { AppLink } from "@/components/app-link";
import { EmptyState, ListSkeleton, QueryView } from "@/components/state-views";
import { useProjectScope } from "@/hooks/use-project";
import { useSends } from "@/lib/data/project";
import { useLeadPass } from "@/lib/data/inbound";
import { SendingPanel } from "@/features/mail/ready/sending-line";
import { SendReadyProvider, useSendReady } from "@/features/mail/ready/send-ready";
import { formatTime } from "@/lib/format";
import { dest } from "@/routes/paths";

// Mail ▸ Sent (P147 3m item 3): what went out, newest first, read from the send log, which keeps the full text of each send. One
// row per send with its channel (Mail, Telegram, WhatsApp); a click opens the text. Queued, failed and cancelled sends stay in
// Activity ▸ Sends, where Cancel lives. Stock UI Core only.

/** The server returns the newest 100 rows of the send log. */
const SENDS_READ = 100;

export const CHANNEL_LABEL: Record<SendRowDto["channel"], string> = { mail: "Mail", telegram_user: "Telegram", telegram_bot: "Telegram bot", whatsapp: "WhatsApp" };

/** The sends that went out (and the one going now, on top), newest first. */
export function sentRows(sends: readonly SendRowDto[]): SendRowDto[] {
  // The one going now has no done time yet: it is the newest.
  const at = (r: SendRowDto) => (r.status === "sending" ? "~" : (r.doneAt ?? r.createdAt));
  return sends.filter((r) => r.status === "sent" || r.status === "sending").sort((a, b) => (at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : b.id - a.id));
}

/** Who it went to: a mail's addresses, or the chat's name for a message (its row keeps the name as the subject). */
const recipient = (r: SendRowDto): string => (r.channel === "mail" ? [r.toAddr, r.ccAddr && `Cc ${r.ccAddr}`].filter(Boolean).join(", ") : r.subject);

function SentRow({ r }: { r: SendRowDto }) {
  const [open, setOpen] = useState(false);
  const title = r.channel === "mail" ? r.subject : r.body.split("\n")[0];
  return (
    <li className="flex flex-col gap-2 py-3" data-testid="sent-row">
      <button aria-expanded={open} className="flex min-w-0 items-start gap-2 text-start" onClick={() => setOpen((v) => !v)} type="button">
        {open ? <ChevronDownIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <ChevronRightIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">{CHANNEL_LABEL[r.channel]}</Badge>
            <span className="min-w-0 truncate font-medium">{recipient(r)}</span>
            <span className="ms-auto shrink-0 text-muted-foreground text-xs tabular-nums">{r.status === "sending" ? "Sending" : formatTime(r.doneAt ?? r.createdAt)}</span>
          </span>
          <span className="truncate text-sm">{title}</span>
        </span>
      </button>
      {open && (
        <div className="ms-6 flex flex-col gap-2">
          <p className="measure whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-sm">{r.body}</p>
          {r.clientId !== null && r.channel === "mail" && (
            <AppLink className="self-start text-sm" to={dest("mail.conversation", { key: clientKey({ id: r.clientId }) }, { filter: "all" })}>
              Open the conversation
            </AppLink>
          )}
        </div>
      )}
    </li>
  );
}

/** The run on top of Sent, with Send again: the sheet with only the drafts that did not go out (the owner's click). */
function RunPanel({ project, batchId }: { project: string; batchId: number }) {
  const ready = useSendReady();
  return <SendingPanel batchId={batchId} onSendAgain={ready ? (ids) => ready.open(ids) : undefined} project={project} />;
}

/** The Sent page, mounted by `mail/sent/page.tsx`. */
export function SentScreen() {
  const { project } = useProjectScope();
  return (
    <SendReadyProvider project={project}>
      <SentBody />
    </SendReadyProvider>
  );
}

function SentBody() {
  const { project } = useProjectScope();
  const q = useSends(project);
  const batchId = useLeadPass(project).data?.review.batchId ?? null;
  return (
    <Page label="Sent" title="Sent">
      {/* P147 3m item 5: the run of today's replies, on top while it goes (it only shows: nothing here sends). */}
      {batchId !== null && <RunPanel batchId={batchId} project={project} />}
      <QueryView loading={<ListSkeleton label="Reading the sends" />} query={q} what="the sends">
        {(d) => {
          const rows = sentRows(d.sends);
          return rows.length === 0 ? (
            <EmptyState title="Nothing sent yet">A mail or message the Hub sends appears here with its full text.</EmptyState>
          ) : (
            <>
              <ul aria-label="Sent" className="flex flex-col divide-y">
                {rows.map((r) => (
                  <SentRow key={r.id} r={r} />
                ))}
              </ul>
              {d.sends.length >= SENDS_READ && <p className="text-muted-foreground text-xs">From the newest {SENDS_READ} sends; older ones are in the send log.</p>}
            </>
          );
        }}
      </QueryView>
    </Page>
  );
}

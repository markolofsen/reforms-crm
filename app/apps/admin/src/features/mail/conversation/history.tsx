import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import type { ConversationMailDto, ConversationMessageDto, ConversationThreadDto } from "@hub/contract/conversations";
import { refOf } from "@hub/contract/focus";
import { cn } from "@hub/ui/cn";
import { ActionButton } from "@hub/ui/product/action-button";
import { LoadFailed, Loading } from "@/components/state-views";
import { reviewApi } from "@/lib/api/review";
import { keys } from "@/lib/cache/keys";
import { agentRef } from "@/lib/focus";
import { formatTime, plural } from "@/lib/format";

/** One message's own words, read from Mail when it is opened (decision 0013: never stored; the server keeps it in memory). */
function Body({ project, clientId, m }: { project: string; clientId: number; m: ConversationMessageDto }) {
  const q = useQuery({ queryKey: keys.conversationText(project, clientId, m.messageId), queryFn: () => reviewApi.conversationText(project, clientId, m.messageId) });
  if (q.isPending) return <p className="text-muted-foreground text-sm">The Hub asks Mail for the text.</p>;
  const { text = null, note = null, quoted = false } = q.data ?? {};
  return (
    <div className="flex flex-col gap-1" data-testid="message-text">
      <p className="measure whitespace-pre-wrap break-words text-sm">{text ?? <span className="text-muted-foreground">{note ?? (q.isError ? "Mail could not show this message." : "Mail did not show the text.")}{m.preview ? ` ${m.preview}` : ""}</span>}</p>
      {text !== null && quoted && <p className="text-muted-foreground text-xs">The quote of the earlier mail is folded away; Open in Mail shows it.</p>}
    </div>
  );
}

/** One line per message (who, when, its first words); a click opens its text in place. The newest of theirs starts open. */
function Message({ project, clientId, m, name, startOpen, pointed }: { project: string; clientId: number; m: ConversationMessageDto; name: string; startOpen: boolean; pointed: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const who = m.ours ? "You" : name.split(" ")[0] || name;
  return (
    <li className={cn("flex min-w-0 flex-col border-b last:border-b-0", pointed && "bg-accent/60")} data-ours={m.ours} data-testid="history-message" id={`m-${m.messageId}`} {...(m.draftId !== null ? agentRef(refOf("draft", m.draftId)) : {})}>
      <ActionButton aria-expanded={open} className="h-auto min-h-11 w-full min-w-0 items-baseline justify-start gap-3 whitespace-normal rounded-none px-1 py-2 text-start font-normal hover:bg-accent/50 lg:min-h-9" onClick={() => setOpen((o) => !o)} size="m" variant="quiet">
        <span className={cn("w-12 shrink-0 truncate", m.ours ? "text-muted-foreground" : "font-medium")}>{who}</span>
        <span className="w-28 shrink-0 text-muted-foreground text-xs tabular-nums">{formatTime(m.date)}</span>
        <span className={cn("min-w-0 flex-1", open ? "text-muted-foreground" : "truncate")}>{m.preview || m.subject || "(no subject)"}</span>
        <ChevronDownIcon aria-hidden="true" className={cn("size-4 shrink-0 self-center text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </ActionButton>
      {open && (
        <div className="pb-3 ps-1 sm:ps-16">
          <Body clientId={clientId} m={m} project={project} />
        </div>
      )}
    </li>
  );
}

/** A thread's divider (verdict 4): its subject, our brand there and the From of our side, so a client of two products reads right. */
function Divider({ t }: { t: ConversationThreadDto }) {
  return (
    <h3 className="flex min-w-0 items-center gap-2 pt-3 pb-1 text-muted-foreground text-xs" data-testid="thread-divider">
      <span aria-hidden="true" className="h-px w-3 shrink-0 bg-border" />
      <span className="min-w-0 truncate font-medium text-foreground">{t.subject || "(no subject)"}</span>
      {t.brand && <span className="shrink-0">· {t.brand}</span>}
      {t.ourFrom && <span className="min-w-0 truncate">· {t.ourFrom}</span>}
      <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-border" />
    </h3>
  );
}

function Threads({ project, clientId, name, data, pointed }: { project: string; clientId: number; name: string; data: ConversationMailDto; pointed: string | null }) {
  const all = data.threads.flatMap((t) => t.messages);
  const newestTheirs = [...all].reverse().find((m) => !m.ours)?.messageId ?? null;
  if (all.length === 0) return <p className="text-muted-foreground text-sm">No mail with this address yet{data.note ? `: ${data.note}` : "."}</p>;
  return (
    <>
      {data.earlier > 0 && <p className="text-muted-foreground text-xs">Earlier: {plural(data.earlier, "message")} not shown; Open in Mail has them.</p>}
      {data.threads.map((t) => (
        <section aria-label={t.subject || "(no subject)"} key={t.key}>
          <Divider t={t} />
          <ul className="flex flex-col">
            {t.messages.map((m) => (
              <Message clientId={clientId} key={m.messageId} m={m} name={name} pointed={m.messageId === pointed} project={project} startOpen={m.messageId === (pointed ?? newestTheirs)} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/**
 * The whole correspondence with one person (P99 verdict 4), oldest thread first, read from Mail when the conversation opens (the
 * spike's AppleScript read, about a second) and never stored. When Mail cannot be read the Hub's own rows show, with the reason.
 */
export function History({ project, clientId, name, pointed }: { project: string; clientId: number; name: string; pointed: string | null }) {
  const q = useQuery({ queryKey: keys.conversationMail(project, clientId), queryFn: () => reviewApi.conversationMail(project, clientId) });
  return (
    <section aria-label="Conversation" className="flex min-w-0 flex-col" data-source={q.data?.source} data-testid="conversation-history">
      {q.isPending ? (
        <Loading what="the conversation from Mail" />
      ) : !q.data ? (
        <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the conversation" />
      ) : (
        <>
          {q.data.source === "hub" && q.data.note && (
            <p className="text-muted-foreground text-xs" data-testid="history-note" role="status">
              {q.data.note} Showing what the Hub recorded.
            </p>
          )}
          <Threads clientId={clientId} data={q.data} name={name} pointed={pointed} project={project} />
        </>
      )}
    </section>
  );
}

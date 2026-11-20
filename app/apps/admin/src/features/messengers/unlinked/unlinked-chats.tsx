import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { AutolinkRecordDto, RecentDialogDto } from "@hub/contract/messengers";
import { Badge } from "@hub/ui/badge";
import { Input } from "@hub/ui/input";
import { ActionButton } from "@hub/ui/product/action-button";
import { useDebounced } from "@/hooks/use-debounced";
import { sentence } from "@/lib/api/client";
import { messengersApi } from "@/lib/api/messengers/panel";
import { keys } from "@/lib/cache/keys";
import { CHANNEL_LABEL, emptyLine, whyLine } from "../labels";
import { useTelegramUser } from "../settings/use-telegram";
import { useWhatsApp } from "../settings/whatsapp/use-whatsapp";

/** The server keeps the list in memory and a new chat does not bump a live topic: read again this often while the screen is open. */
const POLL_MS = 15_000;

const recordName = (r: AutolinkRecordDto) => r.name || r.email || "this client";

/** Finds a client record in Notion (two or more characters, at most 8) for a chat nothing matched. */
function RecordSearch({ project, onPick }: { project: string; onPick: (r: AutolinkRecordDto) => void }) {
  const id = useId();
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim(), 250);
  const found = useQuery({ queryKey: keys.autolinkRecords(project, term), queryFn: () => messengersApi.findRecords(project, term), enabled: term.length >= 2, gcTime: 0 });
  return (
    <div className="flex flex-col gap-2">
      <label className="sr-only" htmlFor={id}>
        The name or email of a client in Notion
      </label>
      <Input className="control-m sm:w-72" id={id} onChange={(e) => setQ(e.target.value)} placeholder="The client's name or email in Notion" type="search" value={q} />
      {found.data && (found.data.records.length === 0 ? (
        <p className="text-muted-foreground text-sm">No client in Notion matches.</p>
      ) : (
        <ul aria-label="Matching clients in Notion" className="flex flex-wrap gap-2">
          {found.data.records.map((r) => (
            <li key={r.key}>
              <ActionButton onClick={() => onPick(r)} size="s" variant="secondary">
                {recordName(r)}
                <span className="font-normal text-muted-foreground">{r.relationship ?? ""}</span>
              </ActionButton>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

/** One seen dialog: who, why it was not linked, and Link to each record it matched (or to a client he finds). */
function Dialog({ project, r }: { project: string; r: RecentDialogDto }) {
  const qc = useQueryClient();
  const [searching, setSearching] = useState(false);
  const link = useMutation({
    mutationFn: (rec: AutolinkRecordDto) => messengersApi.linkRecord(project, { channel: r.channel, account: r.account, chatId: r.chatId, key: rec.key, title: r.title }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.messengerChatsOf(project) }),
  });
  return (
    <li className="flex flex-col gap-2 py-3" data-recent-chat={`${r.channel}:${r.chatId}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium text-sm">{r.title}</span>
        <span className="text-muted-foreground text-xs">{CHANNEL_LABEL[r.channel]}</span>
        {r.candidates.length > 0 && <Badge variant="info">Suggested</Badge>}
      </div>
      <p className="measure text-muted-foreground text-sm">{whyLine(r)}</p>
      <div className="flex flex-wrap gap-2">
        {r.candidates
          .filter((c) => c.email)
          .map((c) => (
            <ActionButton disabled={link.isPending} key={c.key} onClick={() => link.mutate(c)} size="s" variant="primary">
              Link to {recordName(c)}
              <span className="sr-only"> ({r.title})</span>
            </ActionButton>
          ))}
        {!searching && (
          <ActionButton onClick={() => setSearching(true)} size="s" variant="secondary">
            {r.candidates.length ? "Another client" : "Link to a client"}
            <span className="sr-only"> ({r.title})</span>
          </ActionButton>
        )}
      </div>
      {searching && <RecordSearch onPick={(rec) => link.mutate(rec)} project={project} />}
      {link.isError && (
        <p className="text-destructive-foreground text-sm" role="alert">
          {sentence(link.error)}
        </p>
      )}
    </li>
  );
}

/**
 * The unlinked chats the Hub saw (P84, decision 0036 point 3 as amended 2026-11-20), on Chats: why nothing (or not this chat) shows,
 * the suggestions (a match it would not link by itself: two clients, no email, autolink off) and the recent private chats nothing
 * matched, each with Link right here. The list and the count live in the server's memory only: nothing of an unlinked chat is
 * stored, and a restart empties them. With `intro` (the empty state) it first says, naming both accounts, why no chat shows.
 */
export function UnlinkedChats({ project, intro }: { project: string; intro: boolean }) {
  const tg = useTelegramUser();
  const wa = useWhatsApp();
  const telegram = tg.data?.accounts.some((a) => a.state === "running") ?? false;
  const whatsapp = wa.data?.accounts.some((a) => a.state === "running") ?? false;
  const q = useQuery({ queryKey: keys.autolink(project), queryFn: () => messengersApi.autolinkState(project), refetchInterval: POLL_MS, gcTime: 0, retry: false });
  const d = q.data;
  const suggested = d?.recent.filter((r) => r.candidates.length > 0) ?? [];
  const others = d?.recent.filter((r) => r.candidates.length === 0) ?? [];
  if (!intro && suggested.length === 0) return null;
  return (
    <section aria-label="Chats not linked" className="flex flex-col gap-3" data-testid="unlinked-chats">
      {intro && (
        <p className="measure text-sm">
          {emptyLine({ telegram, whatsapp, enabled: d?.enabled ?? false, withIdentifier: d?.directory.withIdentifier ?? 0, directoryReady: d?.directory.state === "ready" })}
        </p>
      )}
      {d && d.unlinkedActive > 0 && (
        <p className="text-muted-foreground text-xs">
          {d.unlinkedActive === 1 ? "1 unlinked chat has" : `${d.unlinkedActive} unlinked chats have`} written since the server started (counted in memory, never stored).
        </p>
      )}
      {suggested.length > 0 && (
        <>
          <h2 className="font-medium text-sm">Suggested links</h2>
          <ul aria-label="Suggested links" className="flex flex-col divide-y border-y">
            {suggested.map((r) => (
              <Dialog key={`${r.channel}:${r.chatId}`} project={project} r={r} />
            ))}
          </ul>
        </>
      )}
      {intro && others.length > 0 && (
        <>
          <h2 className="font-medium text-sm">Recent private chats</h2>
          <ul aria-label="Recent private chats" className="flex flex-col divide-y border-y">
            {others.slice(0, 20).map((r) => (
              <Dialog key={`${r.channel}:${r.chatId}`} project={project} r={r} />
            ))}
          </ul>
        </>
      )}
      {q.isError && <p className="text-muted-foreground text-xs">{sentence(q.error)}</p>}
    </section>
  );
}

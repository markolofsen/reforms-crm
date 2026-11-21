import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AutolinkLinkedDto, AutolinkRecordDto, RecentDialogDto } from "@hub/contract/messengers";
import { Badge } from "@hub/ui/badge";
import { cn } from "@hub/ui/cn";
import { ActionButton } from "@hub/ui/product/action-button";
import { toastManager } from "@hub/ui/toast";
import { sentence } from "@/lib/api/client";
import { messengersApi } from "@/lib/api/messengers/panel";
import { keys } from "@/lib/cache/keys";
import { ago } from "@/lib/format";
import { CHANNEL_LABEL, linkedLine, unlinkedIntro, whyLine, wroteLine } from "../labels";
import { recordName, RecordSearch } from "./record-search";
import { useHide } from "./use-hide";

/**
 * P88 (research 27, F10): fifteen rows each with two buttons read as a chore. Where the pointer can hover, a row's Link to a client
 * and Hide show while the row is hovered or holds keyboard focus (`focus-within`: each stays one Tab stop, and Hide one click); on
 * touch, where nothing hovers, they stay visible. A suggested client's Link is always visible.
 */
const QUIET = "transition-opacity motion-reduce:transition-none [@media(hover:hover)]:opacity-0 group-hover/row:opacity-100! group-focus-within/row:opacity-100!";

/**
 * One unlinked chat (P84c): its name, channel and when it wrote on one line; a suggested client inline with Link; then Link to a
 * client (a search of Notion) and Hide ("not a client", with Undo). The reason it was not linked is said only when it is not the
 * common one ("no client has its phone or username"), which the list says once above.
 */
function UnlinkedRow({ project, r, now }: { project: string; r: RecentDialogDto; now: number }) {
  const qc = useQueryClient();
  const { hide } = useHide(project);
  const [searching, setSearching] = useState(false);
  // P100: the toast says what the link loaded (the last 30 days, once) and what it wrote to the client's Notion card.
  const linked = (res: AutolinkLinkedDto) => {
    toastManager.add({ title: linkedLine(res), ...(res.notion ? { description: res.notion } : {}), type: res.importError ? "warning" : "success" });
    return Promise.all([qc.invalidateQueries({ queryKey: keys.messengerChatsOf(project) }), qc.invalidateQueries({ queryKey: keys.autolink(project) })]);
  };
  const link = useMutation({
    mutationFn: (rec: AutolinkRecordDto) => messengersApi.linkRecord(project, { channel: r.channel, account: r.account, chatId: r.chatId, key: rec.key, title: r.title }),
    onSuccess: linked,
  });
  const suggested = r.candidates.filter((c) => c.email);
  return (
    <li aria-label={r.title} className="group/row flex flex-col gap-2 py-3" data-recent-chat={`${r.channel}:${r.chatId}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-medium text-sm">{r.title}</span>
        <Badge variant="outline">{CHANNEL_LABEL[r.channel]}</Badge>
        {r.last && <span className="text-muted-foreground text-xs">{wroteLine(r.last, ago(r.last.at, now))}</span>}
        <div className={cn("ms-auto flex flex-wrap gap-2", !searching && QUIET)} data-row-actions="">
          {!searching && (
            <ActionButton onClick={() => setSearching(true)} size="s" variant="quiet">
              {suggested.length ? "Another client" : "Link to a client"}
              <span className="sr-only"> ({r.title})</span>
            </ActionButton>
          )}
          <ActionButton disabled={hide.isPending} onClick={() => hide.mutate({ channel: r.channel, chatId: r.chatId, title: r.title })} size="s" variant="quiet">
            Hide<span className="sr-only"> {r.title}: not a client</span>
          </ActionButton>
        </div>
      </div>
      {r.why !== "none" && <p className="measure text-muted-foreground text-sm">{whyLine(r)}</p>}
      {suggested.length > 0 && (
        <div aria-label={`Suggested for ${r.title}`} className="flex flex-wrap items-center gap-x-4 gap-y-2" role="group">
          {suggested.map((c) => (
            <div className="flex items-center gap-2" key={c.key}>
              <span className="text-sm">
                Suggested: {recordName(c)}
                {c.relationship && <span className="text-muted-foreground"> · {c.relationship}</span>}
              </span>
              <ActionButton disabled={link.isPending} onClick={() => link.mutate(c)} size="s" variant="primary">
                Link<span className="sr-only"> {r.title} to {recordName(c)}</span>
              </ActionButton>
            </div>
          ))}
        </div>
      )}
      {searching && <RecordSearch onLinked={(res) => void linked(res)}onPick={(rec) => link.mutate(rec)} project={project} r={r} />}
      {link.isError && (
        <p className="text-destructive-foreground text-sm" role="alert">
          {sentence(link.error)}
        </p>
      )}
    </li>
  );
}

/**
 * The unlinked chats of To do (P84, P84c, decision 0036 point 3 as amended 2026-11-20): the fresh private chats nobody decided on,
 * from the server's memory only (nothing of an unlinked chat is stored; a restart empties the list). Said once above them: why
 * they are here and that only the last `freshDays` show; then the muted count of unlinked chats that wrote since the server started.
 */
export function UnlinkedChats({ project, rows, freshDays, active, now, noLinked }: { project: string; rows: RecentDialogDto[]; freshDays: number; active: number; now: number; /** No linked chat at all: the line says so (P88). */ noLinked: boolean }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label="Chats not linked" className="flex flex-col gap-2" data-testid="unlinked-chats">
      <p className="text-muted-foreground text-sm">{unlinkedIntro({ freshDays, count: rows.length, noLinked })}</p>
      <ul aria-label="New chats" className="flex flex-col divide-y border-y">
        {rows.map((r) => (
          <UnlinkedRow key={`${r.channel}:${r.chatId}`} now={now} project={project} r={r} />
        ))}
      </ul>
      {active > 0 && (
        <p className="text-muted-foreground text-xs">
          {active === 1 ? "1 unlinked chat has" : `${active} unlinked chats have`} written since the server started (counted in memory, never stored).
        </p>
      )}
    </section>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { ClientMatchDto } from "@hub/contract/messenger-panel";
import type { UserDialogDto } from "@hub/contract/messengers";
import { Badge } from "@hub/ui/badge";
import { Input } from "@hub/ui/input";
import { ActionButton } from "@hub/ui/product/action-button";
import { useDebounced } from "@/hooks/use-debounced";
import { sentence } from "@/lib/api/client";
import { messengersApi } from "@/lib/api/messengers/panel";
import { telegramUserApi } from "@/lib/api/messengers/telegram-user";
import { keys } from "@/lib/cache/keys";

const SEARCH_PAUSE_MS = 250;
/** Suggested first (its id or phone is one of the client's identifiers), then the rest in Telegram's order. */
const ordered = (ds: readonly UserDialogDto[]) => [...ds.filter((d) => d.suggested), ...ds.filter((d) => !d.suggested)];

/** The owner's dialogs for one client, read on demand and never stored (0036 point 3), each with Link; a suggestion is never linked by itself. */
function Dialogs({ project, account, client, onDone }: { project: string; account: string; client: ClientMatchDto; onDone: (text: string) => void }) {
  const qc = useQueryClient();
  // Read on demand, never cached past this picker: the dialog list is the owner's whole contact list.
  const list = useQuery({ queryKey: keys.telegramDialogs(project, account, client.id), queryFn: () => telegramUserApi.dialogs(project, account, client.id), gcTime: 0, staleTime: Infinity, retry: false });
  const link = useMutation({
    mutationFn: (d: UserDialogDto) => telegramUserApi.link(project, account, { clientId: client.id, chatId: d.chatId, title: d.title }),
    onSuccess: (r) => {
      onDone(`Linked to ${client.name || client.email}: ${r.imported} ${r.imported === 1 ? "message" : "messages"} of the last 30 days imported.${r.importError ? ` The import failed (${r.importError}); new messages still arrive.` : ""}`);
      return qc.invalidateQueries({ queryKey: keys.messengerChatsOf(project) });
    },
  });
  if (list.isPending) return <p className="text-muted-foreground text-sm" role="status">Reading your Telegram chats...</p>;
  if (!list.data) return <p className="text-destructive-foreground text-sm" role="alert">{sentence(list.error)}</p>;
  return (
    <>
      <ul aria-label={`Telegram chats for ${client.name || client.email}`} className="flex flex-col divide-y border-y">
        {ordered(list.data.dialogs).map((d) => (
          <li className="flex flex-wrap items-center gap-2 py-2" key={d.chatId}>
            <span className="min-w-0 break-words text-sm">{d.title}</span>
            {d.username && <span className="text-muted-foreground text-xs">@{d.username}</span>}
            {d.suggested && <Badge variant="info">Suggested</Badge>}
            <span className="ms-auto">
              {d.linked ? (
                <span className="text-muted-foreground text-xs">Linked</span>
              ) : (
                <ActionButton disabled={link.isPending} onClick={() => link.mutate(d)} size="s" variant={d.suggested ? "primary" : "secondary"}>
                  Link<span className="sr-only"> {d.title}</span>
                </ActionButton>
              )}
            </span>
          </li>
        ))}
      </ul>
      {link.isError && <p className="text-destructive-foreground text-sm" role="alert">{sentence(link.error)}</p>}
    </>
  );
}

/**
 * Link a Telegram chat (P71 M3 over M1's picker and link routes, decision 0036 point 3). First the client, found by two or more
 * characters of its name or address (a lookup, never the list of every client: `app/@rules/README.md` rule 16), then his own
 * chats with the suggested ones first, each with Link. Link allows the chat and imports its last 30 days; nothing of a chat he
 * does not link is stored. Without a connected account the field is disabled and says why.
 */
export function LinkPicker({ project, account }: { project: string; account: string | null }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [client, setClient] = useState<ClientMatchDto | null>(null);
  const [done, setDone] = useState("");
  const term = useDebounced(q.trim(), SEARCH_PAUSE_MS);
  const matches = useQuery({ queryKey: keys.clientMatches(project, term), queryFn: () => messengersApi.findClients(project, term), enabled: account !== null && term.length >= 2 && client === null });
  return (
    <div className="flex flex-col gap-2" data-testid="link-picker">
      <label className="text-sm" htmlFor={id}>
        Link a chat to a client
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="control-m sm:w-72" disabled={account === null} id={id} onChange={(e) => { setQ(e.target.value); setClient(null); setDone(""); }} placeholder="The client's name or address" type="search" value={client ? client.name || client.email : q} />
        {client && (
          <ActionButton onClick={() => { setClient(null); setQ(""); }} size="s" variant="quiet">
            Another client
          </ActionButton>
        )}
      </div>
      {account === null && <p className="text-muted-foreground text-xs">Connect a Telegram account first: the chats are read from it.</p>}
      {!client && matches.data && (
        matches.data.clients.length === 0 ? (
          <p className="text-muted-foreground text-sm">No client of this project matches. A client exists here once the agent has written a draft for them.</p>
        ) : (
          <ul aria-label="Matching clients" className="flex flex-wrap gap-2">
            {matches.data.clients.map((m) => (
              <li key={m.id}>
                <ActionButton onClick={() => setClient(m)} size="s" variant="secondary">
                  {m.name || m.email}
                  <span className="font-normal text-muted-foreground">{m.name ? m.email : ""}</span>
                </ActionButton>
              </li>
            ))}
          </ul>
        )
      )}
      {client && account && !done && <Dialogs account={account} client={client} onDone={setDone} project={project} />}
      <p className="text-sm" role="status">
        {done}
      </p>
    </div>
  );
}

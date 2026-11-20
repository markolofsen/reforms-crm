import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { ClientMatchDto } from "@hub/contract/messenger-panel";
import type { UserDialogDto } from "@hub/contract/messengers";
import { Badge } from "@hub/ui/badge";
import { Input } from "@hub/ui/input";
import { ActionButton } from "@hub/ui/product/action-button";
import { ToggleGroup, ToggleGroupItem } from "@hub/ui/toggle-group";
import { useDebounced } from "@/hooks/use-debounced";
import { sentence } from "@/lib/api/client";
import { messengersApi } from "@/lib/api/messengers/panel";
import { telegramUserApi } from "@/lib/api/messengers/telegram-user";
import { whatsappApi } from "@/lib/api/messengers/whatsapp";
import { keys } from "@/lib/cache/keys";

/** The user-account channels a chat is linked from (P71 M3 Telegram, M5 WhatsApp), each with its picker and link routes. */
export type UserChannel = "telegram_user" | "whatsapp";
export const USER_CHANNELS: readonly UserChannel[] = ["telegram_user", "whatsapp"];
const API: Record<UserChannel, Pick<typeof telegramUserApi, "dialogs" | "link">> = { telegram_user: telegramUserApi, whatsapp: whatsappApi };
export const PICKER_WORD: Record<UserChannel, string> = { telegram_user: "Telegram", whatsapp: "WhatsApp" };

const SEARCH_PAUSE_MS = 250;
/** Suggested first (its id or phone is one of the client's identifiers), then the rest in Telegram's order. */
const ordered = (ds: readonly UserDialogDto[]) => [...ds.filter((d) => d.suggested), ...ds.filter((d) => !d.suggested)];

/** The owner's dialogs for one client, read on demand and never stored (0036 point 3), each with Link; a suggestion is never linked by itself. */
function Dialogs({ project, channel, account, client, onDone }: { project: string; channel: UserChannel; account: string; client: ClientMatchDto; onDone: (text: string) => void }) {
  const qc = useQueryClient();
  const api = API[channel];
  // Read on demand, never cached past this picker: the dialog list is the owner's whole contact list.
  const list = useQuery({ queryKey: keys.userDialogs(channel, project, account, client.id), queryFn: () => api.dialogs(project, account, client.id), gcTime: 0, staleTime: Infinity, retry: false });
  const link = useMutation({
    mutationFn: (d: UserDialogDto) => api.link(project, account, { clientId: client.id, chatId: d.chatId, title: d.title }),
    onSuccess: (r) => {
      onDone(`Linked to ${client.name || client.email}: ${r.imported} ${r.imported === 1 ? "message" : "messages"} of the last 30 days imported.${r.importError ? ` The import failed (${r.importError}); new messages still arrive.` : ""}`);
      return qc.invalidateQueries({ queryKey: keys.messengerChatsOf(project) });
    },
  });
  if (list.isPending) return <p className="text-muted-foreground text-sm" role="status">Reading your {PICKER_WORD[channel]} chats...</p>;
  if (!list.data) return <p className="text-destructive-foreground text-sm" role="alert">{sentence(list.error)}</p>;
  if (list.data.dialogs.length === 0)
    return <p className="text-muted-foreground text-sm">No {PICKER_WORD[channel]} chat to show yet.{channel === "whatsapp" ? " WhatsApp lists the chats seen since it connected: one shows here once a message arrives in it." : ""}</p>;
  return (
    <>
      <ul aria-label={`${PICKER_WORD[channel]} chats for ${client.name || client.email}`} className="flex flex-col divide-y border-y">
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
 * Link a chat (P71 M3 over M1's picker and link routes, decision 0036 point 3; WhatsApp since M5). First the client, found by two
 * or more characters of its name or address (a lookup, never the list of every client: `app/@rules/README.md` rule 16), then, when
 * both a Telegram account and a WhatsApp number are connected, which of them to read, then his own chats with the suggested ones
 * first, each with Link. Link allows the chat and imports its last 30 days; nothing of a chat he does not link is stored. Without a
 * connected account the field is disabled and says why. WhatsApp's list holds the chats seen since its connection opened.
 */
export function LinkPicker({ project, accounts }: { project: string; accounts: Record<UserChannel, string | null> }) {
  const id = useId();
  const choiceId = useId();
  const [q, setQ] = useState("");
  const [client, setClient] = useState<ClientMatchDto | null>(null);
  const [done, setDone] = useState("");
  const connected = USER_CHANNELS.filter((c) => accounts[c] !== null);
  const [picked, setPicked] = useState<UserChannel | null>(null);
  const channel = picked !== null && connected.includes(picked) ? picked : (connected[0] ?? null);
  const account = channel ? accounts[channel] : null;
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
      {account === null && <p className="text-muted-foreground text-xs">Connect a Telegram account or WhatsApp first: the chats are read from it.</p>}
      {connected.length > 1 && channel && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm" id={choiceId}>
            Read the chats of
          </span>
          <ToggleGroup aria-labelledby={choiceId} onValueChange={(v) => { const c = USER_CHANNELS.find((x) => x === v[0]); if (c) { setPicked(c); setDone(""); } }} size="sm" value={[channel]} variant="outline">
            {connected.map((c) => (
              <ToggleGroupItem className="min-h-(--control-s)" key={c} value={c}>
                {PICKER_WORD[c]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}
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
      {client && channel && account && !done && <Dialogs account={account} channel={channel} client={client} key={channel} onDone={setDone} project={project} />}
      <p className="text-sm" role="status">
        {done}
      </p>
    </div>
  );
}

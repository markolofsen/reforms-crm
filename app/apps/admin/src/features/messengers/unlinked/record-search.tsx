import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import type { AutolinkLinkedDto, AutolinkRecordDto, RecentDialogDto } from "@hub/contract/messengers";
import { Input } from "@hub/ui/input";
import { ActionButton } from "@hub/ui/product/action-button";
import { useDebounced } from "@/hooks/use-debounced";
import { sentence } from "@/lib/api/client";
import { messengersApi } from "@/lib/api/messengers/panel";
import { keys } from "@/lib/cache/keys";
import { createIdentityLine, createLabel, RECORD_SEARCH_PLACEHOLDER } from "../labels";

export const recordName = (r: AutolinkRecordDto) => r.name || r.email || "this client";

/**
 * P100: nobody in Notion matches, so the owner makes the card here: Name (the chat's name), Email (a link needs one: it is how Mail
 * knows the person) and the chat's own Telegram username or WhatsApp number, written to the card. Then the chat is linked to it.
 */
function CreateClient({ project, r, onDone }: { project: string; r: RecentDialogDto; onDone: (res: AutolinkLinkedDto) => void }) {
  const id = useId();
  const [name, setName] = useState(r.title);
  const [email, setEmail] = useState("");
  const create = useMutation({
    mutationFn: () => messengersApi.createRecord(project, { channel: r.channel, account: r.account, chatId: r.chatId, title: r.title, name: name.trim(), email: email.trim() }),
    onSuccess: onDone,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && email.trim()) create.mutate();
  };
  const identity = createIdentityLine(r);
  return (
    <form aria-label={`New client for ${r.title}`} className="flex flex-col gap-2" onSubmit={submit}>
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor={`${id}-name`}>
          Name
        </label>
        <Input className="control-m sm:w-56" id={`${id}-name`} onChange={(e) => setName(e.target.value)} placeholder="Name" required value={name} />
        <label className="sr-only" htmlFor={`${id}-email`}>
          Email
        </label>
        <Input autoComplete="off" className="control-m sm:w-64" id={`${id}-email`} onChange={(e) => setEmail(e.target.value)} placeholder="Email (how Mail knows them)" required type="email" value={email} />
        <ActionButton disabled={create.isPending || !name.trim() || !email.trim()} size="s" type="submit" variant="primary">
          Create and link
        </ActionButton>
      </div>
      {identity && <p className="text-muted-foreground text-xs">{identity}, with Relationship Lead.</p>}
      {create.isError && (
        <p className="text-destructive-foreground text-sm" role="alert">
          {sentence(create.error)}
        </p>
      )}
    </form>
  );
}

/**
 * Finds a client for a chat nothing matched (P84, P100): two or more characters of a name, email, @username or phone; the server
 * asks its copy of Notion and Notion itself, so a page made a minute ago shows. Each hit shows its email under the name. Nothing
 * found, or only a namesake: Create client «name» in Notion.
 */
export function RecordSearch({ project, r, onPick, onLinked }: { project: string; r: RecentDialogDto; onPick: (rec: AutolinkRecordDto) => void; onLinked: (res: AutolinkLinkedDto) => void }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const term = useDebounced(q.trim(), 250);
  const found = useQuery({ queryKey: keys.autolinkRecords(project, term), queryFn: () => messengersApi.findRecords(project, term), enabled: term.replace(/^@/, "").length >= 2, gcTime: 0 });
  return (
    <div className="flex flex-col gap-2">
      <label className="sr-only" htmlFor={id}>
        A client in Notion: name, email, Telegram username or phone
      </label>
      <Input className="control-m sm:w-72" id={id} onChange={(e) => setQ(e.target.value)} placeholder={RECORD_SEARCH_PLACEHOLDER} type="search" value={q} />
      {found.isFetching && !found.data && <p className="text-muted-foreground text-sm">Searching Notion…</p>}
      {found.data && found.data.records.length > 0 && (
        <ul aria-label="Matching clients in Notion" className="flex flex-wrap gap-2">
          {found.data.records.map((rec) => (
            <li key={rec.key}>
              <ActionButton className="h-auto min-h-(--control-s) py-1.5 sm:h-auto" onClick={() => onPick(rec)} size="s" variant="secondary">
                <span className="flex flex-col items-start text-start">
                  <span>
                    {recordName(rec)}
                    {rec.relationship && <span className="font-normal text-muted-foreground"> · {rec.relationship}</span>}
                  </span>
                  {rec.email && rec.email !== recordName(rec) && <span className="font-normal text-muted-foreground text-xs">{rec.email}</span>}
                </span>
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
      {found.data && !found.data.live && <p className="text-muted-foreground text-xs">Notion was not reached just now ({found.data.liveError ?? "unknown"}): these are from the copy read at start.</p>}
      {found.data && found.data.records.length === 0 && <p className="text-muted-foreground text-sm">No client in Notion matches.</p>}
      {/* Offered under any answer: the person found may be a namesake (P100: a client with the same first name was not this chat's person). */}
      {found.data && !creating && (
        <ActionButton className="self-start" onClick={() => setCreating(true)} size="s" variant={found.data.records.length === 0 ? "secondary" : "quiet"}>
          {createLabel(r.title)}
        </ActionButton>
      )}
      {creating && <CreateClient onDone={onLinked} project={project} r={r} />}
    </div>
  );
}

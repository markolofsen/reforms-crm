import { useId, useState, type FormEvent } from "react";
import { Input } from "@hub/ui/input";
import { ActionButton } from "@hub/ui/product/action-button";
import { toastManager } from "@hub/ui/toast";
import { sentence } from "@/lib/api/client";
import { useAddClientEmail } from "@/lib/data/messengers";

/**
 * P141 C4: a client the Hub knows only by a chat gets its Email here. An address no other client has becomes its Email; one that
 * another client has merges the two (the chat, its drafts and history move to that client; Activity says so).
 */
export function AddClientEmail({ project, chatId, name }: { project: string; chatId: number; name: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const add = useAddClientEmail(project, chatId, (r) => {
    toastManager.add({ title: r.merged ? `Merged ${name} into the client with ${email.trim()}` : `Email of ${name} set to ${email.trim()}`, type: "success" });
    setOpen(false);
    setEmail("");
  });
  if (!open) return <ActionButton onClick={() => setOpen(true)} size="s" variant="quiet">Add email…</ActionButton>;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (email.trim()) add.mutate(email.trim());
  };
  return (
    <form aria-label={`Email of ${name}`} className="flex flex-wrap items-center gap-2" onSubmit={submit}>
      <label className="sr-only" htmlFor={id}>Email</label>
      <Input autoFocus className="control-s sm:w-64" id={id} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" required type="email" value={email} />
      <ActionButton disabled={add.isPending || !email.trim()} size="s" type="submit" variant="primary">Save</ActionButton>
      <ActionButton onClick={() => setOpen(false)} size="s" variant="quiet">Cancel</ActionButton>
      {add.isError && <p className="text-destructive-foreground text-sm" role="alert">{sentence(add.error)}</p>}
    </form>
  );
}

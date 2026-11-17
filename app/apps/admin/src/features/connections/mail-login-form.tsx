import { useState } from "react";
import type { MailLoginBody } from "@hub/contract/requests";
import { ActionButton } from "@/components/action-button";
import { Field } from "@/components/field";
import { Input } from "@/components/ui/input";

/** The public half of a stored login ("me@example.test at imap.example.test"), so a replace starts from what is already known. */
function known(identity: string | null): { user: string; host: string } {
  const [user = "", host = ""] = (identity ?? "").split(" at ");
  return { user, host };
}

/** An IMAP app-password login for one account. Same rules as the secret form: the password is write-only and cleared after the save. */
export function MailLoginForm({ id, account, identity, busy, onSave, onClose }: { id: string; account: string; identity: string | null; busy: boolean; onSave: (body: MailLoginBody) => Promise<boolean>; onClose: () => void }) {
  const start = known(identity);
  const [host, setHost] = useState(start.host);
  const [port, setPort] = useState("993");
  const [user, setUser] = useState(start.user);
  const [password, setPassword] = useState("");
  const n = Number(port);
  const valid = host.trim() !== "" && user.trim() !== "" && password !== "" && Number.isInteger(n) && n >= 1 && n <= 65535;
  const key = id.replace(/[^a-z0-9-]/gi, "-");
  return (
    <form
      className="flex min-w-0 flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({ account, host: host.trim(), port: n, user: user.trim(), password }).then((ok) => {
          setPassword("");
          if (ok) onClose();
        });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_6rem]">
        <Field htmlFor={`${key}-host`} label="IMAP server">
          <Input autoCapitalize="off" className="control-m" id={`${key}-host`} onChange={(e) => setHost(e.target.value)} placeholder="imap.example.com" spellCheck={false} value={host} />
        </Field>
        <Field htmlFor={`${key}-port`} label="Port">
          <Input className="control-m" id={`${key}-port`} inputMode="numeric" onChange={(e) => setPort(e.target.value)} value={port} />
        </Field>
      </div>
      <Field htmlFor={`${key}-user`} label="Login">
        <Input autoCapitalize="off" autoComplete="off" className="control-m" id={`${key}-user`} onChange={(e) => setUser(e.target.value)} spellCheck={false} value={user} />
      </Field>
      <Field hint="An app password, not the account password. It is saved on this computer and never shown again." htmlFor={`${key}-pass`} label="App password">
        <Input autoCapitalize="off" autoComplete="new-password" className="control-m" id={`${key}-pass`} onChange={(e) => setPassword(e.target.value)} spellCheck={false} type="password" value={password} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton aria-busy={busy} disabled={busy || !valid} size="s" type="submit" variant="primary">
          {busy ? "Saving..." : "Save login"}
        </ActionButton>
        <ActionButton disabled={busy} onClick={onClose} size="s" type="button" variant="quiet">
          Cancel
        </ActionButton>
      </div>
    </form>
  );
}

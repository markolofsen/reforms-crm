"use client";

import { clientKey } from "@hub/contract/client-key";
import type { LeadNoteDto } from "@hub/contract/inbound";
import { CircleAlertIcon, CopyIcon, UserCheckIcon } from "lucide-react";
import { AppLink } from "@/components/app-link";
import { plural } from "@/lib/format";
import { dest } from "@/routes/paths";

/** "almirsolutions.vom: did they mean .com?" when only the ending is wrong, else the whole domain meant. Pure. */
export function typoLine(n: Extract<LeadNoteDto, { kind: "typo" }>): string {
  const base = (d: string) => d.slice(0, d.lastIndexOf("."));
  const meant = base(n.domain) === base(n.meant) ? n.meant.slice(n.meant.lastIndexOf(".")) : n.meant;
  return `${n.domain}: did they mean ${meant}? A reply to ${n.address} would bounce.`;
}

function Note({ n }: { n: LeadNoteDto }) {
  if (n.kind === "typo") {
    return (
      <li className="flex items-start gap-2" data-kind="typo" data-testid="lead-note">
        <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
        <span>{typoLine(n)}</span>
      </li>
    );
  }
  if (n.kind === "repeat") {
    return (
      <li className="flex items-start gap-2" data-kind="repeat" data-testid="lead-note">
        <CopyIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span>The same address sent {plural(n.count, "form")}.</span>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-start gap-x-2" data-kind="client" data-testid="lead-note">
      <UserCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success-foreground" />
      <span>{n.by === "address" ? "Already a client:" : "A client at the same company:"}</span>
      <AppLink className="text-foreground underline" to={dest("mail.conversation", { key: clientKey({ id: n.clientId, email: n.email }) }, { filter: "all" })}>
        {n.name} ({n.email})
      </AppLink>
    </li>
  );
}

/**
 * P138 verdict 4: what to know before replying, above the actions: a mistyped domain (a fixed list of typos), a client with this
 * address or the company's domain (a link to their conversation), the forms this address sent. Nothing when there is nothing.
 */
export function LeadNotes({ notes }: { notes: readonly LeadNoteDto[] }) {
  if (notes.length === 0) return null;
  return (
    <ul aria-label="Before you reply" className="flex flex-col gap-1 rounded-md border bg-muted/40 px-3 py-2 text-sm" data-testid="lead-notes">
      {notes.map((n) => (
        <Note key={n.kind} n={n} />
      ))}
    </ul>
  );
}

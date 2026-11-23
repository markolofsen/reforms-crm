"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { MailReadDto } from "@hub/contract/inbound";
import { ActionButton } from "@hub/ui/product/action-button";
import { refreshData, sentence } from "@/lib/api/client";
import { inboundApi } from "@/lib/api/inbox";
import { ago } from "@/lib/format";

/** "Mail read 2 min ago", "Reading Mail…", or why not ("Mail is not running"). The clock comes from the caller. */
export function mailReadText(r: MailReadDto, now: number): string {
  if (r.reading) return "Reading Mail…";
  // The server's own sentence: "Mail is not running", "Demo mode: Mail is not read", "No Mail account is set".
  if (r.reason) return r.reason;
  return r.at ? `Mail read ${ago(r.at, now)}` : "Mail not read yet";
}

/**
 * P96 verdict 12: Check now, one read pass of the project's mailboxes at once (read-only toward Mail). It waits for the pass,
 * then every list is read again; a refusal is said in place of the label for a moment.
 */
export function CheckNow({ project, size = "s" }: { project: string; size?: "s" | "m" }) {
  const qc = useQueryClient();
  const check = useMutation({ mutationFn: () => inboundApi.check(project), onSettled: () => refreshData(qc) });
  return (
    <ActionButton data-testid="check-now" disabled={check.isPending} onClick={() => check.mutate()} size={size} tooltip={check.isError ? sentence(check.error) : "Read the project's mail now"} variant="quiet">
      {check.isPending ? "Checking…" : check.isError ? "Try again" : "Check now"}
    </ActionButton>
  );
}

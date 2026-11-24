"use client";

import { useEffect, useState } from "react";
import { ActionButton } from "@hub/ui/product/action-button";
import { sentence } from "@/lib/api/client";
import { useRefreshConversation } from "@/lib/data/conversations";

/** How long "Refreshed" stays before the label comes back (P140 verdict 8). */
export const REFRESHED_MS = 2000;

/** The button's words for its state (P140 verdict 8): pure, so the label sequence is tested without a browser. */
export function refreshLabel(s: { pending: boolean; failed: boolean; done: boolean }): string {
  return s.pending ? "Refreshing…" : s.failed ? "Try again" : s.done ? "Refreshed" : "Refresh";
}

/**
 * P140 R5 (verdicts 6-8): Refresh in the conversation header. It re-reads this person's Mail and chats now: one Mail and Sent pass
 * on the server, then the history, the Inbox, the sends, the drafts and the chats are read again. "Refreshing…" while it runs,
 * "Refreshed" for 2 s, a refusal in the tooltip with "Try again".
 */
export function RefreshConversation({ project, clientId }: { project: string; clientId: number }) {
  const refresh = useRefreshConversation(project, clientId);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), REFRESHED_MS);
    return () => clearTimeout(t);
  }, [done]);
  const label = refreshLabel({ pending: refresh.isPending, failed: refresh.isError, done });
  return (
    <ActionButton data-testid="conversation-refresh" disabled={refresh.isPending} onClick={() => refresh.mutate(undefined, { onSuccess: () => setDone(true) })} size="s" tooltip={refresh.isError ? sentence(refresh.error) : "Read this person's mail and chats again now"} variant="quiet">
      {label}
    </ActionButton>
  );
}

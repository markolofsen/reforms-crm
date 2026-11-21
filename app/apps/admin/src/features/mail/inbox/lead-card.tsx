"use client";

import { ChevronDownIcon } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { leadPhrase } from "@hub/contract/help";
import type { LeadActionDto } from "@hub/contract/inbound";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@hub/ui/collapsible";
import { ActionButton } from "@hub/ui/product/action-button";
import { toastManager } from "@hub/ui/toast";
import { AppLink } from "@/components/app-link";
import { LocalActionButton } from "@/components/local-action";
import { EmptyState, LoadFailed } from "@/components/state-views";
import { useTerminal } from "@/features/terminal/use-terminal";
import { refreshData, sentence } from "@/lib/api/client";
import { leadsApi } from "@/lib/api/inbox";
import { keys } from "@/lib/cache/keys";
import { useClock } from "@/lib/clock";
import { ago, formatTime } from "@/lib/format";
import { paths } from "@/routes/paths";

type Action = "notNow" | "spam";
const DONE: Record<Action, string> = { notNow: "Not now", spam: "Marked as spam" };

/** Not now (local) and Spam (the lead's Status in Notion): the row leaves the group, with Undo in the toast. */
function useLeadAction(project: string, pageId: string, onDone: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: Action) => (a === "spam" ? leadsApi.spam(project, pageId) : leadsApi.notNow(project, pageId)).then((r): [Action, LeadActionDto] => [a, r]),
    onSuccess: ([a, r]) => {
      void refreshData(qc);
      onDone();
      toastManager.add({
        title: DONE[a],
        ...(r.note ? { description: r.note } : {}),
        type: r.notion === "refused" ? "warning" : "success",
        actionProps: { children: "Undo", onClick: () => void leadsApi.undo(project, pageId).then(() => refreshData(qc), (e: unknown) => toastManager.add({ title: "Not undone", description: sentence(e), type: "error" })) },
      });
    },
    onError: (e) => toastManager.add({ title: "Not changed", description: sentence(e), type: "error" }),
  });
}

/**
 * One lead of the Leads group (P97 S2, decision 0044): who, the brand, when, the reply address (the email typed on the form, else
 * the account email), the lead's own words read from Notion now, and what happened at the first send. Prepare reply pastes the
 * first-mail request into the dock without Enter (the agent writes a new-thread draft to the lead; S3); Not now leaves the group
 * with Undo; Spam sets the lead's Status Spam in Notion, with Undo (S5). Never a reply box and never a send here.
 */
export function LeadCard({ project, pageId, onClosed }: { project: string; pageId: string; onClosed: () => void }) {
  const q = useQuery({ queryKey: keys.lead(project, pageId), queryFn: () => leadsApi.get(project, pageId) });
  const now = useClock()();
  const { pasteToAgent } = useTerminal();
  const act = useLeadAction(project, pageId, onClosed);
  if (q.isPending) return <EmptyState title="Reading the lead">The Hub asks Notion for the lead’s page.</EmptyState>;
  if (!q.data)
    return (
      <div className="p-4">
        <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the lead" />
      </div>
    );
  const { row, lead, note, drafts } = q.data;
  const email = row.email;
  return (
    <article aria-label={`Lead ${row.name}`} className="flex flex-col gap-4 p-4 sm:p-6" data-testid="lead-card">
      <header className="flex flex-col gap-1">
        <h2 className="font-semibold text-lg">{row.name}</h2>
        <p className="text-muted-foreground text-sm">
          {email ?? "No email"} · {formatTime(row.receivedAt)} ({ago(row.receivedAt, now)}){row.brand ? ` · ${row.brand}` : ""}
          {lead?.form ? ` · form ${lead.form}` : ""}
        </p>
        {row.accountEmail && row.accountEmail !== email && <p className="text-muted-foreground text-xs">Account email {row.accountEmail}; the reply goes to the email they typed on the form.</p>}
      </header>
      <div className="flex flex-wrap gap-2">
        {row.open && email && (
          <ActionButton data-testid="lead-prepare-reply" onClick={() => pasteToAgent(leadPhrase(project, { email, pageId: row.pageId, brand: row.brand }))} size="m" variant="primary">
            Prepare reply
          </ActionButton>
        )}
        {row.open && (
          <ActionButton data-testid="lead-not-now" disabled={act.isPending} onClick={() => act.mutate("notNow")} size="m" variant="secondary">
            Not now
          </ActionButton>
        )}
        {row.open && (
          <ActionButton data-testid="lead-spam" disabled={act.isPending} onClick={() => act.mutate("spam")} size="m" variant="quiet">
            Spam
          </ActionButton>
        )}
        <LocalActionButton action="notion.openPage" args={{ pageId: row.pageId, app: true }} size="m" variant="quiet" />
      </div>
      {!email && <p className="text-sm" data-testid="lead-no-email">No email: reply on {lead?.otherContact ?? (lead?.phone ? `the phone ${lead.phone}` : "the channel they gave")}.</p>}
      {!row.open && (
        <p className="text-muted-foreground text-sm">
          {row.dismissedReason === "spam" ? "Marked as spam." : row.dismissedReason === "not_now" ? "Not now." : row.convertedAt ? "Answered: the first reply was sent." : "A draft to this lead exists, or its Status changed in Notion: it left the group."}
        </p>
      )}
      {row.convertNote && (
        <p className="text-sm" data-testid="lead-convert-note" role="status">
          Needs you: {row.convertNote}
        </p>
      )}
      <section aria-label="The lead's message" className="measure whitespace-pre-wrap break-words text-sm" data-testid="lead-text">
        {lead ? (
          <>
            {lead.company && <span className="block font-medium">{lead.company}</span>}
            {lead.message || <span className="text-muted-foreground">No message.</span>}
            {lead.details && (
              // P98 item 4: the form's metadata is folded; the message above is what the person wrote.
              <Collapsible className="pt-3" data-testid="lead-details">
                <CollapsibleTrigger className="flex min-h-(--control-s) items-center gap-1 rounded-sm text-muted-foreground text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Form details
                  <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0" />
                </CollapsibleTrigger>
                <CollapsiblePanel>
                  <span className="block whitespace-pre-wrap pt-1 text-muted-foreground text-xs">{lead.details}</span>
                </CollapsiblePanel>
              </Collapsible>
            )}
          </>
        ) : (
          <>
            <span className="text-muted-foreground">{note ?? "Notion did not show the lead."}</span>
            {row.preview && <span className="block pt-2">{row.preview}</span>}
          </>
        )}
      </section>
      {drafts.length > 0 && (
        <section aria-label="Drafts" className="flex flex-col gap-1 text-sm">
          {drafts.map((d) => (
            <AppLink key={d.id} to={paths.mail.conversation(d.clientId, { filter: "all" })}>
              Draft {d.id}: {d.subject || "(no subject)"} · {d.status}
            </AppLink>
          ))}
        </section>
      )}
    </article>
  );
}

"use client";

import { clientKey } from "@hub/contract/client-key";
import { EllipsisIcon, SparklesIcon } from "lucide-react";
import { leadPhrase } from "@hub/contract/help";
import type { LeadDetailDto } from "@hub/contract/inbound";
import { notionPageDestination } from "@hub/contract/local";
import { Menu, MenuPopup, MenuTrigger } from "@hub/ui/menu";
import { ActionButton } from "@hub/ui/product/action-button";
import { toastManager } from "@hub/ui/toast";
import { actionToast } from "@hub/ui/product/action-toast";
import { AppLink } from "@/components/app-link";
import { OpenLinkButton, OpenLinkItem } from "@/components/links/open-link";
import { EmptyState, QueryView } from "@/components/state-views";
import { useTerminal } from "@/features/terminal/use-terminal";
import { sentence } from "@/lib/api/client";
import { useLead, useLeadAction as useLeadCommand, type LeadAction as Action } from "@/lib/data/inbound";
import { useClock } from "@/lib/clock";
import { ago, formatTime } from "@/lib/format";
import { dest } from "@/routes/paths";
import { useLeadActionKeys } from "./keys";
import { LeadNotes } from "./lead-notes";
import { channelDestination, LeadTechnical, LeadWant } from "./lead-sheet";

const DONE: Record<Action, string> = { notNow: "Not now", spam: "Marked as spam" };

/** Not now (local) and Spam (the lead's Status in Notion): the row leaves the group, with Undo in the toast. */
function useLeadAction(project: string, pageId: string, onDone: () => void) {
  const { act, undo } = useLeadCommand(project, pageId, {
    onSuccess: ([a, r]) => {
      onDone();
      actionToast({
        title: DONE[a],
        ...(r.note ? { description: r.note } : {}),
        type: r.notion === "refused" ? "warning" : "success",
        action: { label: "Undo", run: () => void undo().catch((e: unknown) => toastManager.add({ title: "Not undone", description: sentence(e), type: "error" })) },
      });
    },
    onError: (e) => toastManager.add({ title: "Not changed", description: sentence(e), type: "error" }),
  });
  return act;
}

/**
 * One lead of Mail ▸ Leads (P97 S2, decision 0044; P138): who, the brand, when, the reply address, the agent's read, the checks
 * before a reply, the actions, then the form itself (what they want, never folded) and its technical lines last. Prepare reply
 * pastes the first-mail request into the dock without Enter; Write on WhatsApp only opens the chat for the owner; Not now and Spam
 * leave the group with Undo. Never a reply box and never a send here.
 */
export function LeadCard({ project, pageId, onClosed }: { project: string; pageId: string; onClosed: () => void }) {
  const q = useLead(project, pageId);
  const now = useClock()();
  const { pasteToAgent } = useTerminal();
  const act = useLeadAction(project, pageId, onClosed);
  return (
    <QueryView frame={(note) => <div className="p-3 lg:p-4">{note}</div>} loading={<EmptyState title="Reading the lead">The Hub asks Notion for the lead’s page.</EmptyState>} query={q} what="the lead">
      {(d) => <LeadArticle act={act} d={d} now={now} onPrepare={(email) => pasteToAgent(leadPhrase(project, { email, pageId: d.row.pageId, brand: d.row.brand }))} />}
    </QueryView>
  );
}

type Act = ReturnType<typeof useLeadAction>;

/** The actions (verdict 5): Prepare reply first, Write on WhatsApp when that is their channel, Not now, Spam; Open in ⋯. */
function LeadActions({ d, act, onPrepare }: { d: LeadDetailDto; act: Act; onPrepare: (email: string) => void }) {
  const { row, lead } = d;
  const whatsapp = lead?.sheet.channel?.kind === "whatsapp" ? channelDestination(lead.sheet.channel) : null;
  const prepare = row.open && row.email ? () => onPrepare(row.email ?? "") : null;
  useLeadActionKeys({ prepare, notNow: row.open && !act.isPending ? () => act.mutate("notNow") : null, spam: row.open && !act.isPending ? () => act.mutate("spam") : null });
  return (
    <div className="flex flex-wrap gap-2">
      {prepare && (
        <ActionButton data-testid="lead-prepare-reply" onClick={prepare} size="m" variant="primary">
          Prepare reply
        </ActionButton>
      )}
      {whatsapp && (
        <OpenLinkButton size="m" to={whatsapp} variant="secondary">
          {() => "Write on WhatsApp"}
        </OpenLinkButton>
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
      <Menu>
        <MenuTrigger aria-label="More lead actions" data-testid="lead-more" render={<ActionButton size="m" variant="quiet" />}>
          <EllipsisIcon aria-hidden="true" />
        </MenuTrigger>
        <MenuPopup align="end">
          <OpenLinkItem to={notionPageDestination(row.pageId)} />
          <OpenLinkItem to={notionPageDestination(row.pageId)} web />
        </MenuPopup>
      </Menu>
    </div>
  );
}

/** Where the lead stands when it is not open, and a refused conversion's note. */
function LeadState({ d }: { d: LeadDetailDto }) {
  const { row, lead } = d;
  return (
    <>
      {!row.email && <p className="text-sm" data-testid="lead-no-email">No email: reply on {lead?.otherContact ?? (lead?.phone ? `the phone ${lead.phone}` : "the channel they gave")}.</p>}
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
    </>
  );
}

/** The read lead (verdicts 1-5, 8): the card above owns the read and its states. */
function LeadArticle({ d, now, act, onPrepare }: { d: LeadDetailDto; now: number; act: Act; onPrepare: (email: string) => void }) {
  const { row, lead, note, drafts } = d;
  const email = row.email;
  return (
    <article aria-label={`Lead ${row.name}`} className="flex flex-col gap-4 p-3 lg:p-4" data-testid="lead-card">
      <header className="flex flex-col gap-1">
        <h2 className="font-semibold text-xl">{row.name}</h2>
        <p className="truncate text-muted-foreground text-sm">
          {email ?? "No email"} · {formatTime(row.receivedAt)} ({ago(row.receivedAt, now)}){row.brand ? ` · ${row.brand}` : ""}
        </p>
        {row.accountEmail && row.accountEmail !== email && <p className="text-muted-foreground text-xs">Account email {row.accountEmail}; the reply goes to the email they typed on the form.</p>}
      </header>
      {lead?.read && (
        <p className="measure flex items-start gap-2 text-base" data-testid="lead-read">
          <SparklesIcon aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground" />
          <span>
            <span className="sr-only">The agent’s read: </span>
            {lead.read}
          </span>
        </p>
      )}
      <LeadNotes notes={d.notes} />
      <LeadActions act={act} d={d} onPrepare={onPrepare} />
      <LeadState d={d} />
      {lead ? (
        <LeadWant message={lead.message} sheet={lead.sheet} />
      ) : (
        <section aria-label="The lead's message" className="measure whitespace-pre-wrap break-words text-base" data-testid="lead-text">
          <span className="text-muted-foreground text-sm">{note ?? "Notion did not show the lead."}</span>
          {row.preview && <span className="block pt-2">{row.preview}</span>}
        </section>
      )}
      {drafts.length > 0 && (
        <section aria-label="Drafts" className="flex flex-col gap-1 text-sm">
          {drafts.map((x) => (
            <AppLink key={x.id} to={dest("mail.conversation", { key: clientKey({ id: x.clientId, email: row.email }) }, { filter: "all" })}>
              Draft {x.id}: {x.subject || "(no subject)"} · {x.status}
            </AppLink>
          ))}
        </section>
      )}
      {lead && <LeadTechnical rows={lead.sheet.technical} />}
    </article>
  );
}

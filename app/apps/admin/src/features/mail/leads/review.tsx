"use client";

import { ArrowLeftIcon, SendIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { unresolvedMarkers } from "@hub/config";
import { clientKey } from "@hub/contract/client-key";
import type { LeadReviewDto, LeadReviewTicketBody, LeadReviewTicketDto } from "@hub/contract/lead-pass";
import { Checkbox } from "@hub/ui/checkbox";
import { Input } from "@hub/ui/input";
import { ActionButton } from "@hub/ui/product/action-button";
import { Page } from "@hub/ui/product/shell/page";
import { AppLink } from "@/components/app-link";
import { EmptyState, ListSkeleton, QueryView } from "@/components/state-views";
import { RunView } from "@/features/mail/batch-send";
import { sentence } from "@/lib/api/client";
import { useBatchRun, useBatchStop } from "@/lib/data/drafts";
import { useConfirmLeadReview, useFillMarker, useLeadReview } from "@/lib/data/inbound";
import { useProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { formatTime } from "@/lib/format";
import { dest } from "@/routes/paths";

// Mail ▸ Leads ▸ Review (P147 L6, decision 0055 point 2): the day's lead batch on one screen. Each drafted reply in full, read from
// Mail now, beside the request, ticked by default unless the door holds it; the Spam and Not now proposals, ticked; the leads for
// the owner, linked. One click, "Send N · Spam M · Not now K": the ticked drafts are Checked on exactly the text shown, the unticked
// are excluded (the next pass leaves them alone), the ticked proposals are applied, and the drafts go out one at a time through
// Send all Checked's run (spaced, Stop). Edit opens the draft in its conversation; the review then reads the new text again.
// 3i P2: a draft still holding an `[Owner: …]` placeholder sits apart at the top, "Needs your input (N)", unticked, the marker
// highlighted and a field per marker; filling one replaces it in Mail (the one writer), the review reads the text again, and the row
// is ticked. A draft with a placeholder never goes out: the door's own check holds it whatever the tick.

/** The button's words: "Send 3 · Spam 1 · Not now 2 · No reply 1" (the empty parts left out). */
export function clickLabel(send: number, spam: number, notNow: number, noReply = 0): string {
  const parts = [`Send ${send}`];
  if (spam) parts.push(`Spam ${spam}`);
  if (notNow) parts.push(`Not now ${notNow}`);
  if (noReply) parts.push(`No reply ${noReply}`);
  return parts.join(" · ");
}

type Proposal = LeadReviewDto["proposals"][number];
/** A proposal's key in the ticks: a lead's page or (P147 3h) a mail pass's inbound row. */
export const proposalKey = (p: Pick<Proposal, "kind" | "pageId">): string => `${p.kind}:${p.pageId}`;
/** What the ticket posts for a ticked proposal: the lead's page, or the inbound row of a mail one. */
export const proposalBody = (p: Proposal): LeadReviewTicketBody["proposals"][number] => (p.kind === "mail" && p.inbound !== null ? { inbound: p.inbound, decision: p.decision } : { pageId: p.pageId, decision: p.decision });
const PROPOSAL_LABEL = { spam: "Spam", not_now: "Not now", no_reply: "No reply needed" } as const;

/** The ticks the review opens with: every draft the door would send (a new sender's reply is unticked by the server), every proposal. */
export function initialTicks(d: LeadReviewDto): { drafts: Set<number>; proposals: Set<string> } {
  return { drafts: new Set(d.rows.filter((r) => r.ticked).map((r) => r.draftId)), proposals: new Set(d.proposals.map(proposalKey)) };
}

type Row = LeadReviewDto["rows"][number];

/** The placeholders left in a row's text, each once (what the door's `unresolved_marker` check flags). */
export function markersOf(row: Row): string[] {
  return row.mail ? [...new Set(unresolvedMarkers(row.mail.body))] : [];
}

/** The rows that wait on the owner (a placeholder left in the text), the mail pass's replies to new senders (P147 3h, unticked),
 * and the rest: leads first, then mail. */
export function splitNeedsInput(rows: readonly Row[]): { needs: Row[]; newSenders: Row[]; rest: Row[] } {
  const needs = rows.filter((r) => markersOf(r).length > 0);
  const newSenders = rows.filter((r) => !needs.includes(r) && r.kind === "mail" && r.newSender);
  const rest = rows.filter((r) => !needs.includes(r) && !newSenders.includes(r));
  return { needs, newSenders, rest: [...rest.filter((r) => r.kind === "lead"), ...rest.filter((r) => r.kind === "mail")] };
}

/** A row the review can send: one Mail holds with nothing held, drafted or (once filled) waiting For you. */
export const canSend = (r: Row): boolean => r.held.length === 0 && r.mail !== null && (r.display === "drafted" || r.display === "for_you");

/** The body with each placeholder marked, so the owner sees where his words go. */
function marked(body: string, markers: readonly string[]): ReactNode[] {
  if (!markers.length) return [body];
  const re = new RegExp(`(${markers.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`);
  return body.split(re).map((part, i) => (markers.includes(part) ? <mark className="rounded-sm bg-warning/30 px-0.5" key={`${i}-${part}`}>{part}</mark> : part));
}

/** One field per placeholder: Enter or Fill writes the answer into the draft in Mail. */
function MarkerFields({ row, markers, busy, onFill }: { row: Row; markers: readonly string[]; busy: boolean; onFill: (marker: string, value: string) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <div className="flex flex-col gap-2" data-testid="review-markers">
      {markers.map((m) => {
        const value = values[m] ?? "";
        const fill = () => value.trim() && onFill(m, value.trim());
        return (
          <label className="flex flex-wrap items-center gap-2 text-sm" key={m}>
            <span className="font-mono text-xs">{m}</span>
            <Input aria-label={`${m} for ${row.name}`} className="min-w-48 flex-1" disabled={busy} onChange={(e) => setValues((v) => ({ ...v, [m]: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), fill())} value={value} />
            <ActionButton disabled={busy || !value.trim()} onClick={fill} size="s" variant="secondary">
              Fill
            </ActionButton>
          </label>
        );
      })}
    </div>
  );
}

function Review({ project, d }: { project: string; d: LeadReviewDto }) {
  const [ticks, setTicks] = useState(() => initialTicks(d));
  const [done, setDone] = useState<LeadReviewTicketDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useBatchRun(project, d.batchId);
  const stop = useBatchStop(project, d.batchId);
  const confirm = useConfirmLeadReview(project, d.batchId, { onDone: (t) => (setDone(t), setError(null)), onError: (e) => setError(sentence(e)) });
  const toggle = <T,>(set: Set<T>, v: T, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(v);
    else next.delete(v);
    return next;
  };
  const fill = useFillMarker(project, d.batchId, { onDone: (id) => (setTicks((t) => ({ ...t, drafts: toggle(t.drafts, id, true) })), setError(null)), onError: (e) => setError(sentence(e)) });
  const { needs, newSenders, rest } = splitNeedsInput(d.rows);
  const sendable = d.rows.filter(canSend);
  const send = sendable.filter((r) => ticks.drafts.has(r.draftId)).map((r) => r.draftId);
  const exclude = sendable.filter((r) => !ticks.drafts.has(r.draftId)).map((r) => r.draftId);
  const proposals = d.proposals.filter((p) => ticks.proposals.has(proposalKey(p)));
  const spam = proposals.filter((p) => p.decision === "spam").length;
  const noReply = proposals.filter((p) => p.decision === "no_reply").length;
  const r = run.data?.run ?? null;
  const rowView = (row: Row) => (
    <article aria-label={`Reply to ${row.name}`} className="flex flex-col gap-2 rounded-lg border p-3" data-testid="review-row" key={row.draftId}>
      <header className="flex flex-wrap items-start gap-3">
        <Checkbox
          aria-label={`Send the reply to ${row.name}`}
          checked={ticks.drafts.has(row.draftId)}
          disabled={!canSend(row) || done !== null}
          onCheckedChange={(on) => setTicks((t) => ({ ...t, drafts: toggle(t.drafts, row.draftId, on === true) }))}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="font-medium">
            {row.name}
            {row.brand ? <span className="text-muted-foreground"> · {row.brand}</span> : null}
          </p>
          <p className="text-muted-foreground text-xs">
            {row.mail?.to.join(", ") ?? row.email ?? "no address"} · {row.replyWhy} · {formatTime(row.receivedAt)}
            {row.language ? ` · ${row.language}` : ""}
          </p>
        </div>
        {row.mail && (
          <AppLink className="text-sm" to={dest("mail.conversation", { key: clientKey({ id: 1, email: row.mail.to[0] ?? row.email }) }, { filter: "all" })}>
            Edit
          </AppLink>
        )}
      </header>
      <p className="measure break-words text-sm">
        <span className="text-muted-foreground">They asked: </span>
        {row.request}
      </p>
      {row.reason && <p className="text-muted-foreground text-xs">Why: {row.reason}</p>}
      {row.mail ? (
        <div className="flex flex-col gap-1 rounded-md bg-muted/40 p-3">
          <p className="font-medium text-sm">{row.mail.subject}</p>
          <p className="measure whitespace-pre-wrap break-words text-sm" data-testid="review-body">
            {marked(row.mail.body, markersOf(row))}
          </p>
        </div>
      ) : null}
      {markersOf(row).length > 0 && done === null && <MarkerFields busy={fill.isPending} markers={markersOf(row)} onFill={(marker, value) => fill.mutate({ draftId: row.draftId, marker, value })} row={row} />}
      {row.held.length > 0 && (
        <p className="text-sm" role="status">
          Held: {row.held.join("; ")}
        </p>
      )}
    </article>
  );
  return (
    <div className="flex flex-col gap-6" data-testid="lead-review">
      <p className="text-muted-foreground text-sm">
        {d.name} · one every {d.spacingSeconds} s · batch mails today {d.cap.used} of {d.cap.limit}
      </p>
      {r && <RunView onStop={() => stop.mutate()} run={r} stopping={stop.isPending} />}
      {needs.length > 0 && (
        <section aria-labelledby="review-needs" className="flex flex-col gap-3" data-testid="review-needs">
          <h2 className="font-semibold text-base" id="review-needs">
            Needs your input ({needs.length})
          </h2>
          {needs.map(rowView)}
        </section>
      )}
      {newSenders.length > 0 && (
        <section aria-labelledby="review-new-senders" className="flex flex-col gap-3" data-testid="review-new-senders">
          <h2 className="font-semibold text-base" id="review-new-senders">
            New senders ({newSenders.length})
          </h2>
          <p className="text-muted-foreground text-sm">You never wrote to these addresses: read each reply, then tick it.</p>
          {newSenders.map(rowView)}
        </section>
      )}
      <section aria-labelledby="review-replies" className="flex flex-col gap-3">
        <h2 className="font-semibold text-base" id="review-replies">
          Replies ({rest.length})
        </h2>
        {rest.length === 0 && <p className="text-muted-foreground text-sm">No other pass draft in this batch.</p>}
        {rest.map(rowView)}
      </section>
      {d.proposals.length > 0 && (
        <section aria-labelledby="review-proposals" className="flex flex-col gap-2">
          <h2 className="font-semibold text-base" id="review-proposals">
            Proposals ({d.proposals.length})
          </h2>
          <ul className="flex flex-col divide-y rounded-lg border">
            {d.proposals.map((p) => (
              <li className="flex flex-wrap items-start gap-3 p-3 text-sm" key={proposalKey(p)}>
                <Checkbox aria-label={`${PROPOSAL_LABEL[p.decision]}: ${p.name}`} checked={ticks.proposals.has(proposalKey(p))} disabled={done !== null} onCheckedChange={(on) => setTicks((t) => ({ ...t, proposals: toggle(t.proposals, proposalKey(p), on === true) }))} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{PROPOSAL_LABEL[p.decision]}</span> · {p.name} · {p.site ?? p.email ?? ""}
                  {p.reason && <span className="block text-muted-foreground text-xs">{p.reason}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {d.handOvers.length > 0 && (
        <section aria-labelledby="review-for-you" className="flex flex-col gap-2">
          <h2 className="font-semibold text-base" id="review-for-you">
            For you ({d.handOvers.length})
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {d.handOvers.map((h) => (
              <li key={`${h.kind}:${h.pageId}`}>
                {h.kind === "mail" ? (
                  <AppLink to={dest("mail.conversation", { key: clientKey({ id: 1, email: h.email ?? "" }) }, { filter: "all" })}>{h.name}</AppLink>
                ) : (
                  <AppLink to={dest("mail.lead", { page: h.pageId }, { view: "for_you", brand: null })}>{h.name}</AppLink>
                )}
                {h.reason && <span className="text-muted-foreground"> · {h.reason}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t bg-background py-3">
        <ActionButton
          data-testid="review-send"
          disabled={confirm.isPending || done !== null || send.length + proposals.length + exclude.length === 0}
          onClick={() => confirm.mutate({ send, exclude, proposals: proposals.map(proposalBody) })}
          size="m"
          variant="primary"
        >
          <SendIcon aria-hidden="true" />
          {confirm.isPending ? "Confirming" : clickLabel(send.length, spam, proposals.length - spam - noReply, noReply)}
        </ActionButton>
        <p className="text-muted-foreground text-sm">{exclude.length ? `${exclude.length} unticked: excluded from today, not sent.` : "Nothing is sent before this click."}</p>
        {done && (
          <p className="text-sm" role="status">
            {done.items.length} sending · {done.held.length} held · spam {done.applied.spam} · not now {done.applied.notNow}
            {done.applied.noReply ? ` · no reply ${done.applied.noReply}` : ""}
            {done.held.length > 0 && <span className="block text-muted-foreground">{done.held.map((h) => `${h.name}: ${h.reasons.join("; ")}`).join(" · ")}</span>}
            {done.applied.notion.length > 0 && <span className="block text-muted-foreground">{done.applied.notion.join(" · ")}</span>}
          </p>
        )}
        <span className="text-destructive-foreground text-sm" role="alert">
          {error ?? ""}
        </span>
      </div>
    </div>
  );
}

/** The review screen, mounted by `mail/leads/review/[batch]/page.tsx`. */
export function LeadReviewScreen() {
  const route = useRoute();
  const { project } = useProjectScope();
  const batch = route.route === "mail.lead-review" ? route.params.batch : 0;
  const q = useLeadReview(project, batch);
  return (
    <Page
      label="Lead review"
      nav={
        <AppLink bare className="inline-flex min-h-(--control-m) items-center gap-2 text-sm" to={dest("mail.leads", { view: "drafted", brand: null })}>
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          Leads
        </AppLink>
      }
      title="Review today’s replies"
    >
      <QueryView loading={<ListSkeleton label="Reading the drafts from Mail" />} query={q} what="the lead review">
        {(d) => (d.rows.length + d.proposals.length + d.handOvers.length === 0 ? <EmptyState title="Nothing to review">The day’s passes wrote no draft and proposed nothing.</EmptyState> : <Review d={d} project={project} />)}
      </QueryView>
    </Page>
  );
}

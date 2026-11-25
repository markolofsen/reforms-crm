"use client";

import { ArrowLeftIcon, SendIcon } from "lucide-react";
import { useState } from "react";
import { clientKey } from "@hub/contract/client-key";
import type { LeadReviewDto, LeadReviewTicketDto } from "@hub/contract/lead-pass";
import { Checkbox } from "@hub/ui/checkbox";
import { ActionButton } from "@hub/ui/product/action-button";
import { Page } from "@hub/ui/product/shell/page";
import { AppLink } from "@/components/app-link";
import { EmptyState, ListSkeleton, QueryView } from "@/components/state-views";
import { RunView } from "@/features/mail/batch-send";
import { sentence } from "@/lib/api/client";
import { useBatchRun, useBatchStop } from "@/lib/data/drafts";
import { useConfirmLeadReview, useLeadReview } from "@/lib/data/inbound";
import { useProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { formatTime } from "@/lib/format";
import { dest } from "@/routes/paths";

// Mail ▸ Leads ▸ Review (P147 L6, decision 0055 point 2): the day's lead batch on one screen. Each drafted reply in full, read from
// Mail now, beside the request, ticked by default unless the door holds it; the Spam and Not now proposals, ticked; the leads for
// the owner, linked. One click, "Send N · Spam M · Not now K": the ticked drafts are Checked on exactly the text shown, the unticked
// are excluded (the next pass leaves them alone), the ticked proposals are applied, and the drafts go out one at a time through
// Send all Checked's run (spaced, Stop). Edit opens the draft in its conversation; the review then reads the new text again.

/** The button's words: "Send 3 · Spam 1 · Not now 2" (the empty parts left out). */
export function clickLabel(send: number, spam: number, notNow: number): string {
  const parts = [`Send ${send}`];
  if (spam) parts.push(`Spam ${spam}`);
  if (notNow) parts.push(`Not now ${notNow}`);
  return parts.join(" · ");
}

/** The ticks the review opens with: every draft the door would send, every proposal. */
export function initialTicks(d: LeadReviewDto): { drafts: Set<number>; proposals: Set<string> } {
  return { drafts: new Set(d.rows.filter((r) => r.ticked).map((r) => r.draftId)), proposals: new Set(d.proposals.map((p) => p.pageId)) };
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
  const sendable = d.rows.filter((r) => r.held.length === 0 && r.display === "drafted");
  const send = sendable.filter((r) => ticks.drafts.has(r.draftId)).map((r) => r.draftId);
  const exclude = sendable.filter((r) => !ticks.drafts.has(r.draftId)).map((r) => r.draftId);
  const proposals = d.proposals.filter((p) => ticks.proposals.has(p.pageId));
  const spam = proposals.filter((p) => p.decision === "spam").length;
  const r = run.data?.run ?? null;
  return (
    <div className="flex flex-col gap-6" data-testid="lead-review">
      <p className="text-muted-foreground text-sm">
        {d.name} · one every {d.spacingSeconds} s · batch mails today {d.cap.used} of {d.cap.limit}
      </p>
      {r && <RunView onStop={() => stop.mutate()} run={r} stopping={stop.isPending} />}
      <section aria-labelledby="review-replies" className="flex flex-col gap-3">
        <h2 className="font-semibold text-base" id="review-replies">
          Replies ({d.rows.length})
        </h2>
        {d.rows.length === 0 && <p className="text-muted-foreground text-sm">No pass draft in this batch.</p>}
        {d.rows.map((row) => (
          <article aria-label={`Reply to ${row.name}`} className="flex flex-col gap-2 rounded-lg border p-3" data-testid="review-row" key={row.draftId}>
            <header className="flex flex-wrap items-start gap-3">
              <Checkbox
                aria-label={`Send the reply to ${row.name}`}
                checked={ticks.drafts.has(row.draftId)}
                disabled={row.held.length > 0 || row.display !== "drafted" || done !== null}
                onCheckedChange={(on) => setTicks((t) => ({ ...t, drafts: toggle(t.drafts, row.draftId, on === true) }))}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="font-medium">
                  {row.name}
                  {row.brand ? <span className="text-muted-foreground"> · {row.brand}</span> : null}
                </p>
                <p className="text-muted-foreground text-xs">
                  {row.mail?.to.join(", ") ?? row.email ?? "no address"} · {row.replyWhy} · {formatTime(row.receivedAt)}
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
                  {row.mail.body}
                </p>
              </div>
            ) : null}
            {row.held.length > 0 && (
              <p className="text-sm" role="status">
                Held: {row.held.join("; ")}
              </p>
            )}
          </article>
        ))}
      </section>
      {d.proposals.length > 0 && (
        <section aria-labelledby="review-proposals" className="flex flex-col gap-2">
          <h2 className="font-semibold text-base" id="review-proposals">
            Proposals ({d.proposals.length})
          </h2>
          <ul className="flex flex-col divide-y rounded-lg border">
            {d.proposals.map((p) => (
              <li className="flex flex-wrap items-start gap-3 p-3 text-sm" key={p.pageId}>
                <Checkbox aria-label={`${p.decision === "spam" ? "Spam" : "Not now"}: ${p.name}`} checked={ticks.proposals.has(p.pageId)} disabled={done !== null} onCheckedChange={(on) => setTicks((t) => ({ ...t, proposals: toggle(t.proposals, p.pageId, on === true) }))} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{p.decision === "spam" ? "Spam" : "Not now"}</span> · {p.name} · {p.site ?? p.email ?? ""}
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
              <li key={h.pageId}>
                <AppLink to={dest("mail.lead", { page: h.pageId }, { view: "for_you", brand: null })}>{h.name}</AppLink>
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
          onClick={() => confirm.mutate({ send, exclude, proposals: proposals.map((p) => ({ pageId: p.pageId, decision: p.decision })) })}
          size="m"
          variant="primary"
        >
          <SendIcon aria-hidden="true" />
          {confirm.isPending ? "Confirming" : clickLabel(send.length, spam, proposals.length - spam)}
        </ActionButton>
        <p className="text-muted-foreground text-sm">{exclude.length ? `${exclude.length} unticked: excluded from today, not sent.` : "Nothing is sent before this click."}</p>
        {done && (
          <p className="text-sm" role="status">
            {done.items.length} sending · {done.held.length} held · spam {done.applied.spam} · not now {done.applied.notNow}
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
        {(d) => (d.rows.length + d.proposals.length + d.handOvers.length === 0 ? <EmptyState title="Nothing to review">The day’s lead pass wrote no draft and proposed nothing.</EmptyState> : <Review d={d} project={project} />)}
      </QueryView>
    </Page>
  );
}

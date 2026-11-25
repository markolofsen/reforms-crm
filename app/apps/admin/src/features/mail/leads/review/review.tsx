"use client";

import { ArrowLeftIcon, ChevronDownIcon, ChevronRightIcon, SendIcon } from "lucide-react";
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
import { sentence } from "@/lib/api/client";
import { useFillMarker } from "@/lib/data/drafts";
import { useConfirmLeadReview, useLeadReview } from "@/lib/data/inbound";
import { useProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { useGo } from "@/hooks/use-go";
import { dest } from "@/routes/paths";
import { SendingLine } from "@/features/mail/ready/sending-line";

// The day's replies on one list (P147 L6 and 3m item 5, decision 0055 point 2): the body of the Send all ready sheet and of the
// page Mail ▸ Leads ▸ Review. Compact rows (recipient, subject, first line), the full text inline on click with Edit; every ready
// reply ticked. On top, "Needs your input (K)": a draft still holding an `[Owner: …]` placeholder, unticked, a field per marker
// (filled in Mail through the one writer, then read again and ticked). Below, "New senders (M)": a mail pass reply to an address
// the project never wrote to, unticked. The pass's proposals are one line, "Also mark 7 as spam / not now". One button, Send N.
// Under it nothing changed: the click marks exactly the shown text accepted (the served hash), the run sends one at a time, spaced,
// within the day's cap, and stops on a Mail failure. A draft the owner unticked is left out of today; one that opened unticked
// (new sender, needs input) stays for later.

type Row = LeadReviewDto["rows"][number];
type Proposal = LeadReviewDto["proposals"][number];

/** A proposal's key: a lead's page or (P147 3h) a mail pass's inbound row. */
export const proposalKey = (p: Pick<Proposal, "kind" | "pageId">): string => `${p.kind}:${p.pageId}`;
/** What the ticket posts for a proposal: the lead's page, or the inbound row of a mail one. */
export const proposalBody = (p: Proposal): LeadReviewTicketBody["proposals"][number] => (p.kind === "mail" && p.inbound !== null ? { inbound: p.inbound, decision: p.decision } : { pageId: p.pageId, decision: p.decision });
const PROPOSAL_WORD = { spam: "spam", junk: "junk", not_now: "not now", no_reply: "no reply needed" } as const;
/** A mail pass's spam proposal is a move to Mail's Junk at the click (3m item 1); a lead's is Spam here and in Notion. */
const wordOf = (p: Pick<Proposal, "kind" | "decision">): keyof typeof PROPOSAL_WORD => (p.kind === "mail" && p.decision === "spam" ? "junk" : p.decision);

/** "Also mark 7 as spam / not now": the one line for the pass's proposals (the kinds present, in a fixed order). */
export function proposalsLine(ps: readonly Pick<Proposal, "kind" | "decision">[]): string {
  const kinds = (["spam", "junk", "not_now", "no_reply"] as const).filter((k) => ps.some((p) => wordOf(p) === k));
  return `Also mark ${ps.length} as ${kinds.map((k) => PROPOSAL_WORD[k]).join(" / ")}`;
}

/** The placeholders left in a row's text, each once (what the door's `unresolved_marker` check flags). */
export function markersOf(row: Row): string[] {
  return row.mail ? [...new Set(unresolvedMarkers(row.mail.body))] : [];
}

/** A row the list can send: one Mail holds with nothing held, drafted or (once filled) waiting For you. */
export const canSend = (r: Row): boolean => r.held.length === 0 && r.mail !== null && (r.display === "drafted" || r.display === "for_you");

/** The ready replies: what Send all ready (N) counts and opens ticked. Never one with a placeholder, a hold or a new sender. */
export const readyRows = (d: Pick<LeadReviewDto, "rows">): Row[] => d.rows.filter((r) => r.ticked && canSend(r) && markersOf(r).length === 0);

/** The list's three groups: needs your input, ready (leads first, then mail; held ones shown, not tickable), new senders. */
export function groupRows(rows: readonly Row[]): { needs: Row[]; ready: Row[]; newSenders: Row[] } {
  const needs = rows.filter((r) => markersOf(r).length > 0);
  const newSenders = rows.filter((r) => !needs.includes(r) && r.kind === "mail" && r.newSender);
  const rest = rows.filter((r) => !needs.includes(r) && !newSenders.includes(r));
  return { needs, ready: [...rest.filter((r) => r.kind === "lead"), ...rest.filter((r) => r.kind === "mail"), ...rest.filter((r) => r.kind === "fixed")], newSenders };
}

/** The ticks the list opens with: the ready replies only. */
export const initialTicks = (d: Pick<LeadReviewDto, "rows">): Set<number> => new Set(readyRows(d).map((r) => r.draftId));

/**
 * The click's body: the ticked sendable rows go, the ones the owner unticked (they opened ticked) are left out of today, and the
 * proposals when their line is ticked. `opened` is the ticks the list opened with, kept from that moment: a row that became ready
 * later (the pass still drafting, Mail busy then readable) was never unticked by the owner and is never excluded. `only` (a list
 * selection) limits all of it to those drafts and never touches proposals.
 */
export function ticketOf(d: LeadReviewDto, ticks: ReadonlySet<number>, opened: ReadonlySet<number>, alsoMark: boolean, only: ReadonlySet<number> | null): LeadReviewTicketBody {
  const shown = d.rows.filter((r) => canSend(r) && (only === null || only.has(r.draftId)));
  return {
    send: shown.filter((r) => ticks.has(r.draftId)).map((r) => r.draftId),
    exclude: shown.filter((r) => !ticks.has(r.draftId) && opened.has(r.draftId)).map((r) => r.draftId),
    proposals: alsoMark && only === null ? d.proposals.map(proposalBody) : [],
  };
}

/** The body with each placeholder marked, so the owner sees where his words go. */
function marked(body: string, markers: readonly string[]): ReactNode[] {
  if (!markers.length) return [body];
  const re = new RegExp(`(${markers.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`);
  return body.split(re).map((part, i) => (markers.includes(part) ? <mark className="rounded-sm bg-warning/30 px-0.5" key={`${i}-${part}`}>{part}</mark> : part));
}

const firstLine = (body: string): string => body.split("\n").map((l) => l.trim()).find((l) => l.length > 0 && !/^(hi|hello|dear|guten tag|hallo|bonjour|hola|ciao)\b/i.test(l)) ?? "";

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

/** `verifying`: the list shows the Hub's own copy while Mail is read (that many drafts), "failed" when the read failed; Send waits. */
type ListProps = { project: string; d: LeadReviewDto; only?: ReadonlySet<number> | null; onSent?: (t: LeadReviewTicketDto) => void; verifying?: number | "failed" | null };

/** The list itself, in the sheet or on the review page. */
export function ReadyList({ project, d, only = null, onSent, verifying = null }: ListProps) {
  const [opened] = useState(() => initialTicks(d));
  const [ticks, setTicks] = useState<ReadonlySet<number>>(opened);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const [alsoMark, setAlsoMark] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirmLeadReview(project, d.batchId, { onDone: (t) => (setError(null), onSent?.(t)), onError: (e) => setError(sentence(e)) });
  const flip = <T,>(set: ReadonlySet<T>, v: T, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(v);
    else next.delete(v);
    return next;
  };
  const fill = useFillMarker(project, d.batchId, { onDone: (id) => (setTicks((t) => flip(t, id, true)), setError(null)), onError: (e) => setError(sentence(e)) });
  const rows = only === null ? d.rows : d.rows.filter((r) => only.has(r.draftId));
  const { needs, ready, newSenders } = groupRows(rows);
  const body = ticketOf(d, ticks, opened, alsoMark, only);
  const showProposals = only === null && d.proposals.length > 0;

  const rowView = (row: Row) => {
    const markers = markersOf(row);
    const expanded = open.has(row.draftId) || markers.length > 0;
    const to = row.mail?.to.join(", ") ?? row.email ?? "no address";
    return (
      <li className="flex flex-col gap-2 py-2" data-testid="review-row" key={row.draftId}>
        <div className="flex min-w-0 items-start gap-3">
          <Checkbox aria-label={`Send the reply to ${row.name}`} checked={ticks.has(row.draftId)} className="mt-0.5" disabled={!canSend(row) || confirm.isPending} onCheckedChange={(on) => setTicks((t) => flip(t, row.draftId, on === true))} />
          <ActionButton aria-expanded={expanded} className="size-auto min-w-0 flex-1 items-start justify-start gap-1 whitespace-normal px-0 py-0 text-start font-normal" onClick={() => setOpen((s) => flip(s, row.draftId, !s.has(row.draftId)))} size="s" variant="quiet">
            {expanded ? <ChevronDownIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <ChevronRightIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm">
                <span className="font-medium">{row.name}</span>
                <span className="text-muted-foreground"> · {to}</span>
              </span>
              <span className="truncate text-sm">{row.mail?.subject ?? ""}</span>
              {!expanded && <span className="truncate text-muted-foreground text-xs">{firstLine(row.mail?.body ?? "")}</span>}
            </span>
          </ActionButton>
        </div>
        {expanded && (
          <div className="ms-7 flex flex-col gap-2">
            <p className="measure break-words text-sm">
              <span className="text-muted-foreground">They wrote: </span>
              {row.request}
            </p>
            {row.mail && (
              <p className="measure whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-sm" data-testid="review-body">
                {marked(row.mail.body, markers)}
              </p>
            )}
            {row.reason && <p className="text-muted-foreground text-xs">Why: {row.reason}</p>}
            {markers.length > 0 && <MarkerFields busy={fill.isPending} markers={markers} onFill={(marker, value) => fill.mutate({ draftId: row.draftId, marker, value })} row={row} />}
            {row.mail && (
              <AppLink className="self-start text-sm" to={dest("mail.conversation", { key: clientKey({ id: 1, email: row.mail.to[0] ?? row.email }) }, { filter: "all" })}>
                Edit
              </AppLink>
            )}
          </div>
        )}
        {row.held.length > 0 && (
          <p className="ms-7 text-sm" role="status">
            Held: {row.held.join("; ")}
          </p>
        )}
      </li>
    );
  };
  const group = (id: string, title: string, list: Row[], note?: string) =>
    list.length > 0 && (
      <section aria-labelledby={id} className="flex flex-col" data-testid={id}>
        <h3 className="font-semibold text-sm" id={id}>
          {title} ({list.length})
        </h3>
        {note && <p className="text-muted-foreground text-xs">{note}</p>}
        <ul className="flex flex-col divide-y">{list.map(rowView)}</ul>
      </section>
    );
  const n = body.send.length;
  return (
    <div className="flex flex-col gap-4" data-testid="lead-review">
      {group("review-needs", "Needs your input", needs, "Fill the gap, then the reply is ticked.")}
      {group("review-ready", "Ready", ready)}
      {group("review-new-senders", "New senders", newSenders, "You never wrote to these addresses: read each reply, then tick it.")}
      {showProposals && (
        <label className="flex items-start gap-3 text-sm">
          <Checkbox aria-label={proposalsLine(d.proposals)} checked={alsoMark} className="mt-0.5" onCheckedChange={(on) => setAlsoMark(on === true)} />
          <span className="flex min-w-0 flex-col">
            <span>{proposalsLine(d.proposals)}</span>
            <span className="truncate text-muted-foreground text-xs">{d.proposals.map((p) => p.name).join(", ")}</span>
          </span>
        </label>
      )}
      {only === null && d.handOvers.length > 0 && (
        <p className="text-sm">
          <span className="text-muted-foreground">For you: </span>
          {d.handOvers.map((h, i) => (
            <span key={`${h.kind}:${h.pageId}`}>
              {i > 0 && ", "}
              {h.kind === "mail" ? <AppLink to={dest("mail.conversation", { key: clientKey({ id: 1, email: h.email ?? "" }) }, { filter: "all" })}>{h.name}</AppLink> : <AppLink to={dest("mail.lead", { page: h.pageId }, { view: "for_you", brand: null })}>{h.name}</AppLink>}
            </span>
          ))}
        </p>
      )}
      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t bg-background py-3">
        <ActionButton data-testid="review-send" disabled={verifying !== null || !d.verified || confirm.isPending || n + body.proposals.length + body.exclude.length === 0} onClick={() => confirm.mutate(body)} size="m" variant="primary">
          <SendIcon aria-hidden="true" />
          {n === 0 && body.proposals.length > 0 ? `Mark ${body.proposals.length}` : `Send ${n}`}
        </ActionButton>
        <p className="text-muted-foreground text-xs tabular-nums" role="status">
          {verifying === "failed" ? "Mail did not answer: close and open again to check the drafts." : verifying !== null ? `Checking ${verifying} ${verifying === 1 ? "draft" : "drafts"} in Mail…` : `One every ${d.spacingSeconds} s · mails today ${d.cap.used} of ${d.cap.limit}`}
        </p>
        <span className="text-destructive-foreground text-sm" role="alert">
          {error ?? ""}
        </span>
      </div>
    </div>
  );
}

/** What the click did, said once: "12 sending · 2 held (reasons) · 7 marked". */
export function sentLine(t: LeadReviewTicketDto): string {
  const marked = t.applied.spam + t.applied.notNow + t.applied.noReply;
  const parts = [`${t.items.length} sending`];
  if (t.held.length) parts.push(`${t.held.length} held: ${t.held.map((h) => `${h.name} (${h.reasons.join("; ")})`).join(", ")}`);
  if (marked) parts.push(`${marked} marked`);
  if (t.applied.junk) parts.push(`${t.applied.junk} moved to Junk`);
  if (t.applied.notMoved.length) parts.push(`not moved: ${t.applied.notMoved.join("; ")}`);
  return parts.join(" · ");
}

/** The review page, mounted by `mail/leads/review/[batch]/page.tsx`: the same list as the sheet, with the run's line on top. */
export function LeadReviewScreen() {
  const route = useRoute();
  const { project } = useProjectScope();
  const batch = route.route === "mail.lead-review" ? route.params.batch : 0;
  // The same two reads as the sheet: the Hub's copy at once, the Mail read verifies it (Send waits for it).
  const stored = useLeadReview(project, batch, { stored: true });
  const mail = useLeadReview(project, batch);
  const q = mail.data ? mail : stored;
  const [said, setSaid] = useState<string | null>(null);
  const go = useGo();
  return (
    <Page
      label="Today's replies"
      nav={
        <AppLink bare className="inline-flex min-h-(--control-m) items-center gap-2 text-sm" to={dest("mail.leads", { view: "drafted", brand: null })}>
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          Leads
        </AppLink>
      }
      title="Today’s replies"
    >
      <SendingLine batchId={batch} project={project} />
      {said && (
        <p className="text-sm" role="status">
          {said}
        </p>
      )}
      <QueryView loading={<ListSkeleton label="Reading today's drafts" />} query={q} what="today's replies">
        {(d) => (d.rows.length + d.proposals.length + d.handOvers.length === 0 ? <EmptyState title="Nothing to send">The day’s passes wrote no draft and proposed nothing.</EmptyState> : <ReadyList d={d} key={d.batchId} onSent={(t) => (t.items.length ? go(dest("mail.sent")) : setSaid(sentLine(t)))} project={project} verifying={mail.data ? null : mail.isError ? "failed" : d.rows.length} />)}
      </QueryView>
    </Page>
  );
}

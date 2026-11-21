"use client";

import { useQuery } from "@tanstack/react-query";
import { phrase } from "@hub/contract/help";
import { useCallback, useEffect, useMemo } from "react";
import type { ClientFilter } from "@hub/config";
import { EmptyState } from "@/components/state-views";
import { ReviewWorkspace } from "@/features/review/workspace";
import type { View } from "@/features/review/list-controls";
import type { ReviewPage, ReviewSource } from "@/features/review/source";
import { useDebounced } from "@/hooks/use-debounced";
import { useGo } from "@/hooks/use-go";
import { usePaneMeasured, usePaneNarrow } from "@/hooks/use-pane";
import { useProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { useSearchState } from "@/hooks/use-search-state";
import { reviewApi } from "@/lib/api/review";
import { paths } from "@/routes/paths";
import { DRAFT_VIEW_LABELS, DRAFT_VIEWS, type DraftView } from "@/routes/search";
import { BatchSend } from "./batch-send";
import { InboundCard } from "./inbox/inbound-card";
import { InboxView, useInbound } from "./inbox/inbox-view";
import { LeadCard } from "./inbox/lead-card";
import { NotByEmail, useNotByEmailTotal } from "./not-by-email";
import { FollowUps } from "./sequences/follow-ups";
import { StatusLine } from "./status-line";
import { keys } from "@/lib/cache/keys";

// Inbox first (P96), All last. To review is the address default (a bare `/mail` shows what needs the owner); All keeps `?filter=all`.
// P96: Sent is its own view; Finished keeps Done and Skipped.
const FINISHED: readonly ClientFilter[] = ["done", "skipped"];
const EMPTY: Record<DraftView, string> = { inbox: "No client is waiting", ready: "Nothing to review", hold: "Nothing on hold", thin_basis: "No draft with a thin basis", sequences: "No follow-up step to review", not_by_email: "Nobody", sent: "Nothing sent yet", finished: "Nothing finished yet", all: "No drafts" };
const SEARCH_PAUSE_MS = 250;
/** A batch is chosen from the View menu like a view; its value carries the id. */
const BATCH = "batch:";
/**
 * P96: the projects whose bare `/mail` already moved to Inbox in this page load. Inbox is the default when it is not empty
 * (plan section 4) without changing the address default: on arrival only, so To review chosen afterwards stays To review.
 */
const ARRIVED = new Set<string>();

type Scope = { search: string; batch: number | null };

/** Finished is two server statuses at once (done, skipped): read together, newest first. */
async function finished(project: string, offset: number, scope: Scope): Promise<ReviewPage> {
  const pages = await Promise.all(FINISHED.map((f) => reviewApi.drafts(project, f, offset, scope)));
  const next = pages.flatMap((p) => (p.nextOffset === null ? [] : [p.nextOffset]));
  return {
    drafts: pages.flatMap((p) => p.drafts).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    total: pages.reduce((n, p) => n + p.total, 0),
    nextOffset: next.length > 0 ? Math.max(...next) : null,
    counts: pages[0]?.counts ?? {},
  };
}

function countOf(counts: ReviewPage["counts"], view: string): number | undefined {
  return view === "finished" ? FINISHED.reduce((n, f) => n + (counts[f] ?? 0), 0) : counts[view];
}

type Props = { project: string; filter: DraftView; q: string; batch: number | null; selectedId: number | null; inboundId: number | null; leadPageId: string | null; arrival: boolean; mobile: boolean; measured: boolean };

/** Mail: the list column (View menu, status line, rows) and the open card. The view, the search, the batch and the open draft or message live in the address. */
function MailSection({ project, filter, q, batch, selectedId, inboundId, leadPageId, arrival, mobile, measured }: Props) {
  const go = useGo();
  const onAuto = useCallback((id: number) => go(paths.mail.item(id, { filter, q, batch }), { replace: true }), [go, filter, q, batch]);
  const setQ = useSearchState("q")[1];
  const search = useDebounced(q.trim(), SEARCH_PAUSE_MS);
  const batches = useQuery({ queryKey: keys.batches(project), queryFn: () => reviewApi.batches(project) });
  const notByEmail = useNotByEmailTotal(project);
  const inbound = useInbound(project);
  // P97: the Leads group counts as Inbox's too (arrival moves to Inbox when a lead waits); the View menu counts the people in both.
  const wrote = inbound.data === undefined ? undefined : inbound.data.total + (inbound.data.leads?.total ?? 0);
  // Arrival with clients waiting: Inbox (replacing the bare address, no history entry), once per project per page load.
  useEffect(() => {
    if (!arrival || wrote === undefined || ARRIVED.has(project)) return;
    ARRIVED.add(project);
    if (wrote > 0) go(paths.mail.list({ filter: "inbox" }), { replace: true });
  }, [arrival, wrote, project, go]);
  const known = batch === null || (batches.data?.batches.some((b) => b.id === batch) ?? true);
  const current = batch === null ? undefined : batches.data?.batches.find((b) => b.id === batch);
  const source = useMemo<ReviewSource>(() => {
    const scope = { search, batch };
    return {
      queryKey: keys.drafts(project, filter, batch, search),
      project,
      filter,
      countOf,
      // Inbox and Not by email list clients, not drafts: the list query still runs (as All) so the View menu keeps every count.
      load: (offset) => (filter === "finished" ? finished(project, offset, scope) : reviewApi.drafts(project, filter === "inbox" || filter === "not_by_email" ? "all" : filter, offset, scope)),
      ...(batch === null ? {} : { undoLast: () => reviewApi.undoBatch(project, batch) }),
    };
  }, [project, filter, batch, search]);
  const views = (counts: ReviewPage["counts"]): View[] => [
    ...DRAFT_VIEWS.map((v) => ({ value: v, label: DRAFT_VIEW_LABELS[v], count: v === "not_by_email" ? notByEmail : v === "inbox" ? wrote : countOf(counts, v) })),
    ...(batches.data?.batches ?? []).map((b) => ({ value: `${BATCH}${b.id}`, label: b.name, count: b.total, group: "Batches" })),
  ];
  // The View menu's value is the batch when one is open, else the view.
  const onView = (v: string) =>
    v.startsWith(BATCH) ? go(paths.mail.list({ filter: "all", batch: Number(v.slice(BATCH.length)) }), { replace: true }) : go(paths.mail.list({ filter: DRAFT_VIEWS.find((x) => x === v) ?? "ready", q }), { replace: true });
  const inbox = filter === "inbox" && batch === null;
  return (
    <ReviewWorkspace
      aside={
        inbox
          ? {
              open: inboundId !== null || leadPageId !== null,
              node:
                leadPageId !== null ? (
                  <LeadCard key={leadPageId} onClosed={() => go(paths.mail.list({ filter: "inbox" }), { replace: true })} pageId={leadPageId} project={project} />
                ) : inboundId !== null ? (
                  <InboundCard id={inboundId} key={inboundId} onClosed={() => go(paths.mail.list({ filter: "inbox" }), { replace: true })} project={project} />
                ) : (
                  <EmptyState title="Nothing to open">Pick a client from the list to read what they wrote.</EmptyState>
                ),
            }
          : undefined
      }
      body={filter === "not_by_email" ? <NotByEmail project={project} /> : inbox ? <InboxView openId={inboundId} openPageId={leadPageId} project={project} /> : undefined}
      empty={(filtered) =>
        !known
          ? "That batch is not in this project."
          : batch !== null
            ? `${EMPTY[filter]} in this batch.`
            : filtered
              ? null
              : `Say to the agent: “${phrase("triage-mail", project)}”. Drafts it leaves unsent in Mail appear here.`
      }
      emptyTitle={known && batch === null ? EMPTY[filter] : undefined}
      listBottom={
        batch !== null && known ? (
          // P85b: a batch's own Send all Checked; every draft still has its own Send on its card.
          <BatchSend batchId={batch} brief={current?.brief ?? null} checked={current?.counts.checked ?? 0} open={(current?.counts.review ?? 0) + (current?.counts.checked ?? 0) + (current?.counts.hold ?? 0)} project={project} />
        ) : filter === "sequences" ? (
          <FollowUps project={project} />
        ) : undefined
      }
      mobile={mobile}
      noun={{ list: "Mail", back: "Mail" }}
      onView={onView}
      search={[q, setQ]}
      // On arrival nothing opens by itself until the Inbox count is known: with clients waiting the screen moves to Inbox instead.
      measured={measured && (!arrival || wrote !== undefined)}
      // The first pick from the list pushes (Back returns to the list); moving between drafts replaces; the draft the screen
      // opens by itself on a wide pane replaces too (P53), so the address always names the card on screen.
      selection={{ id: selectedId, onChange: (id) => go(id === null ? paths.mail.list({ filter, q, batch }) : paths.mail.item(id, { filter, q, batch }), { replace: selectedId !== null }), onAuto }}
      source={{ ...source, filter: batch === null ? filter : `${BATCH}${batch}` }}
      status={<StatusLine project={project} />}
      views={views}
    />
  );
}

/**
 * The Mail screen (Drafts until P96), the home of every instance, mounted by `mail/layout.tsx` so the list survives opening and
 * closing a card. It reads the address (the view, the search, the batch, the open draft or client message) and the project
 * scope; for any other address (Not found under /mail) it renders nothing and the route's own page shows.
 */
export function MailScreen() {
  const route = useRoute();
  const { project } = useProjectScope();
  // A pane too narrow for the split (a phone, or the terminal docked beside it) shows the list and the card as separate screens: no card opens until a row is chosen.
  const compact = usePaneNarrow();
  const measured = usePaneMeasured();
  if (route.route !== "mail.list" && route.route !== "mail.item" && route.route !== "mail.inbound" && route.route !== "mail.lead") return null;
  const selectedId = route.route === "mail.item" ? route.params.id : null;
  const inboundId = route.route === "mail.inbound" ? route.params.id : null;
  const leadPageId = route.route === "mail.lead" ? route.params.pageId : null;
  const { q, batch } = route.search;
  // A client's message is always Inbox's card, whatever view the address names.
  const filter: DraftView = route.route === "mail.inbound" || route.route === "mail.lead" ? "inbox" : route.search.filter;
  const arrival = route.route === "mail.list" && filter === "ready" && q === "" && batch === null;
  return <MailSection arrival={arrival} batch={batch} filter={filter} inboundId={inboundId} leadPageId={leadPageId} measured={measured} mobile={compact} project={project} q={q} selectedId={selectedId} />;
}

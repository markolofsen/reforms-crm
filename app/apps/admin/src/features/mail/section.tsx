"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { phrase } from "@hub/contract/help";
import { useCallback, useMemo } from "react";
import { ReviewWorkspace } from "@/features/review/workspace";
import type { View } from "@/features/review/list-controls";
import type { ReviewPage, ReviewSource } from "@/features/review/source";
import { useDebounced } from "@/hooks/use-debounced";
import { useGo } from "@/hooks/use-go";
import { usePaneMeasured, usePaneNarrow } from "@/hooks/use-pane";
import { useProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { useSearch } from "@/hooks/use-search-state";
import { reviewApi } from "@/lib/api/review";
import { keys } from "@/lib/cache/keys";
import { dest } from "@/routes/paths";
import { DRAFT_FILTERS, DRAFT_VIEW_LABELS, DRAFT_VIEWS, MAIL_SEARCH, type DraftView } from "@/routes/search";
import { BatchSend } from "./batch-send";
import { LeadCard } from "./inbox/lead-card";
import { LeadsGroup, useInbound } from "./inbox/leads-group";
import { NotByEmail, useNotByEmailTotal } from "./not-by-email";
import { FollowUps } from "./sequences/follow-ups";
import { StatusLine } from "./status-line";

// P99 (verdict 3): Mail lists people. Needs you (they wrote, or a draft is ready) is the default, then Waiting and All; Follow-ups
// and Not by email are filters of All under their own heading. The old views (To review, Hold, Thin basis, Sent, Finished, Inbox)
// are state words and chips on a row.
const EMPTY: Record<DraftView, string> = { needs_you: "Nobody needs you", waiting: "Nobody to wait for", all: "No conversation yet", sequences: "No follow-up step to review", not_by_email: "Nobody" };
const SEARCH_PAUSE_MS = 250;
/** A batch is chosen from the View menu like a view; its value carries the id. */
const BATCH = "batch:";

type Scope = { search: string; batch: number | null };

const page = async (project: string, view: Exclude<DraftView, "not_by_email">, offset: number, scope: Scope): Promise<ReviewPage> => {
  const r = await reviewApi.conversations(project, view, offset, scope);
  return { rows: r.rows, total: r.total, nextOffset: r.nextOffset, counts: r.counts };
};
const countOf = (counts: ReviewPage["counts"], view: string): number | undefined => counts[view];

/**
 * P128 X0 (F5): the rail's Mail badge is the Needs you count of the very query Mail's default list reads (same key, same loader;
 * the counts do not depend on the view or the search), so the badge and Mail ▸ Needs you never disagree.
 */
export function useMailNeedsYou(project: string | null): number {
  const q = useInfiniteQuery({
    queryKey: keys.drafts(project ?? "", "needs_you", null, ""),
    queryFn: ({ pageParam }) => page(project ?? "", "needs_you", pageParam, { search: "", batch: null }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    enabled: project !== null,
  });
  return project === null ? 0 : (countOf(q.data?.pages[0]?.counts ?? {}, "needs_you") ?? 0);
}

type Props = { project: string; filter: DraftView; q: string; batch: number | null; clientId: number | null; pointed: string | null; leadPageId: string | null; mobile: boolean; measured: boolean };

/** Mail: the list column (View menu, status line, people) and the open conversation. The view, the search, the batch and the person live in the address. */
function MailSection({ project, filter, q, batch, clientId, pointed, leadPageId, mobile, measured }: Props) {
  const go = useGo();
  const onAuto = useCallback((id: number) => go(dest("mail.conversation", { id }, { filter, q, batch }), { replace: true }), [go, filter, q, batch]);
  const [, setSearch] = useSearch(MAIL_SEARCH);
  const setQ = useCallback((v: string) => setSearch({ q: v }), [setSearch]);
  const search = useDebounced(q.trim(), SEARCH_PAUSE_MS);
  const batches = useQuery({ queryKey: keys.batches(project), queryFn: () => reviewApi.batches(project) });
  const notByEmail = useNotByEmailTotal(project);
  const inbound = useInbound(project);
  const known = batch === null || (batches.data?.batches.some((b) => b.id === batch) ?? true);
  const current = batch === null ? undefined : batches.data?.batches.find((b) => b.id === batch);
  const source = useMemo<ReviewSource>(() => {
    const scope = { search, batch };
    return {
      queryKey: keys.drafts(project, filter, batch, search),
      project,
      filter,
      countOf,
      // Not by email lists client rows, not conversations: the list query still runs (as All) so the View menu keeps every count.
      load: (offset) => page(project, filter === "not_by_email" ? "all" : filter, offset, scope),
      ...(batch === null ? {} : { undoLast: () => reviewApi.undoBatch(project, batch) }),
    };
  }, [project, filter, batch, search]);
  const views = (counts: ReviewPage["counts"]): View[] => [
    ...DRAFT_VIEWS.map((v) => ({ value: v, label: DRAFT_VIEW_LABELS[v], count: v === "not_by_email" ? notByEmail : countOf(counts, v), ...(DRAFT_FILTERS.has(v) ? { group: "Filters" } : {}) })),
    ...(batches.data?.batches ?? []).map((b) => ({ value: `${BATCH}${b.id}`, label: b.name, count: b.total, group: "Batches" })),
  ];
  // The View menu's value is the batch when one is open, else the view.
  const onView = (v: string) =>
    v.startsWith(BATCH) ? go(dest("mail.list", { filter: "all", batch: Number(v.slice(BATCH.length)) }), { replace: true }) : go(dest("mail.list", { filter: DRAFT_VIEWS.find((x) => x === v) ?? "needs_you", q }), { replace: true });
  // P97, P99 verdict 8: a lead is not a conversation until the first reply is sent: New leads stay a group below the people.
  const leads = batch === null && (filter === "needs_you" || filter === "all") && inbound.data?.leads ? <LeadsGroup group={inbound.data.leads} openPageId={leadPageId} /> : undefined;
  return (
    <ReviewWorkspace
      aside={leadPageId !== null ? { open: true, node: <LeadCard key={leadPageId} onClosed={() => go(dest("mail.list", { filter }), { replace: true })} pageId={leadPageId} project={project} /> } : undefined}
      body={filter === "not_by_email" ? <NotByEmail project={project} /> : undefined}
      empty={(filtered) =>
        !known
          ? "That batch is not in this project."
          : batch !== null
            ? `${EMPTY[filter]} in this batch.`
            : filtered
              ? null
              : `Say to the agent: “${phrase("triage-mail", project)}”. The people it answers appear here, with their whole correspondence.`
      }
      emptyTitle={known && batch === null ? EMPTY[filter] : undefined}
      listBottom={
        batch !== null && known ? (
          // P85b: a batch's own Send all Checked; every draft still has its own Send at the bottom of its conversation.
          <BatchSend batchId={batch} brief={current?.brief ?? null} checked={current?.counts.checked ?? 0} open={(current?.counts.review ?? 0) + (current?.counts.checked ?? 0) + (current?.counts.hold ?? 0)} project={project} />
        ) : filter === "sequences" ? (
          <FollowUps project={project} />
        ) : (
          leads
        )
      }
      measured={measured}
      mobile={mobile}
      noun={{ list: "Mail", back: "Mail" }}
      onView={onView}
      pointed={pointed}
      search={[q, setQ]}
      // The first pick from the list pushes (Back returns to the list); moving between people replaces; the person the screen
      // opens by itself on a wide pane replaces too (P53), so the address always names the conversation on screen.
      selection={{ id: clientId, onChange: (id) => go(id === null ? dest("mail.list", { filter, q, batch }) : dest("mail.conversation", { id }, { filter, q, batch }), { replace: clientId !== null }), onAuto }}
      source={{ ...source, filter: batch === null ? filter : `${BATCH}${batch}` }}
      status={<StatusLine project={project} />}
      views={views}
    />
  );
}

/**
 * The Mail screen, the home of every instance, mounted by `mail/layout.tsx` so the list survives opening and closing a
 * conversation. It reads the address (the view, the search, the batch, the person, a lead) and the project scope; for any other
 * address (Not found under /mail) it renders nothing and the route's own page shows.
 */
export function MailScreen() {
  const route = useRoute();
  const { project } = useProjectScope();
  // A pane too narrow for the split (a phone, or the terminal docked beside it) shows the list and the conversation as separate screens.
  const compact = usePaneNarrow();
  const measured = usePaneMeasured();
  if (route.route !== "mail.list" && route.route !== "mail.conversation" && route.route !== "mail.lead") return null;
  const clientId = route.route === "mail.conversation" ? route.params.id : null;
  const leadPageId = route.route === "mail.lead" ? route.params.page : null;
  const { q, batch, filter } = route.search;
  return <MailSection batch={batch} clientId={clientId} filter={filter} leadPageId={leadPageId} measured={measured} mobile={compact} pointed={route.search.m ?? null} project={project} q={q} />;
}

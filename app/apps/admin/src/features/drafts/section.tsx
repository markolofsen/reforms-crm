"use client";

import { useQuery } from "@tanstack/react-query";
import { phrase } from "@hub/contract/help";
import { useCallback, useMemo } from "react";
import type { ClientFilter } from "@hub/config";
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
import { DRAFT_VIEWS, type DraftView } from "@/routes/search";
import { BatchSend } from "./batch-send";
import { NotByEmail, useNotByEmailTotal } from "./not-by-email";
import { FollowUps } from "./sequences/follow-ups";
import { StatusLine } from "./status-line";
import { keys } from "@/lib/cache/keys";

// To review first, All last. To review is the address default (a bare `/drafts` shows what needs the owner); All keeps `?filter=all`.
const LABEL: Record<DraftView, string> = { ready: "To review", hold: "Hold", thin_basis: "Thin basis", finished: "Finished", sequences: "Follow-ups", not_by_email: "Not by email", all: "All" };
const FINISHED: readonly ClientFilter[] = ["done", "sent", "skipped"];
const EMPTY: Record<DraftView, string> = { ready: "Nothing to review", hold: "Nothing on hold", thin_basis: "No draft with a thin basis", finished: "Nothing finished yet", sequences: "No follow-up step to review", not_by_email: "Nobody", all: "No drafts" };
const SEARCH_PAUSE_MS = 250;
/** A batch is chosen from the View menu like a view; its value carries the id. */
const BATCH = "batch:";

type Scope = { search: string; batch: number | null };

/** Finished is three server statuses at once (done, sent, skipped): read together, newest first. */
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

type Props = { project: string; filter: DraftView; q: string; batch: number | null; selectedId: number | null; mobile: boolean; measured: boolean };

/** Drafts: the list column (View menu, status line, rows) and the open card. The view, the search, the batch and the open draft live in the address. */
function DraftsSection({ project, filter, q, batch, selectedId, mobile, measured }: Props) {
  const go = useGo();
  const onAuto = useCallback((id: number) => go(paths.drafts.item(id, { filter, q, batch }), { replace: true }), [go, filter, q, batch]);
  const setQ = useSearchState("q")[1];
  const search = useDebounced(q.trim(), SEARCH_PAUSE_MS);
  const batches = useQuery({ queryKey: keys.batches(project), queryFn: () => reviewApi.batches(project) });
  const notByEmail = useNotByEmailTotal(project);
  const known = batch === null || (batches.data?.batches.some((b) => b.id === batch) ?? true);
  const current = batch === null ? undefined : batches.data?.batches.find((b) => b.id === batch);
  const source = useMemo<ReviewSource>(() => {
    const scope = { search, batch };
    return {
      queryKey: keys.drafts(project, filter, batch, search),
      project,
      filter,
      countOf,
      // Not by email shows its own body; the list query still runs (as All) so the View menu keeps every count.
      load: (offset) => (filter === "finished" ? finished(project, offset, scope) : reviewApi.drafts(project, filter === "not_by_email" ? "all" : filter, offset, scope)),
      ...(batch === null ? {} : { undoLast: () => reviewApi.undoBatch(project, batch) }),
    };
  }, [project, filter, batch, search]);
  const views = (counts: ReviewPage["counts"]): View[] => [
    ...DRAFT_VIEWS.map((v) => ({ value: v, label: LABEL[v], count: v === "not_by_email" ? notByEmail : countOf(counts, v) })),
    ...(batches.data?.batches ?? []).map((b) => ({ value: `${BATCH}${b.id}`, label: b.name, count: b.total, group: "Batches" })),
  ];
  // The View menu's value is the batch when one is open, else the view.
  const onView = (v: string) =>
    v.startsWith(BATCH) ? go(paths.drafts.list({ filter: "all", batch: Number(v.slice(BATCH.length)) }), { replace: true }) : go(paths.drafts.list({ filter: DRAFT_VIEWS.find((x) => x === v) ?? "ready", q }), { replace: true });
  return (
    <ReviewWorkspace
      body={filter === "not_by_email" ? <NotByEmail project={project} /> : undefined}
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
      noun={{ list: "Drafts", back: "Drafts" }}
      onView={onView}
      search={[q, setQ]}
      measured={measured}
      // The first pick from the list pushes (Back returns to the list); moving between drafts replaces; the draft the screen
      // opens by itself on a wide pane replaces too (P53), so the address always names the card on screen.
      selection={{ id: selectedId, onChange: (id) => go(id === null ? paths.drafts.list({ filter, q, batch }) : paths.drafts.item(id, { filter, q, batch }), { replace: selectedId !== null }), onAuto }}
      source={{ ...source, filter: batch === null ? filter : `${BATCH}${batch}` }}
      status={<StatusLine project={project} />}
      views={views}
    />
  );
}

/**
 * The Drafts screen, the home of every instance, mounted by `drafts/layout.tsx` so the list survives opening and closing a
 * card. It reads the address (the view, the search, the batch, the open draft) and the project scope; for any other address
 * (Not found under /drafts) it renders nothing and the route's own page shows.
 */
export function DraftsScreen() {
  const route = useRoute();
  const { project } = useProjectScope();
  // A pane too narrow for the split (a phone, or the terminal docked beside it) shows the list and the card as separate screens: no card opens until a row is chosen.
  const compact = usePaneNarrow();
  const measured = usePaneMeasured();
  if (route.route !== "drafts.list" && route.route !== "drafts.item") return null;
  const selectedId = route.route === "drafts.item" ? route.params.id : null;
  const { filter, q, batch } = route.search;
  return <DraftsSection batch={batch} filter={filter} measured={measured} mobile={compact} project={project} q={q} selectedId={selectedId} />;
}

"use client";

import { useMemo } from "react";
import type { ClientFilter } from "@hub/config";
import { InboxQueue } from "./inbox-queue";
import { NotByEmail } from "./not-by-email";
import { BatchBar } from "./batch-bar";
import { BatchGone, BatchHead, BatchWaiting, BATCH_POLL_MS, useBatchHead } from "./batch-head";
import { NewBatch } from "./new-batch";
import { ProjectSwitcher } from "@/features/shell/project-switcher";
import { ReviewWorkspace } from "@/features/review/workspace";
import type { ReviewPage, ReviewSource } from "@/features/review/source";
import { paneStateOf } from "@/features/review/card/card-state";
import { bulkApi } from "@/lib/api/bulk";
import { reviewApi } from "@/lib/api/review";
import { useSidebar } from "@hub/ui/sidebar";
import { useDebounced } from "@/hooks/use-debounced";
import { useGo } from "@/hooks/use-go";
import { useMediaQuery } from "@hub/ui/use-media-query";
import { useProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { useSearchState } from "@/hooks/use-search-state";
import { paths } from "@/routes/paths";
import type { DraftView } from "@/routes/search";

// To review first, All last. To review is the address default (a bare `/drafts` shows what needs the owner); All keeps `?filter=all`.
const VIEWS: { value: DraftView; label: string }[] = [
  { value: "ready", label: "To review" },
  { value: "hold", label: "Hold" },
  { value: "evidence", label: "Evidence" },
  { value: "finished", label: "Finished" },
  { value: "all", label: "All" },
];
const FINISHED: readonly ClientFilter[] = ["done", "sent", "skipped"];
const EMPTY: Record<DraftView, string> = { ready: "Nothing to review", hold: "Nothing on hold", evidence: "No draft with weak evidence", finished: "Nothing finished yet", all: "No drafts" };
const SEARCH_PAUSE_MS = 250;

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

type Props = {
  project: string;
  projects: string[];
  onProject: (p: string) => void;
  filter: DraftView;
  q: string;
  batch: number | null;
  building: boolean;
  selectedId: number | null;
  mobile: boolean;
  phone: boolean;
};

/** Drafts: the list column and the open card (or the batch builder). The view, the search, the batch and the open draft live in the address. */
function DraftsSection({ project, projects, onProject, filter, q, batch, building, selectedId, mobile, phone }: Props) {
  const go = useGo();
  const setView = useSearchState("filter")[1];
  const setQ = useSearchState("q")[1];
  const search = useDebounced(q.trim(), SEARCH_PAUSE_MS);
  const head = useBatchHead(project, batch);
  const queued = head.data?.batch.status === "queued";
  const source = useMemo<ReviewSource>(() => {
    const scope = { search, batch };
    return {
      queryKey: ["drafts", project, filter, batch, search],
      project,
      filter,
      countOf,
      load: (offset) => (filter === "finished" ? finished(project, offset, scope) : reviewApi.drafts(project, filter, offset, scope)),
      // A batch steps back its own last action (key U) and fills in by itself while the agent writes it.
      ...(batch === null ? {} : { undoLast: () => bulkApi.undoLast(project, batch), refetchMs: queued ? BATCH_POLL_MS : false }),
    };
  }, [project, filter, batch, search, queued]);
  const summary = head.data?.batch ?? null;
  const waiting = summary !== null && paneStateOf({ status: summary.status, written: summary.counts.all }) === "batch_waiting";
  return (
    <ReviewWorkspace
      empty={(filtered) =>
        batch !== null
          ? queued
            ? "No draft has arrived yet."
            : `${EMPTY[filter]} in this batch.`
          : filtered
            ? `${EMPTY[filter]} in this project.`
            : `Say to the agent: "разбери почту ${project}". Drafts it leaves unsent in Mail appear here.`
      }
      idle={waiting && summary ? <BatchWaiting total={summary.total} written={summary.counts.all} /> : undefined}
      listTop={
        <>
          {phone && <div className="px-3 pt-3"><ProjectSwitcher onChange={onProject} projects={projects} value={project} /></div>}
          <BatchBar batch={batch} filter={filter} name={summary?.name ?? null} project={project} />
          {batch === null ? <InboxQueue project={project} /> : summary ? <BatchHead batch={summary} /> : head.isError ? <BatchGone /> : null}
        </>
      }
      listBottom={batch === null ? <NotByEmail project={project} /> : undefined}
      mobile={mobile}
      noun={{ list: "Drafts", back: "Drafts" }}
      onView={setView}
      pane={building ? { node: <div className="flex flex-col gap-4 p-4 sm:p-6"><NewBatch key={project} project={project} /></div>, onClose: () => go(paths.drafts.list({ filter }), { replace: true }) } : undefined}
      search={[q, setQ]}
      // The first pick from the list pushes (Back returns to the list); moving between drafts replaces.
      selection={{ id: selectedId, onChange: (id) => go(id === null ? paths.drafts.list({ filter, q, batch }) : paths.drafts.item(id, { filter, q, batch }), { replace: selectedId !== null }) }}
      source={source}
      views={VIEWS}
    />
  );
}

/**
 * The Drafts screen, mounted by `drafts/layout.tsx` so the list survives opening and closing a card. It reads the
 * address (the view, the search, the batch, the open draft) and the project scope; for any other address (Not found under
 * /drafts) it renders nothing and the route's own page shows.
 */
export function DraftsScreen() {
  const route = useRoute();
  const { project, projects, onProject } = useProjectScope();
  const { isMobile } = useSidebar();
  // Below 1024px the list and its detail are separate screens (a tablet keeps the rail, a phone gets the tab bar).
  const compact = useMediaQuery("max-lg");
  if (route.route !== "drafts.list" && route.route !== "drafts.item") return null;
  const selectedId = route.route === "drafts.item" ? route.params.id : null;
  const { filter, q, batch, new: building } = route.search;
  return <DraftsSection batch={batch} building={building && route.route === "drafts.list"} filter={filter} mobile={compact} onProject={onProject} phone={isMobile} project={project} projects={projects} q={q} selectedId={selectedId} />;
}

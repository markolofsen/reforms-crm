"use client";

import { useMemo } from "react";
import type { ClientFilter } from "@hub/config";
import { InboxQueue } from "./inbox-queue";
import { ProjectSwitcher } from "@/features/shell/project-switcher";
import { ReviewWorkspace } from "@/features/review/workspace";
import type { ReviewPage, ReviewSource } from "@/features/review/source";
import { reviewApi } from "@/lib/api/review";
import { useSidebar } from "@/components/ui/sidebar";
import { useGo } from "@/hooks/use-go";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useProjectScope } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { useSearchState } from "@/hooks/use-search-state";
import { paths } from "@/routes/paths";
import type { DraftView } from "@/routes/search";

// To review first, All last. To review is the address default (a bare `/drafts` shows what needs the owner); All keeps `?filter=all`.
const VIEWS: { value: DraftView; label: string }[] = [
  { value: "ready", label: "To review" },
  { value: "hold", label: "Hold" },
  { value: "evidence", label: "Check evidence" },
  { value: "finished", label: "Finished" },
  { value: "all", label: "All" },
];
const FINISHED: readonly ClientFilter[] = ["done", "sent", "skipped"];
const EMPTY: Record<DraftView, string> = { ready: "Nothing to review", hold: "Nothing on hold", evidence: "No draft with weak evidence", finished: "Nothing finished yet", all: "No drafts" };

/** Finished is three server statuses at once (done, sent, skipped): read together, newest first. */
async function finished(project: string, offset: number): Promise<ReviewPage> {
  const pages = await Promise.all(FINISHED.map((f) => reviewApi.drafts(project, f, offset)));
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

type Props = { project: string; projects: string[]; onProject: (p: string) => void; filter: DraftView; q: string; selectedId: number | null; mobile: boolean; phone: boolean };

/** Drafts: the list column and the open card. The view, the search and the open draft live in the address. */
function DraftsSection({ project, projects, onProject, filter, q, selectedId, mobile, phone }: Props) {
  const go = useGo();
  const setView = useSearchState("filter")[1];
  const setQ = useSearchState("q")[1];
  const source = useMemo<ReviewSource>(
    () => ({
      queryKey: ["drafts", project, filter],
      project,
      filter,
      countOf,
      load: (offset) => (filter === "finished" ? finished(project, offset) : reviewApi.drafts(project, filter, offset)),
    }),
    [project, filter],
  );
  return (
    <ReviewWorkspace
      empty={(filtered) => (filtered ? `${EMPTY[filter]} in this project.` : `Ask the agent: разбери почту ${project}. Drafts it leaves unsent in Mail appear here.`)}
      listTop={
        <>
          {phone && <div className="px-3 pt-3"><ProjectSwitcher onChange={onProject} projects={projects} value={project} /></div>}
          <InboxQueue project={project} />
        </>
      }
      mobile={mobile}
      noun={{ list: "Drafts", back: "Drafts" }}
      onView={setView}
      search={[q, setQ]}
      // The first pick from the list pushes (Back returns to the list); moving between drafts replaces.
      selection={{ id: selectedId, onChange: (id) => go(id === null ? paths.drafts.list({ filter, q }) : paths.drafts.item(id, { filter, q }), { replace: selectedId !== null }) }}
      source={source}
      views={VIEWS}
    />
  );
}

/**
 * The Drafts screen, mounted by `drafts/layout.tsx` so the list survives opening and closing a card. It reads the
 * address (the view, the search, the open draft) and the project scope; for any other address (Not found under
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
  return <DraftsSection filter={route.search.filter} mobile={compact} onProject={onProject} phone={isMobile} project={project} projects={projects} q={route.search.q} selectedId={selectedId} />;
}

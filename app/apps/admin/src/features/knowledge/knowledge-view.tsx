import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { phrase } from "@hub/contract/help";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { KnowledgeListDto, KnowledgeView as View } from "@hub/contract/knowledge";
import { Input } from "@hub/ui/input";
import { ActionButton } from "@hub/ui/product/action-button";
import { Page } from "@hub/ui/product/page";
import { SectionLayout } from "@hub/ui/product/section-layout";
import { SectionNav, type SectionNavItem } from "@hub/ui/product/section-nav";
import { AppLink } from "@/components/app-link";
import { LocalActionButton } from "@/components/local-action";
import { EmptyState, ListSkeleton, LoadFailed, StaleNote } from "@/components/state-views";
import { useDebounced } from "@/hooks/use-debounced";
import { useSearch } from "@/hooks/use-search-state";
import { metaApi } from "@/lib/api/meta";
import { keys } from "@/lib/cache/keys";
import { plural } from "@/lib/format";
import { dest, type Dest } from "@/routes/paths";
import { KNOWLEDGE_SEARCH } from "@/routes/search";
import { EntryTable } from "./entry-table";
import { entriesUnder, groupEntries, hasTopic, topicItems, type TopicItem } from "./groups";
import { facetsOf, sharedLine, VIEW_LABEL, VIEW_ORDER } from "./labels";

const SEARCH_PAUSE_MS = 250;

/**
 * The menu column (P125 L2, verdicts 3 and 10): the views with their server counts under "Show" (the View menu went), then "All
 * topics" and every topic of the rows in view with its count, a brand as a small heading when the brands differ, a sub-topic
 * indented once. Each item is a link to its address: a view keeps the topic, a topic keeps the view and the search.
 */
function KnowledgeNav({ filter, topic, q, counts, items }: { filter: View; topic: string; q: string; counts: KnowledgeListDto["counts"] | undefined; items: readonly TopicItem[] }) {
  const link = (to: Dest, current: boolean) => (content: ReactNode, className: string) => (
    <AppLink aria-current={current ? "page" : undefined} bare className={className} to={to}>
      {content}
    </AppLink>
  );
  const views: SectionNavItem[] = VIEW_ORDER.map((v) => ({ id: `view-${v}`, label: VIEW_LABEL[v], count: counts?.[v] ?? null, current: v === filter, group: "Show", render: link(dest("knowledge.page", { filter: v, q, topic }), v === filter) }));
  const all: SectionNavItem = { id: "topic-all", label: "All topics", current: topic === "", group: "Topics", render: link(dest("knowledge.page", { filter, q, topic: "" }), topic === "") };
  const topics: SectionNavItem[] = items.map((t) => ({ id: `topic-${t.topic}`, label: t.label, count: t.count, depth: t.depth, current: t.topic === topic, ...(t.group !== null ? { group: t.group } : {}), render: link(dest("knowledge.page", { filter, q, topic: t.topic }), t.topic === topic) }));
  return <SectionNav items={[...views, all, ...topics]} label="Knowledge topics" />;
}

/** The title search: the box keeps what was typed; the address follows it (`features/review/list-controls.tsx` for why). */
function SearchBox({ q, onSearch }: { q: string; onSearch: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(q);
  useEffect(() => {
    if (ref.current !== document.activeElement) setText(q);
  }, [q]);
  return <Input aria-label="Search knowledge" className="control-m w-full sm:w-56" onChange={(e) => { setText(e.target.value); onSearch(e.target.value); }} placeholder="Search titles and text" ref={ref} type="search" value={text} />;
}

/**
 * Knowledge (P70, `/knowledge`): the facts the agent cites in the owner's name, every entry with its title. The menu column
 * (P125 L2) holds the views and the topics (`?topic=`); the header line: the title search and Open folder (the folder whose files are listed below, `admin-principles.md`
 * rule 12). The body: the index's file problems when it does not match the files (from the project overview, with the phrase),
 * then one line for what every entry shares (its column left out), then the table under a heading per topic (P74). No status sentence: its numbers are the View
 * menu's counts, said once (rule 10). Read from the index only; a change is a phrase to the agent.
 */
export function KnowledgeView({ project, filter, q, topic }: { project: string; filter: View; q: string; topic: string }) {
  const [, setSearch] = useSearch(KNOWLEDGE_SEARCH);
  const setQ = useCallback((v: string) => setSearch({ q: v }), [setSearch]);
  const search = useDebounced(q.trim(), SEARCH_PAUSE_MS);
  const list = useQuery({ queryKey: keys.knowledge(project, filter, search), queryFn: () => metaApi.knowledge(project, filter, search), placeholderData: keepPreviousData });
  // What every entry shares is read over the whole base (the All view, unsearched: the same key as the default view), so a
  // column does not come and go with the view or the search (UX pass 2026-11-20).
  const base = useQuery({ queryKey: keys.knowledge(project, "all", ""), queryFn: () => metaApi.knowledge(project, "all", "") });
  const facets = facetsOf(base.data?.entries ?? []);
  const shared = base.data && base.data.entries.length > 0 ? sharedLine(facets) : null;
  const files = useQuery({ queryKey: keys.project(project), queryFn: () => metaApi.overview(project) });
  const k = files.data?.knowledge;
  const d = list.data;
  // The menu's topics are those of the rows in view (the view and the search); the table shows the chosen topic's rows only,
  // without the heading rows (verdict 4). A topic the rows do not have shows All.
  const sections = groupEntries(d?.entries ?? [], facets.brandsDiffer);
  const here = hasTopic(sections, topic) ? topic : "";
  const shown = d ? entriesUnder(sections, d.entries, here) : [];
  const hidden = d ? d.entries.length - shown.length : 0;
  const header = (
    <>
      <SearchBox onSearch={setQ} q={q} />
      <LocalActionButton action="finder.open" args={{ project, key: "knowledge" }} variant="secondary" />
    </>
  );
  const body =
    k?.state === "absent" ? (
      <EmptyState title="No knowledge yet">Say “{phrase("knowledge-import", project)}” in a session (knowledge-import).</EmptyState>
    ) : list.isPending ? (
      <ListSkeleton label="Loading the knowledge base" rows={4} />
    ) : !d ? (
      <LoadFailed error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} what="the knowledge base" />
    ) : (
      <>
        {k?.state === "error" && <p className="text-warning-foreground text-sm">{k.message}</p>}
        {k?.state === "ok" && !k.consistent && <p className="text-warning-foreground text-sm">The index is out of date ({plural(k.problems, "file problem")}): ask the agent to re-run `hub knowledge index`.</p>}
        {shared && (
          <p className="text-muted-foreground text-sm" data-testid="knowledge-shared">
            {shared}
          </p>
        )}
        {d.entries.length === 0 ? (
          <EmptyState action={<ActionButton onClick={() => setSearch({ filter: "all", q: "", topic: "" })} size="s" variant="secondary">Show all</ActionButton>} title="No entry in this view" />
        ) : (
          <EntryTable entries={shown} facets={facets} headings={here === ""} project={project} />
        )}
        {here !== "" && q.trim() !== "" && hidden > 0 && (
          <p className="text-muted-foreground text-sm">
            {plural(hidden, "more match", "more matches")} in other topics.{" "}
            <ActionButton onClick={() => setSearch({ topic: "" })} size="s" variant="quiet">
              Search everywhere
            </ActionButton>
          </p>
        )}
        {d.truncated && <p className="text-muted-foreground text-sm">The first {d.entries.length} are shown: search a title to find the rest.</p>}
        {list.isError && <StaleNote error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} />}
      </>
    );
  return (
    <SectionLayout nav={<KnowledgeNav counts={d?.counts} filter={filter} items={topicItems(sections, facets.brandsDiffer)} q={q} topic={here} />} navButton="Topics" navLabel="Knowledge topics">
      <Page actions={header}>{body}</Page>
    </SectionLayout>
  );
}

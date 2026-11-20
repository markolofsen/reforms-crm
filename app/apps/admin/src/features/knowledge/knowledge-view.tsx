import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { phrase } from "@hub/contract/help";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { KnowledgeListDto, KnowledgeView as View } from "@hub/contract/knowledge";
import { Input } from "@hub/ui/input";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@hub/ui/menu";
import { ActionButton } from "@hub/ui/product/action-button";
import { Page } from "@hub/ui/product/page";
import { LocalActionButton } from "@/components/local-action";
import { EmptyState, ListSkeleton, LoadFailed, StaleNote } from "@/components/state-views";
import { useDebounced } from "@/hooks/use-debounced";
import { useSearchState } from "@/hooks/use-search-state";
import { metaApi } from "@/lib/api/meta";
import { keys } from "@/lib/cache/keys";
import { plural } from "@/lib/format";
import { EntryTable } from "./entry-table";
import { facetsOf, sharedLine, VIEW_LABEL, VIEW_ORDER } from "./labels";

const SEARCH_PAUSE_MS = 250;

/** The View menu (All, Needs a look, Expired, Not approved), each with its count from the server. */
function ViewMenu({ value, counts, onChange }: { value: View; counts: KnowledgeListDto["counts"] | undefined; onChange: (v: string) => void }) {
  const count = (v: View) => counts?.[v] ?? "-";
  return (
    <Menu>
      <MenuTrigger render={<ActionButton size="m" variant="secondary" />}>
        <span className="sr-only">View: </span>
        {VIEW_LABEL[value]}
        <span className="font-normal tabular-nums">{count(value)}</span>
        <ChevronDownIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuRadioGroup onValueChange={(v) => onChange(String(v))} value={value}>
          {VIEW_ORDER.map((v) => (
            <MenuRadioItem key={v} value={v}>
              {VIEW_LABEL[v]} <span className="ms-auto ps-3 text-muted-foreground tabular-nums">{count(v)}</span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

/** The title search: the box keeps what was typed; the address follows it (`features/review/list-controls.tsx` for why). */
function SearchBox({ q, onSearch }: { q: string; onSearch: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(q);
  useEffect(() => {
    if (ref.current !== document.activeElement) setText(q);
  }, [q]);
  return <Input aria-label="Search knowledge titles" className="control-m w-full sm:w-56" onChange={(e) => { setText(e.target.value); onSearch(e.target.value); }} placeholder="Search titles" ref={ref} type="search" value={text} />;
}

/**
 * Knowledge (P70, `/knowledge`): the facts the agent cites in the owner's name, every entry with its title. The header line: the
 * View menu with counts, the title search and Open folder (the folder whose files are listed below, `admin-principles.md`
 * rule 12). The body: the index's file problems when it does not match the files (from the project overview, with the phrase),
 * then one line for what every entry shares (its column left out), then the table under a heading per topic (P74). No status sentence: its numbers are the View
 * menu's counts, said once (rule 10). Read from the index only; a change is a phrase to the agent.
 */
export function KnowledgeView({ project, filter, q }: { project: string; filter: View; q: string }) {
  const setFilter = useSearchState("filter")[1];
  const setQ = useSearchState("q")[1];
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
  const header = (
    <>
      <SearchBox onSearch={setQ} q={q} />
      <ViewMenu counts={d?.counts} onChange={setFilter} value={filter} />
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
          <EmptyState action={<ActionButton onClick={() => { setFilter("all"); setQ(""); }} size="s" variant="secondary">Show all</ActionButton>} title="No entry in this view" />
        ) : (
          <EntryTable entries={d.entries} facets={facets} project={project} />
        )}
        {d.truncated && <p className="text-muted-foreground text-sm">The first {d.entries.length} are shown: search a title to find the rest.</p>}
        {list.isError && <StaleNote error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} />}
      </>
    );
  return <Page actions={header}>{body}</Page>;
}

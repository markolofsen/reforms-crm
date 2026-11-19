import { useQuery } from "@tanstack/react-query";
import { entryKey } from "@hub/contract/local";
import { Skeleton } from "@hub/ui/skeleton";
import { LocalActionButton } from "@/components/local-action";
import { EmptyState, LoadFailed } from "@/components/state-views";
import { metaApi } from "@/lib/api/meta";
import { keys } from "@/lib/cache/keys";
import { plural } from "@/lib/format";

/**
 * Knowledge (P70; a child of Project in P63): the knowledge base, the one project fact with a list to act on. One status line (entries,
 * approval, expired), Open folder, what is missing, the file problems, then each listed entry with its Open (P61): the files
 * in Finder and their own app; nothing in the Hub changes. An import or a fix is a phrase to the agent.
 */
export function KnowledgeView({ project }: { project: string }) {
  const q = useQuery({ queryKey: keys.project(project), queryFn: () => metaApi.overview(project) });
  if (q.isPending) return <Skeleton aria-label="Loading the knowledge base" className="h-24 w-full rounded-xl" role="status" />;
  if (!q.data) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what="the knowledge base" />;
  const k = q.data.knowledge;
  if (k.state === "absent") return <EmptyState title="No knowledge yet">Say “загрузи знания проекта” in a session (knowledge-import).</EmptyState>;
  if (k.state === "error") {
    return (
      <p className="text-warning-foreground text-sm" data-testid="knowledge-status" role="status">
        {k.message}
      </p>
    );
  }
  const problem = !k.consistent || k.expired > 0;
  const approval = k.unapproved === 0 ? "all approved" : `${k.unapproved} not approved`;
  const summary = [`${k.indexed} ${k.indexed === 1 ? "entry" : "entries"}`, approval, k.expired > 0 ? `${k.expired} expired` : null].filter(Boolean).join(", ");
  return (
    <section aria-labelledby="knowledge-title" className="flex flex-col gap-3 text-sm">
      <h3 className="sr-only" id="knowledge-title">
        Knowledge base
      </h3>
      <div className="flex min-h-(--control-m) flex-wrap items-center gap-3">
        <p className={problem ? "me-auto font-medium text-base text-warning-foreground" : "me-auto font-medium text-base"} data-testid="knowledge-status" role="status">
          {summary}
        </p>
        <LocalActionButton action="finder.open" args={{ project, key: "knowledge" }} variant="secondary" />
      </div>
      <p className="tabular-nums text-muted-foreground">
        {k.noAudiences} without audiences, {k.noPhrasings} without phrasings.
      </p>
      {!k.consistent && <p className="text-warning-foreground">{plural(k.problems, "file problem")}: ask the agent to re-run `hub knowledge index`.</p>}
      {k.examples.length > 0 && (
        <ul aria-label="Entries" className="flex flex-col divide-y border-y" data-testid="knowledge-examples">
          {k.examples.map((e) => (
            <li className="flex min-h-(--control-m) min-w-0 items-center gap-2 py-1" key={e}>
              <span className="min-w-0 flex-1 break-all">{e}</span>
              <LocalActionButton action="file.open" args={{ project, key: entryKey(e) }}>
                <span>
                  Open<span className="sr-only"> {e}</span>
                </span>
              </LocalActionButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

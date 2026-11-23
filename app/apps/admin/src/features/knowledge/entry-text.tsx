import { useQuery } from "@tanstack/react-query";
import type { KeyboardEvent, MouseEvent } from "react";
import { ListSkeleton, LoadFailed } from "@/components/state-views";
import { metaApi } from "@/lib/api/meta";
import { keys } from "@/lib/cache/keys";

/**
 * One entry's text under its row (P128 X6, decision 0045 point 19): read only, at reading width, from the index (never a file
 * read); Open on the row edits the file. Asked only when the row opens, then cached with the knowledge base's other keys.
 */
export function EntryText({ project, entryKey, title }: { project: string; entryKey: string; title: string }) {
  const q = useQuery({ queryKey: keys.knowledgeText(project, entryKey), queryFn: () => metaApi.knowledgeText(project, entryKey) });
  if (q.isPending) return <ListSkeleton label={`Loading ${title}`} rows={2} />;
  if (!q.data) return <LoadFailed error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} what={title} />;
  return (
    <div className="flex max-w-prose flex-col gap-1" data-testid="knowledge-text">
      <p className="whitespace-pre-wrap break-words text-sm">{q.data.body.trim() === "" ? "This entry has no text." : q.data.body}</p>
      {q.data.truncated && <p className="text-muted-foreground text-xs">The text is cut here: Open shows the whole file.</p>}
    </div>
  );
}

/**
 * A row that opens its text: a click on the row (not on its Open) or Enter/Space while the row has focus toggles it, so the row
 * stays one Tab stop. The click also stays the agent's pointer (P72), which the ref attributes carry.
 */
export function toggleProps(open: boolean, toggle: () => void) {
  const fromControl = (t: EventTarget) => t instanceof Element && t.closest("button, a, [role=menuitem]") !== null;
  return {
    "aria-expanded": open,
    onClick: (e: MouseEvent) => {
      if (!fromControl(e.target)) toggle();
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      toggle();
    },
  };
}

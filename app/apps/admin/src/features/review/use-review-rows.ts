import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ReviewSource } from "./source";

/** The pages of a source as one list (paged, kept while the next view loads) and the rows the search leaves. */
export function useReviewRows(source: ReviewSource, search: string) {
  const query = useInfiniteQuery({
    queryKey: source.queryKey,
    queryFn: ({ pageParam }) => source.load(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    placeholderData: keepPreviousData,
    refetchInterval: source.refetchMs ?? false,
  });
  const loaded = useMemo(() => query.data?.pages.flatMap((p) => p.drafts) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total ?? 0;
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle ? loaded.filter((d) => `${d.client.name} ${d.client.email} ${d.subject}`.toLowerCase().includes(needle)) : loaded;
  }, [loaded, search]);
  return { query, loaded, total, rows };
}

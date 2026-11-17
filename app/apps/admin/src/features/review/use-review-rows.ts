import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ReviewSource } from "./source";

/** The pages of a source as one list (paged, kept while the next view loads). The search is the source's: the server narrows the rows. */
export function useReviewRows(source: ReviewSource) {
  const query = useInfiniteQuery({
    queryKey: source.queryKey,
    queryFn: ({ pageParam }) => source.load(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    placeholderData: keepPreviousData,
    refetchInterval: source.refetchMs ?? false,
  });
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.drafts) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total ?? 0;
  return { query, rows, total, counts: query.data?.pages[0]?.counts ?? {} };
}

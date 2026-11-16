import type { NotionReader } from "./types.js";

/** Pages of 100 rows read at most per data source (20 requests, about 7 s at 3 per second). */
export const COUNT_PAGE_CAP = 20;
export const COUNT_ROW_CAP = COUNT_PAGE_CAP * 100;

export interface PageCount {
  count: number;
  /** True when the cap was reached: the data source holds at least `count` rows. */
  capped: boolean;
}

/**
 * How many rows a data source holds, by paging its query and counting ids. Notion has no count endpoint. Stops after
 * `COUNT_ROW_CAP` rows without asking for more, so the cost of one count is bounded whatever the size. Nothing is
 * kept from the rows: not a title, not a property.
 */
export async function countPages(reader: Pick<NotionReader, "listPages">, dataSourceId: string, cap: number = COUNT_ROW_CAP): Promise<PageCount> {
  let count = 0;
  for await (const _page of reader.listPages(dataSourceId)) {
    count++;
    if (count >= cap) return { count, capped: true };
  }
  return { count, capped: false };
}

/** What went wrong with a read, in terms an owner can act on. The message text is never part of it. */
export type NotionFailure = "token-rejected" | "not-shared" | "unreachable" | "failed";

/** Maps an SDK or fetch error by its HTTP status or code. The SDK's text can echo a request, so callers show only the class. */
export function classifyNotionError(e: unknown): NotionFailure {
  const o = typeof e === "object" && e !== null ? (e as { status?: unknown; code?: unknown; name?: unknown }) : {};
  const code = typeof o.code === "string" ? o.code : "";
  if (o.status === 401 || code === "unauthorized") return "token-rejected";
  if (o.status === 404 || code === "object_not_found") return "not-shared";
  if (o.status === 403 || code === "restricted_resource") return "not-shared";
  if (typeof o.status === "number" && o.status >= 500) return "unreachable";
  if (/timeout|timed out|fetch failed|econn|enotfound|network|abort/i.test(`${code} ${String(o.name)} ${e instanceof Error ? e.message : ""}`)) return "unreachable";
  return "failed";
}

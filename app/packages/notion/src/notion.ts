// The package is CommonJS: Node ESM cannot see its named exports, so take them from the default (module.exports).
import notionhq from "@notionhq/client";
import { createThrottle, type Sleep } from "./throttle.js";
import type { DataSourceInfo, NotionReader, PageMarkdown, PageObject, PropertyConfig } from "./types.js";

export interface ReaderOptions {
  /** Requests per second. Notion's limit is about 3 per connection. */
  rps?: number;
  /** Injected in tests so nothing touches the network. */
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: Sleep;
}

interface RichText {
  plain_text?: string;
}
interface DataSourceResponse {
  id: string;
  title?: RichText[];
  properties?: Record<string, PropertyConfig>;
}
interface QueryResponse {
  results: Array<{ object?: string } & Partial<PageObject>>;
  has_more: boolean;
  next_cursor: string | null;
}
interface MarkdownResponse {
  markdown: string;
  truncated?: boolean;
  unknown_block_ids?: string[];
}

/**
 * The real reader: @notionhq/client behind a throttle. Three endpoints, all reads: data source retrieve, data source
 * query (a POST that only reads) and page markdown retrieve. The SDK retries 429 and 529 itself and honours Retry-After.
 */
export function createNotionReader(token: string, options: ReaderOptions = {}): NotionReader {
  const rps = options.rps ?? 3;
  const gate = createThrottle(Math.ceil(1000 / rps), options.now, options.sleep);
  const client = new notionhq.Client({
    auth: token,
    timeoutMs: 60_000,
    retry: { maxRetries: 5, initialRetryDelayMs: 1000, maxRetryDelayMs: 60_000 },
    ...(options.fetch ? { fetch: options.fetch as never } : {}),
  });

  return {
    async retrieveDataSource(dataSourceId: string): Promise<DataSourceInfo> {
      await gate();
      const res = (await client.dataSources.retrieve({ data_source_id: dataSourceId })) as unknown as DataSourceResponse;
      return {
        id: res.id,
        title: (res.title ?? []).map((t) => t.plain_text ?? "").join(""),
        properties: res.properties ?? {},
      };
    },

    async *listPages(dataSourceId: string): AsyncIterable<PageObject> {
      let cursor: string | undefined;
      for (;;) {
        await gate();
        const res = (await client.dataSources.query({
          data_source_id: dataSourceId,
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        })) as unknown as QueryResponse;
        for (const item of res.results) if (item.object === "page") yield item as PageObject;
        if (!res.has_more || !res.next_cursor) return;
        cursor = res.next_cursor;
      }
    },

    async retrieveMarkdown(pageId: string): Promise<PageMarkdown> {
      await gate();
      const res = (await client.pages.retrieveMarkdown({ page_id: pageId })) as unknown as MarkdownResponse;
      return {
        markdown: res.markdown ?? "",
        truncated: res.truncated === true,
        unknownBlockIds: res.unknown_block_ids ?? [],
      };
    },
  };
}

// The package is CommonJS: Node ESM cannot see its named exports, so take them from the default (module.exports).
import notionhq from "@notionhq/client";
import { ops } from "@hub/log/ops";
import { createThrottle, type Sleep } from "./throttle";
import type { DataSourceInfo, NotionReader, PageMarkdown, PageObject, PropertyConfig } from "./types";

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
  parent?: { type?: string; database_id?: string };
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
 * query (a POST that only reads; `listPages` pages through it, `findPages` filters it, P87) and page markdown retrieve. The SDK retries 429 and 529 itself and honours Retry-After.
 */
/**
 * P86: a failed Notion call is an `error` line with the operation, Notion's status and code and the error's class; never its
 * message (a Notion error can quote a property value). The SDK has already retried 429 and 529 when this runs.
 */
async function logged<T>(op: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const status: unknown = e && typeof e === "object" ? Reflect.get(e, "status") : undefined;
    const kind: unknown = e && typeof e === "object" ? Reflect.get(e, "code") : undefined;
    ops("notion").error(`Notion ${op} failed`, { status: typeof status === "number" ? status : null, kind: typeof kind === "string" ? kind : null, error: e instanceof Error ? e.name : "error" });
    throw e;
  }
}

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
      const res = (await logged("data source read", () => client.dataSources.retrieve({ data_source_id: dataSourceId }))) as unknown as DataSourceResponse;
      return {
        id: res.id,
        title: (res.title ?? []).map((t) => t.plain_text ?? "").join(""),
        ...(res.parent?.database_id ? { pageId: res.parent.database_id } : {}),
        properties: res.properties ?? {},
      };
    },

    async *listPages(dataSourceId: string): AsyncIterable<PageObject> {
      let cursor: string | undefined;
      for (;;) {
        await gate();
        const res = (await logged("query", () =>
          client.dataSources.query({
            data_source_id: dataSourceId,
            page_size: 100,
            ...(cursor ? { start_cursor: cursor } : {}),
          }),
        )) as unknown as QueryResponse;
        for (const item of res.results) if (item.object === "page") yield item as PageObject;
        if (!res.has_more || !res.next_cursor) return;
        cursor = res.next_cursor;
      }
    },

    async findPages(dataSourceId: string, filter: unknown, limit = 10): Promise<PageObject[]> {
      await gate();
      const res = (await logged("query", () => client.dataSources.query({ data_source_id: dataSourceId, page_size: Math.min(Math.max(limit, 1), 100), filter: filter as never }))) as unknown as QueryResponse;
      return res.results.filter((i) => i.object === "page") as PageObject[];
    },

    async retrieveMarkdown(pageId: string): Promise<PageMarkdown> {
      await gate();
      const res = (await logged("page read", () => client.pages.retrieveMarkdown({ page_id: pageId }))) as unknown as MarkdownResponse;
      return {
        markdown: res.markdown ?? "",
        truncated: res.truncated === true,
        unknownBlockIds: res.unknown_block_ids ?? [],
      };
    },
  };
}

// P135 K5 (verdict 2): the client map's Notion copy. The client's Clients page gets one section the Hub owns: a heading "Client
// map" and one `mermaid` code block under it (Notion draws it), updated in place on every new version, and the date property
// "Map updated". The rest of the page is never touched, and nothing is deleted (the integration cannot delete): a block that
// exists is edited, a missing one appended at the end. The text comes checked (`@hub/diagram/map`) and with its classDefs
// (`notionMapSource`). A failure never reaches the agent's map: the caller gets a state and the ops log one line.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import notionhq from "@notionhq/client";
import { ops } from "@hub/log/ops";
import { projectStore } from "@hub/projects/store";
import { findClientByEmail } from "./client-lookup";
import { createNotionReader } from "./notion";
import type { NotionReader } from "./types";

export const MAP_HEADING = "Client map";
export const MAP_DATE_FIELD = "Map updated";
/** Notion's cap per rich text item, in UTF-16 units (memory "Notion rich text is UTF-16"). */
export const RICH_TEXT_UNITS = 2000;

/** The page's top-level blocks as this writer needs them. */
export interface MapBlock { id: string; type: string; text: string; language?: string }

export interface MapWriter {
  /** The page's top-level blocks, in order (every page of the list). */
  blocks(pageId: string): Promise<MapBlock[]>;
  /** Replaces the text of one code block (language mermaid). */
  updateCode(blockId: string, text: string): Promise<void>;
  /** Appends the heading and the code block (at the end, or the code block alone right after `after`). */
  append(pageId: string, text: string, after?: string): Promise<void>;
  /** Sets the "Map updated" date. */
  setDate(pageId: string, at: string): Promise<void>;
}

/** The text as rich text items of at most 2,000 UTF-16 units each, never splitting a surrogate pair. */
export function richTextChunks(text: string): Array<{ type: "text"; text: { content: string } }> {
  const out: Array<{ type: "text"; text: { content: string } }> = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + RICH_TEXT_UNITS, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    out.push({ type: "text", text: { content: text.slice(i, end) } });
    i = end;
  }
  return out;
}

const plain = (rt: unknown): string => (Array.isArray(rt) ? rt.map((r: unknown) => (r && typeof r === "object" ? String(Reflect.get(r, "plain_text") ?? "") : "")).join("") : "");

export function createMapWriter(token: string, options: { fetch?: typeof fetch } = {}): MapWriter {
  const client = new notionhq.Client({ auth: token, timeoutMs: 30_000, retry: { maxRetries: 2, initialRetryDelayMs: 1000, maxRetryDelayMs: 10_000 }, ...(options.fetch ? { fetch: options.fetch as never } : {}) });
  const code = (text: string) => ({ object: "block", type: "code", code: { language: "mermaid", rich_text: richTextChunks(text) } });
  return {
    async blocks(pageId) {
      const all: MapBlock[] = [];
      let cursor: string | undefined;
      do {
        const r = await client.blocks.children.list({ block_id: pageId, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
        for (const b of r.results) {
          const type = String(Reflect.get(b, "type") ?? "");
          const body: unknown = Reflect.get(b, type);
          const text = body && typeof body === "object" ? plain(Reflect.get(body, "rich_text")) : "";
          const language = type === "code" && body && typeof body === "object" ? String(Reflect.get(body, "language") ?? "") : undefined;
          all.push({ id: b.id, type, text, ...(language === undefined ? {} : { language }) });
        }
        cursor = r.has_more ? (r.next_cursor ?? undefined) : undefined;
      } while (cursor);
      return all;
    },
    async updateCode(blockId, text) {
      await client.blocks.update({ block_id: blockId, code: { language: "mermaid", rich_text: richTextChunks(text) } } as never);
    },
    async append(pageId, text, after) {
      const heading = { object: "block", type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: MAP_HEADING } }] } };
      await client.blocks.children.append({ block_id: pageId, children: (after ? [code(text)] : [heading, code(text)]) as never, ...(after ? { after } : {}) } as never);
    },
    async setDate(pageId, at) {
      await client.pages.update({ page_id: pageId, properties: { [MAP_DATE_FIELD]: { date: { start: at } } } as never });
    },
  };
}

export type MapSyncOutcome = { state: "synced"; pageId: string; block: "updated" | "added" } | { state: "skipped"; reason: "not_client" | "do_not_contact"; detail: string };

/** Writes the map onto the client's Clients page (found by address): the Hub's block in place, else a new section; then the date. */
export async function writeClientMap(deps: { reader: NotionReader; writer: MapWriter }, o: { clientsDataSource: string; email: string; text: string; at: string }): Promise<MapSyncOutcome> {
  const found = await findClientByEmail(deps.reader, o.clientsDataSource, o.email);
  if (found.state === "not_client") return { state: "skipped", reason: "not_client", detail: "no Clients row has this address" };
  if (found.state === "do_not_contact") return { state: "skipped", reason: "do_not_contact", detail: "the client is marked Do not contact" };
  const blocks = await deps.writer.blocks(found.pageId);
  const h = blocks.findIndex((b) => b.type.startsWith("heading_") && b.text.trim() === MAP_HEADING);
  const next = h >= 0 ? blocks[h + 1] : undefined;
  let block: "updated" | "added" = "added";
  if (next?.type === "code" && next.language === "mermaid") {
    await deps.writer.updateCode(next.id, o.text);
    block = "updated";
  } else await deps.writer.append(found.pageId, o.text, h >= 0 ? blocks[h]!.id : undefined);
  const ds = await deps.reader.retrieveDataSource(o.clientsDataSource);
  if (ds.properties[MAP_DATE_FIELD]?.type === "date") await deps.writer.setDate(found.pageId, o.at);
  return { state: "synced", pageId: found.pageId, block };
}

export interface MapSyncEnv {
  projectsDir: string;
  /** `hubPaths().secrets`: the token's folder (its file name is the project's `notion.token_file`). */
  secretsDir: string;
  /** Tests: the reader and the writer (default: the real ones with the project's token). */
  clients?: (token: string) => { reader: NotionReader; writer: MapWriter };
}

export type MapSyncResult = MapSyncOutcome | { state: "no_database" | "no_token"; detail: string } | { state: "failed"; detail: string };

/**
 * One new map version to the client's Notion page: the project's `clients` data source, its token file. Never throws; every
 * outcome but `synced` is one ops-log line (`notion`). A Notion error is its status and code, never its message.
 */
export async function syncClientMap(env: MapSyncEnv, n: { project: string; email: string; text: string; at: string }): Promise<MapSyncResult> {
  const log = ops("notion");
  try {
    const p = projectStore({ projects: env.projectsDir }).config(n.project);
    const ds = p.notion.databases.find((d) => d.slug === "clients")?.dataSourceId;
    if (!ds) return { state: "no_database", detail: "no clients database in project.md" };
    let token = "";
    try { token = readFileSync(join(env.secretsDir, p.notion.tokenFile), "utf8").trim(); } catch { /* absent */ }
    if (!token) { log.info("client map not copied to Notion: no token on this Mac", { project: n.project, file: p.notion.tokenFile }); return { state: "no_token", detail: `no ${p.notion.tokenFile} in state/secrets` }; }
    const c = env.clients?.(token) ?? { reader: createNotionReader(token), writer: createMapWriter(token) };
    const r = await writeClientMap(c, { clientsDataSource: ds, email: n.email, text: n.text, at: n.at });
    if (r.state === "synced") log.info(`client map copied to Notion (${r.block})`, { project: n.project });
    else log.warn(`client map not copied to Notion: ${r.reason}`, { project: n.project });
    return r;
  } catch (e) {
    const status: unknown = e && typeof e === "object" ? Reflect.get(e, "status") : undefined;
    const code: unknown = e && typeof e === "object" ? Reflect.get(e, "code") : undefined;
    // 403 restricted_resource: the integration lacks Update or Insert content (Notion > Integrations > Capabilities).
    log.warn("client map not copied to Notion: the write failed", { project: n.project, status: typeof status === "number" ? status : null, kind: typeof code === "string" ? code : null, error: e instanceof Error ? e.name : "error" });
    return { state: "failed", detail: `${typeof status === "number" ? `HTTP ${status} ` : ""}${typeof code === "string" ? code : e instanceof Error ? e.name : "error"}` };
  }
}

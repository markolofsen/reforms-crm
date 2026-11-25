// P142 F7 (decision 0050 point 9, verdicts 12 and 13): a follow-up plan's Notion copy. The client's Clients page gets the four
// Hub-owned properties (`Next follow-up`, `Follow-up status`, `Follow-ups sent`, `Waiting on`; each set only when the database has
// it with the right type, so a page before `hub install --only notion.follow-ups` is skipped cleanly), and one dated line appended
// under the heading "Follow-ups" (made once at the end of the page, never rewritten: the integration cannot delete, and the
// lines are the page's log). The CRM's own `Follow-up on`, `Waiting since`, `Last inbound` and `Last outbound` are never written:
// one owner per field. A failure never reaches the plan: the caller gets a state and the ops log one line.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import notionhq from "@notionhq/client";
import { FOLLOW_UP_NOTION, FOLLOW_UP_NOTION_HEADING, followUpNotionStatus, type FollowUpState } from "@hub/config/follow-ups";
import { ops } from "@hub/log/ops";
import { projectStore } from "@hub/projects/store";
import { findClientByEmail, type ClientLookup } from "./client-lookup";
import { richTextChunks, type MapBlock } from "./client-map";
import { createNotionReader } from "./notion";
import { notionSdkLog } from "./sdk-log";
import type { NotionReader } from "./types";

/** The four properties, the type each must have in the data source, and the CRM fields this writer never touches. */
export const FOLLOW_UP_PROPERTY_TYPES: Record<(typeof FOLLOW_UP_NOTION)[keyof typeof FOLLOW_UP_NOTION], "date" | "select" | "number"> = {
  [FOLLOW_UP_NOTION.next]: "date",
  [FOLLOW_UP_NOTION.status]: "select",
  [FOLLOW_UP_NOTION.sent]: "number",
  [FOLLOW_UP_NOTION.waitingOn]: "select",
};
export const CRM_FOLLOW_UP_FIELDS = ["Follow-up on", "Waiting since", "Waiting band", "Last inbound", "Last outbound", "Last two-way contact", "Do not follow up"] as const;

export interface FollowUpPlanCopy {
  nextAt: string | null;
  state: FollowUpState;
  nudgeReady: boolean;
  nudgesSent: number;
  waitingOn: "them" | "us" | null;
  /** The dated line to append, or null (a same-day replace adds none). */
  line: string | null;
}

export interface FollowUpWriter {
  blocks(pageId: string): Promise<MapBlock[]>;
  setProperties(pageId: string, props: Record<string, unknown>): Promise<void>;
  /** Appends paragraphs (and the heading first when `heading`) at the end of the page, or right after `after`. */
  append(pageId: string, lines: string[], o: { heading: boolean; after?: string }): Promise<void>;
}

export function createFollowUpWriter(token: string, options: { fetch?: typeof fetch } = {}): FollowUpWriter {
  const client = new notionhq.Client({ auth: token, timeoutMs: 30_000, retry: { maxRetries: 2, initialRetryDelayMs: 1000, maxRetryDelayMs: 10_000 }, ...notionSdkLog, ...(options.fetch ? { fetch: options.fetch as never } : {}) });
  const para = (t: string) => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: richTextChunks(t) } });
  return {
    async blocks(pageId) {
      const all: MapBlock[] = [];
      let cursor: string | undefined;
      do {
        const r = await client.blocks.children.list({ block_id: pageId, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
        for (const b of r.results) {
          const type = String(Reflect.get(b, "type") ?? "");
          const body: unknown = Reflect.get(b, type);
          const rt: unknown = body && typeof body === "object" ? Reflect.get(body, "rich_text") : undefined;
          const text = Array.isArray(rt) ? rt.map((x: unknown) => (x && typeof x === "object" ? String(Reflect.get(x, "plain_text") ?? "") : "")).join("") : "";
          all.push({ id: b.id, type, text });
        }
        cursor = r.has_more ? (r.next_cursor ?? undefined) : undefined;
      } while (cursor);
      return all;
    },
    async setProperties(pageId, props) {
      await client.pages.update({ page_id: pageId, properties: props as never });
    },
    async append(pageId, lines, o) {
      const heading = { object: "block", type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: FOLLOW_UP_NOTION_HEADING } }] } };
      await client.blocks.children.append({ block_id: pageId, children: [...(o.heading ? [heading] : []), ...lines.map(para)] as never, ...(o.after ? { after: o.after } : {}) } as never);
    },
  };
}

/** The property values of a plan, only for the properties the data source has with the right type (verdict 12). Pure. */
export function followUpProperties(have: Record<string, { type: string } | undefined>, p: FollowUpPlanCopy): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const ok = (name: keyof typeof FOLLOW_UP_PROPERTY_TYPES) => have[name]?.type === FOLLOW_UP_PROPERTY_TYPES[name];
  // Answered empties the date (verdict 12).
  if (ok(FOLLOW_UP_NOTION.next)) out[FOLLOW_UP_NOTION.next] = { date: p.nextAt && p.state !== "answered" ? { start: p.nextAt.slice(0, 10) } : null };
  if (ok(FOLLOW_UP_NOTION.status)) out[FOLLOW_UP_NOTION.status] = { select: { name: followUpNotionStatus(p) } };
  if (ok(FOLLOW_UP_NOTION.sent)) out[FOLLOW_UP_NOTION.sent] = { number: p.nudgesSent };
  if (ok(FOLLOW_UP_NOTION.waitingOn)) out[FOLLOW_UP_NOTION.waitingOn] = { select: p.waitingOn ? { name: p.waitingOn === "us" ? "Us" : "Them" } : null };
  return out;
}

export type FollowUpSyncOutcome = { state: "synced"; pageId: string; properties: number; line: "appended" | "none" } | { state: "skipped"; reason: "not_client" | "do_not_contact" | "no_properties"; detail: string };

/** Writes the plan onto the client's Clients page: the properties it has, then the line under the Hub's heading (append only). */
export async function writeFollowUp(deps: { reader: NotionReader; writer: FollowUpWriter }, o: { clientsDataSource: string; email?: string | null; pageId?: string | null; plan: FollowUpPlanCopy }): Promise<FollowUpSyncOutcome> {
  const found: ClientLookup = o.pageId ? { state: "client", pageId: o.pageId } : o.email ? await findClientByEmail(deps.reader, o.clientsDataSource, o.email) : { state: "not_client" };
  if (found.state === "not_client") return { state: "skipped", reason: "not_client", detail: "no Clients row for this client" };
  if (found.state === "do_not_contact") return { state: "skipped", reason: "do_not_contact", detail: "the client is marked Do not contact" };
  const ds = await deps.reader.retrieveDataSource(o.clientsDataSource);
  const props = followUpProperties(ds.properties, o.plan);
  if (Object.keys(props).length) await deps.writer.setProperties(found.pageId, props);
  let line: "appended" | "none" = "none";
  if (o.plan.line) {
    const blocks = await deps.writer.blocks(found.pageId);
    const h = blocks.findIndex((b) => b.type.startsWith("heading_") && b.text.trim() === FOLLOW_UP_NOTION_HEADING);
    // Newest last: after the last line of the section (the blocks that follow the heading up to the next heading).
    let after: string | undefined;
    if (h >= 0) {
      after = blocks[h]!.id;
      for (let i = h + 1; i < blocks.length && !blocks[i]!.type.startsWith("heading_"); i++) after = blocks[i]!.id;
    }
    await deps.writer.append(found.pageId, [o.plan.line], { heading: h < 0, ...(after ? { after } : {}) });
    line = "appended";
  }
  if (!Object.keys(props).length && line === "none") return { state: "skipped", reason: "no_properties", detail: "the Clients database has none of the four follow-up properties: hub install --only notion.follow-ups" };
  return { state: "synced", pageId: found.pageId, properties: Object.keys(props).length, line };
}

export interface FollowUpSyncEnv {
  projectsDir: string;
  secretsDir: string;
  clients?: (token: string) => { reader: NotionReader; writer: FollowUpWriter };
}

export type FollowUpSyncResult = FollowUpSyncOutcome | { state: "no_database" | "no_token"; detail: string } | { state: "failed"; detail: string };

/** One plan to the client's Notion page. Never throws; every outcome but `synced` is one ops line (`notion`), never a message's text. */
export async function syncFollowUp(env: FollowUpSyncEnv, n: { project: string; email?: string | null; pageId?: string | null; plan: FollowUpPlanCopy }): Promise<FollowUpSyncResult> {
  const log = ops("notion");
  try {
    const p = projectStore({ projects: env.projectsDir }).config(n.project);
    const ds = p.notion.databases.find((d) => d.slug === "clients")?.dataSourceId;
    if (!ds) return { state: "no_database", detail: "no clients database in project.md" };
    let token = "";
    try {
      token = readFileSync(join(env.secretsDir, p.notion.tokenFile), "utf8").trim();
    } catch {
      token = "";
    }
    if (!token) return { state: "no_token", detail: `no ${p.notion.tokenFile} in state/secrets` };
    const c = env.clients?.(token) ?? { reader: createNotionReader(token), writer: createFollowUpWriter(token) };
    const r = await writeFollowUp(c, { clientsDataSource: ds, email: n.email ?? null, pageId: n.pageId ?? null, plan: n.plan });
    if (r.state === "synced") log.info("follow-up plan copied to Notion", { project: n.project, properties: r.properties, line: r.line });
    else log.warn(`follow-up plan not copied to Notion: ${r.reason}`, { project: n.project });
    return r;
  } catch (e) {
    const status: unknown = e && typeof e === "object" ? Reflect.get(e, "status") : undefined;
    const code: unknown = e && typeof e === "object" ? Reflect.get(e, "code") : undefined;
    log.warn("follow-up plan not copied to Notion: the write failed", { project: n.project, status: typeof status === "number" ? status : null, kind: typeof code === "string" ? code : null, error: e instanceof Error ? e.name : "error" });
    return { state: "failed", detail: `${typeof status === "number" ? `HTTP ${status} ` : ""}${typeof code === "string" ? code : e instanceof Error ? e.name : "error"}` };
  }
}

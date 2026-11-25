// P145 B3 (verdicts 15 and 17, decision 0054): a client's bug report in the project's Bug reports database. One page is one
// symptom in one Area: the Hub searches the open reports (New, Triaged, In progress) of that Area and project, appends a second
// client's words to the one it finds (Clients gains the client, the body a dated block, Last reported the time), creates a report
// with Status New when there is none, and with several creates nothing and returns them. Per message it is idempotent: the block
// carries a short hash of the message's key, and a second filing finds it. It never writes Severity, Notes, Fix link, Duplicate of
// or a Status but New, and it never states a cause. A failure never throws to the caller of `fileBugReportFor`.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import notionhq from "@notionhq/client";
import { optionForKey } from "@hub/projects/brands";
import { projectStore } from "@hub/projects/store";
import { ops } from "@hub/log/ops";
import { findClientByEmail } from "./client-lookup";
import { richTextChunks, type MapBlock } from "./client-map";
import { createNotionReader } from "./notion";
import { notionSdkLog } from "./sdk-log";
import type { DataSourceInfo, NotionReader, PageObject, PropertyConfig } from "./types";

export const BUG_OPEN_STATUSES = ["New", "Triaged", "In progress"] as const;
export const BUG_CHANNELS = ["Mail", "WhatsApp", "Telegram", "Other"] as const;
/** P147 3g H1: one database, three kinds; existing rows (no Kind) are Product. */
export const BUG_KINDS = ["Product", "Knowledge gap", "Workflow"] as const;
export type BugKind = (typeof BUG_KINDS)[number];
export type BugChannel = (typeof BUG_CHANNELS)[number];
const HEADING = "Reports";
const WORDS_MAX = 1_500;

export interface BugReportInput {
  /** The project key or option name; matched to the Projects option with the same key. */
  project: string;
  /** P147 3g: Product (default), Knowledge gap or Workflow; the open-report search keys on Kind plus Area (H3). */
  kind?: BugKind;
  area: string;
  symptom: string;
  words: string;
  evidence: readonly string[];
  channel: BugChannel;
  /** The Hub conversation, resolved by the tool (never typed by the agent). */
  sourceLink: string | null;
  /** The client's Clients page, when the Hub knows it; else it is looked up by `clientEmail`. */
  clientPageId: string | null;
  clientEmail?: string | null;
  /** The message the report is in (a Message-ID or a chat message id): one entry per message. */
  messageKey: string;
  /** When the message was sent (ISO). */
  at: string;
  /** The report to append to, when a search returned several. */
  into?: string | null;
}

export type BugReportOutcome =
  | { state: "created" | "appended" | "already"; pageId: string; note: string | null }
  | { state: "several"; candidates: Array<{ pageId: string; bug: string }> };

export interface BugReportWriter {
  create(dataSourceId: string, properties: Record<string, unknown>, children: unknown[]): Promise<string>;
  update(pageId: string, properties: Record<string, unknown>): Promise<void>;
  retrievePage(pageId: string): Promise<PageObject>;
  blocks(pageId: string): Promise<MapBlock[]>;
  append(pageId: string, children: unknown[]): Promise<void>;
}

/** An Area in one form: lower case, one space, `kind: name` ("Parser:OpenSooq" -> "parser: opensooq"). Pure. */
export const normalArea = (area: string): string => area.trim().toLowerCase().replace(/\s+/g, " ").replace(/\s*:\s*/, ": ").slice(0, 100);

/** The live Area option whose normal form equals the input's, else the input's normal form (a new option). Pure. */
export function areaOption(options: readonly string[], area: string): string {
  const want = normalArea(area);
  return options.find((o) => normalArea(o) === want) ?? want;
}

/** The marker one message leaves in a report's body: a hash, so the page names no mail or chat id. Pure. */
export const messageMark = (key: string): string => `[m:${createHash("sha256").update(key.trim()).digest("hex").slice(0, 12)}]`;

const optionNames = (c: PropertyConfig | undefined): string[] => {
  const o = c ? (c[c.type] as { options?: Array<{ name?: unknown }> } | undefined) : undefined;
  return Array.isArray(o?.options) ? o.options.map((x) => (typeof x.name === "string" ? x.name : "")).filter(Boolean) : [];
};
const text = (t: string) => ({ rich_text: richTextChunks(t.slice(0, 2_000)) });
const bullet = (t: string) => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: richTextChunks(t.slice(0, 2_000)) } });

/** The dated block of one report: the words, quoted, with the message's mark; then one line per piece of evidence. Pure. */
export function entryBlocks(i: Pick<BugReportInput, "at" | "channel" | "words" | "evidence" | "messageKey">): unknown[] {
  const words = i.words.trim().slice(0, WORDS_MAX);
  return [bullet(`${i.at.slice(0, 10)} · ${i.channel} · "${words}" ${messageMark(i.messageKey)}`), ...i.evidence.map((e) => bullet(`Evidence: ${e.trim()}`))];
}

/** The properties of a new report: only those the database has, with their own types; Status New, never Severity. Pure. */
export function newReportProperties(ds: DataSourceInfo, i: BugReportInput, o: { project: string | null; area: string }): Record<string, unknown> {
  const has = (name: string, type: string) => ds.properties[name]?.type === type;
  const title = Object.entries(ds.properties).find(([, c]) => c.type === "title")?.[0] ?? "Bug";
  const p: Record<string, unknown> = { [title]: { title: richTextChunks(i.symptom.trim().slice(0, 200)) } };
  if (o.project && has("Projects", "multi_select")) p["Projects"] = { multi_select: [{ name: o.project }] };
  if (i.clientPageId && has("Clients", "relation")) p["Clients"] = { relation: [{ id: i.clientPageId }] };
  if (has("Channel", "select")) p["Channel"] = { select: { name: i.channel } };
  if (i.sourceLink && has("Source link", "url")) p["Source link"] = { url: i.sourceLink };
  if (has("Client's words", "rich_text")) p["Client's words"] = text(i.words.trim().slice(0, WORDS_MAX));
  if (i.evidence.length && has("Evidence", "rich_text")) p["Evidence"] = text(i.evidence.map((e) => e.trim()).join("\n"));
  if (has("Area", "select")) p["Area"] = { select: { name: o.area } };
  if (has("Kind", "select")) p["Kind"] = { select: { name: i.kind ?? "Product" } };
  if (has("Status", "select") && optionNames(ds.properties["Status"]).includes("New")) p["Status"] = { select: { name: "New" } };
  if (has("Reported at", "date")) p["Reported at"] = { date: { start: i.at } };
  if (has("Last reported", "date")) p["Last reported"] = { date: { start: i.at } };
  return p;
}

const titleOf = (page: PageObject): string => {
  const t = Object.values(page.properties).find((v) => v.type === "title")?.title;
  return Array.isArray(t) ? t.map((x) => String((x as { plain_text?: unknown }).plain_text ?? "")).join("") : "";
};
const multiNames = (page: PageObject, name: string): string[] => ((page.properties[name]?.multi_select as Array<{ name?: unknown }> | undefined) ?? []).map((x) => String(x.name ?? ""));
const relationIds = (page: PageObject, name: string): string[] => ((page.properties[name]?.relation as Array<{ id?: unknown }> | undefined) ?? []).map((x) => String(x.id ?? "")).filter(Boolean);
const bare = (id: string) => id.replace(/-/g, "").toLowerCase();

/** Search, then append, create or answer the candidates. Throws on a Notion failure (the wrapper turns it into a state). */
export async function fileBugReport(deps: { reader: NotionReader; writer: BugReportWriter }, o: { dataSourceId: string }, i: BugReportInput): Promise<BugReportOutcome> {
  const ds = await deps.reader.retrieveDataSource(o.dataSourceId);
  const project = optionForKey(optionNames(ds.properties["Projects"]), i.project);
  const area = areaOption(optionNames(ds.properties["Area"]), i.area);
  const note = project ? null : `Bug reports has no Projects option for ${i.project}: filed without it (hub install --only notion.projects adds it)`;
  let target = i.into ?? null;
  // A new Area has no report yet (and a filter on an option Notion does not hold is not worth a call).
  const knownArea = optionNames(ds.properties["Area"]).includes(area);
  if (!target && knownArea) {
    // 3g H3: Kind plus Area is one report (a row with no Kind is Product, as before Kind existed).
    const kind = i.kind ?? "Product";
    const byKind = ds.properties["Kind"]?.type === "select" ? [kind === "Product" ? { or: [{ property: "Kind", select: { equals: "Product" } }, { property: "Kind", select: { is_empty: true } }] } : { property: "Kind", select: { equals: kind } }] : [];
    const filter = { and: [{ property: "Area", select: { equals: area } }, ...byKind, { or: BUG_OPEN_STATUSES.map((s) => ({ property: "Status", select: { equals: s } })) }] };
    const found = deps.reader.findPages ? await deps.reader.findPages(o.dataSourceId, filter, 25) : [];
    const open = found.filter((p) => !project || multiNames(p, "Projects").includes(project));
    if (open.length > 1) return { state: "several", candidates: open.map((p) => ({ pageId: p.id, bug: titleOf(p).slice(0, 200) })) };
    target = open[0]?.id ?? null;
  }
  if (!target) {
    const pageId = await deps.writer.create(o.dataSourceId, newReportProperties(ds, i, { project, area }), [{ object: "block", type: "heading_2", heading_2: { rich_text: richTextChunks(HEADING) } }, ...entryBlocks(i)]);
    return { state: "created", pageId, note };
  }
  const page = await deps.writer.retrievePage(target);
  const parent = (page as { parent?: { data_source_id?: unknown } }).parent?.data_source_id;
  if (typeof parent === "string" && bare(parent) !== bare(o.dataSourceId)) throw Object.assign(new Error("not a bug report"), { code: "not_a_report" });
  const mark = messageMark(i.messageKey);
  if ((await deps.writer.blocks(target)).some((b) => b.text.includes(mark))) return { state: "already", pageId: target, note: null };
  const props: Record<string, unknown> = {};
  const clients = relationIds(page, "Clients");
  if (i.clientPageId && ds.properties["Clients"]?.type === "relation" && !clients.some((c) => bare(c) === bare(i.clientPageId!))) props["Clients"] = { relation: [...clients, i.clientPageId].map((id) => ({ id })) };
  if (ds.properties["Last reported"]?.type === "date") props["Last reported"] = { date: { start: i.at } };
  if (Object.keys(props).length) await deps.writer.update(target, props);
  await deps.writer.append(target, entryBlocks(i));
  return { state: "appended", pageId: target, note };
}

export function createBugReportWriter(token: string, options: { fetch?: typeof fetch } = {}): BugReportWriter {
  const client = new notionhq.Client({ auth: token, timeoutMs: 30_000, retry: { maxRetries: 2, initialRetryDelayMs: 1000, maxRetryDelayMs: 10_000 }, ...notionSdkLog, ...(options.fetch ? { fetch: options.fetch as never } : {}) });
  return {
    async create(dataSourceId, properties, children) {
      return ((await client.pages.create({ parent: { data_source_id: dataSourceId }, properties: properties as never, children: children as never })) as { id: string }).id;
    },
    async update(pageId, properties) {
      await client.pages.update({ page_id: pageId, properties: properties as never });
    },
    async retrievePage(pageId) {
      return (await client.pages.retrieve({ page_id: pageId })) as unknown as PageObject;
    },
    async blocks(pageId) {
      const all: MapBlock[] = [];
      let cursor: string | undefined;
      do {
        const r = await client.blocks.children.list({ block_id: pageId, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
        for (const b of r.results) {
          const type = String(Reflect.get(b, "type") ?? "");
          const body: unknown = Reflect.get(b, type);
          const rt: unknown = body && typeof body === "object" ? Reflect.get(body, "rich_text") : undefined;
          all.push({ id: b.id, type, text: Array.isArray(rt) ? rt.map((x: unknown) => (x && typeof x === "object" ? String(Reflect.get(x, "plain_text") ?? "") : "")).join("") : "" });
        }
        cursor = r.has_more ? (r.next_cursor ?? undefined) : undefined;
      } while (cursor);
      return all;
    },
    async append(pageId, children) {
      await client.blocks.children.append({ block_id: pageId, children: children as never });
    },
  };
}

export interface BugReportEnv {
  projectsDir: string;
  secretsDir: string;
  clients?: (token: string) => { reader: NotionReader; writer: BugReportWriter };
}

export type BugReportResult = BugReportOutcome | { state: "no_database" | "no_token" | "failed"; detail: string };

/** One filing for a project. Never throws; every outcome is one ops line (`notion`) without the client's words. */
export async function fileBugReportFor(env: BugReportEnv, slug: string, i: BugReportInput): Promise<BugReportResult> {
  const log = ops("notion");
  try {
    const p = projectStore({ projects: env.projectsDir }).config(slug);
    const ds = p.notion.databases.find((d) => d.slug === "bug-reports")?.dataSourceId;
    if (!ds) return { state: "no_database", detail: "project.md lists no bug-reports database: the owner runs `hub install --only notion.bug-reports`" };
    let token = "";
    try {
      token = readFileSync(join(env.secretsDir, p.notion.tokenFile), "utf8").trim();
    } catch {
      token = "";
    }
    if (!token) return { state: "no_token", detail: `no ${p.notion.tokenFile} in state/secrets: the Hub cannot write Notion here` };
    const c = env.clients?.(token) ?? { reader: createNotionReader(token), writer: createBugReportWriter(token) };
    const clients = p.notion.databases.find((d) => d.slug === "clients")?.dataSourceId;
    let clientPageId = i.clientPageId;
    if (!clientPageId && i.clientEmail && clients) {
      const found = await findClientByEmail(c.reader, clients, i.clientEmail);
      clientPageId = found.state === "not_client" ? null : found.pageId;
    }
    const r = await fileBugReport(c, { dataSourceId: ds }, { ...i, clientPageId });
    log.info(`bug report ${r.state}`, { project: slug, area: normalArea(i.area), ...(r.state === "several" ? { candidates: r.candidates.length } : {}) });
    return r;
  } catch (e) {
    const status: unknown = e && typeof e === "object" ? Reflect.get(e, "status") : undefined;
    const code: unknown = e && typeof e === "object" ? Reflect.get(e, "code") : undefined;
    log.warn("filing a bug report in Notion failed", { project: slug, status: typeof status === "number" ? status : null, kind: typeof code === "string" ? code : null, error: e instanceof Error ? e.name : "error" });
    return { state: "failed", detail: `${typeof status === "number" ? `HTTP ${status} ` : ""}${typeof code === "string" ? code : e instanceof Error ? e.name : "error"}` };
  }
}
